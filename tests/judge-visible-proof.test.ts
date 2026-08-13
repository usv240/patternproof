import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path: string) => readFileSync(root + path, "utf8");

test("public evidence ledger exposes bounded determinism and transfer evidence", () => {
  const page = source("app/proof/page.tsx");
  assert.match(page, /2 identical requests/);
  assert.match(page, /b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9/);
  assert.match(page, /141_631/);
  assert.match(page, /3 \/ 3 recognizable/);
  assert.match(page, /What this does not prove/);
  assert.doesNotMatch(page, /process\.env/);
});

test("QR codes are generated locally and WhatsApp shares only the current link", () => {
  const actions = source("app/components/ShareActions.tsx");
  assert.match(actions, /QRCode\.toDataURL\(url/);
  assert.match(actions, /https:\/\/wa\.me\/\?text=/);
  assert.match(actions, /window\.print\(\)/);
  assert.match(actions, /Anyone with this private bearer link/);
  assert.doesNotMatch(actions, /fetch\(|axios|api\.qr/);
});

test("owner sharing and approved Cut Cards expose the judge-visible handoff", () => {
  const workspace = source("app/components/TailorWorkspace.tsx");
  const review = source("app/components/CustomerReview.tsx");
  assert.match(workspace, /<ShareActions[\s\S]*url=\{shareUrl\}/);
  assert.match(review, /<ShareActions[\s\S]*printable/);
  assert.match(review, /currentShareUrl/);
});
