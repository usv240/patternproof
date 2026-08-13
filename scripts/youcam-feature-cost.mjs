import { readFile } from "node:fs/promises";

const ENDPOINT = "https://yce-api-01.makeupar.com/s2s/v2.0/credit/feature-cost";

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

loadLocalEnvironment(await readFile(".env.local", "utf8"));
if (!process.env.YOUCAM_API_KEY) throw new Error("YOUCAM_API_KEY is not configured.");

const skus = [];
let startingToken;
for (let page = 0; page < 50; page += 1) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("page_size", "20");
  if (startingToken) url.searchParams.set("starting_token", startingToken);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + process.env.YOUCAM_API_KEY,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.status !== 200) {
    throw new Error(
      "YouCam feature-cost request failed with HTTP/API status " +
        response.status +
        "/" +
        (payload?.status ?? "unknown"),
    );
  }

  const pageSkus = payload?.result?.skus;
  if (!Array.isArray(pageSkus)) {
    throw new Error("YouCam returned an invalid feature-cost page.");
  }
  skus.push(...pageSkus);
  const nextToken = payload?.result?.next_token;
  if (
    typeof nextToken !== "string" ||
    !nextToken ||
    nextToken === startingToken
  ) {
    break;
  }
  startingToken = nextToken;
}

const entries = skus.filter((entry) =>
  JSON.stringify(entry).toLowerCase().includes("cloth"),
);
if (entries.length === 0) throw new Error("YouCam returned no Clothes feature-cost entry.");
process.stdout.write(
  JSON.stringify({ clothes_feature_costs: entries }, null, 2) + "\n",
);