import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const API_BASE = "https://yce-api-01.makeupar.com/s2s/v2.0";
const OUTPUT_DIR = join("test-results", "youcam");
const POLL_LIMIT = 60;
const POLL_DELAY_MS = 3_000;

const cases = [
  {
    id: "t3-worn-reference",
    source: "test-assets/qa-body-front.jpg",
    reference: "test-assets/qa-garment-worn.jpg",
  },
  {
    id: "t3-angled-cropped",
    source: "test-assets/qa-body-front.jpg",
    reference: "test-assets/qa-garment-angled-cropped.jpg",
  },
  {
    id: "t3-low-light",
    source: "test-assets/qa-body-front.jpg",
    reference: "test-assets/qa-garment-low-light.jpg",
  },
  {
    id: "t4-poor-body",
    source: "test-assets/qa-body-poor-cropped-dark.jpg",
    reference: "test-assets/qa-garment-worn.jpg",
  },
];

const caseOption = process.argv.find((value) => value.startsWith("--case="));
const selectedCases = caseOption
  ? cases.filter((scenario) => scenario.id === caseOption.slice("--case=".length))
  : cases;

function loadLocalEnvironment(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function request(url, init, timeoutMs = 30_000) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function apiJson(path, init = {}) {
  const response = await request(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.YOUCAM_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.status !== 200) {
    throw new Error(`YouCam HTTP/API status ${response.status}/${payload?.status ?? "unknown"}`);
  }
  return payload.data;
}

async function uploadFixture(path) {
  const bytes = await readFile(path);
  const fileName = basename(path);
  const issued = await apiJson("/file/cloth-v3", {
    method: "POST",
    body: JSON.stringify({
      files: [
        {
          content_type: "image/jpg",
          file_name: fileName,
          file_size: bytes.length,
        },
      ],
    }),
  });
  const file = issued?.files?.[0];
  const upload = file?.requests?.find((item) => item?.method === "PUT");
  if (typeof file?.file_id !== "string" || typeof upload?.url !== "string") {
    throw new Error(`YouCam did not issue an upload grant for ${fileName}`);
  }
  const target = new URL(upload.url);
  if (target.protocol !== "https:" || target.username || target.password) {
    throw new Error(`YouCam issued an unsafe upload URL for ${fileName}`);
  }
  const uploadResponse = await request(
    target,
    {
      method: "PUT",
      headers: {
        "Content-Length": String(bytes.length),
        "Content-Type": "image/jpg",
      },
      body: bytes,
      redirect: "follow",
    },
    60_000,
  );
  if (!uploadResponse.ok) {
    throw new Error(`YouCam file upload failed with HTTP ${uploadResponse.status}`);
  }
  return file.file_id;
}

async function waitForTask(taskId) {
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
    const data = await apiJson(`/task/cloth-v3/${encodeURIComponent(taskId)}`);
    if (data?.task_status === "success" || data?.task_status === "error") return data;
  }
  return { task_status: "timeout", error: { code: "local_poll_timeout" } };
}

function safeErrorCode(value) {
  if (typeof value === "string") return value.slice(0, 120);
  if (!value || typeof value !== "object") return null;
  for (const key of ["code", "error_code", "message"]) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate.slice(0, 120);
  }
  return null;
}

async function persistResult(caseId, urlValue) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("YouCam returned an unsafe result URL");
  }
  const response = await request(url, {}, 60_000);
  if (!response.ok) throw new Error(`Result download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const output = join(OUTPUT_DIR, `${caseId}.jpg`);
  await writeFile(output, bytes, { flag: "w" });
  return {
    output,
    result_host: url.hostname.toLowerCase(),
    result_sha256: createHash("sha256").update(bytes).digest("hex"),
    result_bytes: bytes.length,
  };
}

async function main() {
  if (!process.argv.includes("--confirm-live")) {
    throw new Error("Pass --confirm-live to run the selected credit-consuming QA tasks.");
  }
  if (selectedCases.length === 0) throw new Error("The requested QA case does not exist.");
  await loadLocalEnvironment(await readFile(".env.local", "utf8"));
  if (!process.env.YOUCAM_API_KEY) throw new Error("YOUCAM_API_KEY is not configured.");

  await mkdir(OUTPUT_DIR, { recursive: true });
  const uploadCache = new Map();
  async function fixtureId(path) {
    if (!uploadCache.has(path)) uploadCache.set(path, uploadFixture(path));
    return uploadCache.get(path);
  }

  const report = [];
  for (const scenario of selectedCases) {
    const startedAt = Date.now();
    process.stdout.write(`${scenario.id}: uploading fixtures...\n`);
    try {
      const [sourceId, referenceId] = await Promise.all([
        fixtureId(scenario.source),
        fixtureId(scenario.reference),
      ]);
      const created = await apiJson("/task/cloth-v3", {
        method: "POST",
        body: JSON.stringify({
          src_file_id: sourceId,
          ref_file_id: referenceId,
          garment_category: "full_body",
        }),
      });
      if (typeof created?.task_id !== "string") {
        throw new Error("YouCam did not return a task ID");
      }
      process.stdout.write(`${scenario.id}: processing...\n`);
      const result = await waitForTask(created.task_id);
      const row = {
        id: scenario.id,
        status: result?.task_status ?? "unknown",
        duration_ms: Date.now() - startedAt,
        error_code: safeErrorCode(result?.error),
      };
      if (row.status === "success" && typeof result?.results?.url === "string") {
        Object.assign(row, await persistResult(scenario.id, result.results.url));
      }
      report.push(row);
      process.stdout.write(`${scenario.id}: ${row.status} (${row.duration_ms} ms)\n`);
    } catch (error) {
      report.push({
        id: scenario.id,
        status: "harness_error",
        duration_ms: Date.now() - startedAt,
        error_code: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });
      process.stdout.write(`${scenario.id}: harness_error\n`);
    }
  }

  const reportPath = join(OUTPUT_DIR, "report.json");
  let previousCases = [];
  if (process.argv.includes("--append")) {
    try {
      const previous = JSON.parse(await readFile(reportPath, "utf8"));
      if (Array.isArray(previous?.cases)) previousCases = previous.cases;
    } catch {
      // A missing or invalid local report must not block a fresh redacted record.
    }
  }
  await writeFile(
    reportPath,
    JSON.stringify(
      { generated_at: new Date().toISOString(), cases: [...previousCases, ...report] },
      null,
      2,
    ) + "\n",
  );  process.stdout.write(`Redacted report: ${reportPath}\n`);
  if (report.some((row) => row.status === "harness_error" || row.status === "timeout")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Validation harness failed.");
  process.exitCode = 1;
});
