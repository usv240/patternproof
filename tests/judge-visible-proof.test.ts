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
  assert.match(page, /108<\/strong><span>complaints/);
  assert.match(page, /41<\/strong><span>businesses/);
  assert.match(page, /3<\/strong><span>Indian cities/);
  assert.match(page, /Expectation mismatch/);
  assert.match(page, /Bounded negative sample &middot; not prevalence/);
  assert.match(page, /What this does not prove/);
  assert.match(page, /Inspect the evidence, not just the claim/);
  assert.match(page, /blob\/main\/RESEARCH\.md/);
  assert.match(page, /blob\/main\/D1-RESULTS\.md/);
  assert.match(page, /blob\/main\/ASSETS\.md/);
  assert.match(page, /production-acceptance-20260814\.txt/);
  assert.match(page, /live-evidence-acceptance\.ps1/);
  assert.match(page, /yce\.perfectcorp\.com\/ai-api\/contents\/clothes-api/);
  assert.doesNotMatch(page, /process\.env/);
});

test("published acceptance transcript is sanitized and records the four-feature chain", () => {
  const transcript = source("evidence/production-acceptance-20260814.txt");
  assert.match(transcript, /PASS  YouCam Background Removal reference rescue/);
  assert.match(transcript, /PASS  YouCam Clothes VTO V3 body-specific preview/);
  assert.match(transcript, /PASS  YouCam Fabric VTO predefined direction/);
  assert.match(transcript, /PASS  YouCam Image-to-Video V2 post-approval motion proof/);
  assert.match(transcript, /4 YouCam jobs, 10 units, 164\.5 seconds/);
  assert.doesNotMatch(transcript, /sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{16,}|https?:\/\/[^\s?]+\?token=/);
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
