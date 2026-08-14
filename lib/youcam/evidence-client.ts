import "server-only";

const API_BASE = "https://yce-api-01.makeupar.com/s2s/v2.0";
const REQUEST_TIMEOUT_MS = 30_000;
const TASK_ID = /^[A-Za-z0-9._:+\-/=]+$/;

type Envelope<T> = { status: number; data: T };
type TaskData = {
  task_id?: string;
  task_status?: "pending" | "processing" | "running" | "success" | "error";
  results?: { url?: string };
  url?: string;
};

export type EvidenceFeature =
  | "background_removal"
  | "fabric_vto"
  | "approved_motion";

export type FabricTemplate = {
  id: string;
  thumb: string;
  title: string;
  categoryName: string;
};

function apiKey(): string {
  const key = process.env.YOUCAM_API_KEY;
  if (!key) throw new Error("YouCam is not configured on this server.");
  return key;
}

function providerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only credential-free HTTPS input URLs are allowed.");
  }
  return url.toString();
}

function taskId(value: string | undefined): string {
  if (!value || value.length > 512 || !TASK_ID.test(value)) {
    throw new Error("YouCam did not return a valid task ID.");
  }
  return value;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
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
    throw new Error(`YouCam request failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as Envelope<T>;
  if (!payload || typeof payload !== "object" || payload.status !== 200) {
    throw new Error(
      `YouCam API returned status ${typeof payload?.status === "number" ? payload.status : "unknown"}.`,
    );
  }
  return payload.data;
}

export async function listFabricTemplates(
  startingToken?: string,
): Promise<{ templates: FabricTemplate[]; nextToken?: string }> {
  const query = new URLSearchParams({ page_size: "20" });
  if (startingToken) query.set("starting_token", startingToken);
  const data = await request<{
    templates?: Array<{
      id?: string;
      thumb?: string;
      title?: string;
      category_name?: string;
    }>;
    next_token?: string;
  }>(`/task/template/fabric?${query.toString()}`, { method: "GET" });

  return {
    templates: (data.templates ?? []).flatMap((template) => {
      if (
        typeof template.id !== "string" ||
        typeof template.thumb !== "string" ||
        typeof template.title !== "string" ||
        typeof template.category_name !== "string"
      ) return [];
      return [{
        id: taskId(template.id),
        thumb: providerUrl(template.thumb),
        title: template.title.slice(0, 160),
        categoryName: template.category_name.slice(0, 120),
      }];
    }),
    nextToken: typeof data.next_token === "string" ? data.next_token : undefined,
  };
}

export async function createEvidenceTask(input: {
  feature: EvidenceFeature;
  sourceUrl: string;
  templateId?: string;
}): Promise<{ taskId: string }> {
  const source = providerUrl(input.sourceUrl);
  let path: string;
  let body: Record<string, unknown>;

  if (input.feature === "background_removal") {
    path = "/task/sod";
    body = { src_file_url: source };
  } else if (input.feature === "fabric_vto") {
    if (!input.templateId) throw new Error("A predefined Fabric VTO template is required.");
    path = "/task/fabric";
    body = { src_file_url: source, template_id: taskId(input.templateId) };
  } else {
    path = "/task/image-to-video/youcam";
    body = {
      src_file_url: source,
      model: "youcam-video-v2",
      resolution: "480",
      dst_duration: 5,
      prompt: "Subtle natural garment presentation, stationary camera, preserve the exact outfit design and person identity.",
      negative_prompt: "camera movement, outfit change, body distortion, text, logo, extra limbs",
    };
  }

  const data = await request<TaskData>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { taskId: taskId(data.task_id) };
}

export async function getEvidenceTask(
  feature: EvidenceFeature,
  value: string,
): Promise<{ status: string; resultUrl?: string }> {
  const id = taskId(value);
  const base = feature === "background_removal"
    ? "/task/sod"
    : feature === "fabric_vto"
      ? "/task/fabric"
      : "/task/image-to-video/youcam";
  const data = await request<TaskData>(`${base}/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return {
    status: data.task_status ?? "unknown",
    resultUrl: data.results?.url ?? data.url,
  };
}
