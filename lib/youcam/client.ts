import "server-only";

const API_BASE = "https://yce-api-01.makeupar.com/s2s/v2.0";
const CLOTH_TASK_PATH = "/task/cloth-v3";
const REQUEST_TIMEOUT_MS = 30_000;

type Envelope<T> = { status: number; data: T };
class YouCamRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "YouCamRequestError";
  }
}

type TaskData = {
  task_id?: string;
  task_status?: "pending" | "processing" | "success" | "error";
  results?: { url?: string };
};

export type ClothesRenderInput = {
  sourceImageUrl: string;
  referenceImageUrl: string;
  garmentCategory: "auto" | "full_body" | "upper_body" | "lower_body";
};

function apiKey(): string {
  const key = process.env.YOUCAM_API_KEY;
  if (!key) throw new Error("YouCam is not configured on this server.");
  return key;
}

function imageUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only credential-free HTTPS image URLs are allowed.");
  }
  return url.toString();
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
}

async function request<T>(
  path: string,
  init: RequestInit,
  options: { retrySafe?: boolean } = {},
): Promise<T> {
  const attempts = options.retrySafe ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        throw new YouCamRequestError(
          `YouCam request failed with HTTP ${response.status}.`,
          transient,
        );
      }

      const payload = (await response.json()) as Envelope<T>;
      if (!payload || typeof payload !== "object" || payload.status !== 200) {
        throw new Error(
          `YouCam API returned status ${typeof payload?.status === "number" ? payload.status : "unknown"}.`,
        );
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof YouCamRequestError) || error.retryable;
      if (!options.retrySafe || !retryable || attempt + 1 >= attempts) throw error;
      await backoff(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("YouCam request failed.");
}

export async function createClothesRender(input: ClothesRenderInput) {
  const data = await request<TaskData>(CLOTH_TASK_PATH, {
    method: "POST",
    body: JSON.stringify({
      src_file_url: imageUrl(input.sourceImageUrl),
      ref_file_url: imageUrl(input.referenceImageUrl),
      garment_category: input.garmentCategory,
    }),
  });
  if (!data.task_id) throw new Error("YouCam did not return a task ID.");
  return { jobId: data.task_id };
}

export async function getClothesRender(jobId: string) {
  if (
    jobId.length > 512 ||
    !/^[A-Za-z0-9_+\-/=]+$/.test(jobId)
  ) {
    throw new Error("Invalid task ID.");
  }
  const data = await request<TaskData>(
    `${CLOTH_TASK_PATH}/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    { retrySafe: true },
  );
  return {
    status: data.task_status ?? "unknown",
    resultUrl: data.results?.url,
  };
}
