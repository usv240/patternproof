import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyShareReadRequest,
  computePublicDemoProof,
  PUBLIC_DEMO_PAYLOAD,
  PUBLIC_DEMO_REFERENCE_SHA256,
  PUBLIC_DEMO_RENDER_SHA256,
  PUBLIC_DEMO_SNAPSHOT_SHA256,
} from "../lib/public-demo";
import { PUBLIC_DEMO_TOKEN } from "../lib/public-demo-token";

function digest(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(new URL("../" + relativePath, import.meta.url)))
    .digest("hex");
}

test("only the exact public demo token bypasses private-share configuration", () => {
  assert.equal(classifyShareReadRequest(PUBLIC_DEMO_TOKEN, false), "public_demo");

  for (const lookalike of [
    "Demo-olive",
    "demo-olive ",
    "demo-olive/",
    "demo-olive?preview=1",
    "x-demo-olive",
  ]) {
    assert.equal(classifyShareReadRequest(lookalike, false), "invalid_token");
  }
});

test("real share tokens retain shape validation and configuration gating", () => {
  const plausiblePrivateToken = "A".repeat(43);

  assert.equal(
    classifyShareReadRequest(plausiblePrivateToken, false),
    "sharing_unconfigured",
  );
  assert.equal(classifyShareReadRequest(plausiblePrivateToken, true), "private_share");
  assert.equal(classifyShareReadRequest("A".repeat(42), false), "invalid_token");
  assert.equal(classifyShareReadRequest("A".repeat(42), true), "invalid_token");
});

test("public demo payload is recursively frozen with a deterministic proof", () => {
  assert.equal(PUBLIC_DEMO_PAYLOAD.mode, "public_demo");
  assert.equal(PUBLIC_DEMO_PAYLOAD.immutable, true);
  assert.equal(PUBLIC_DEMO_PAYLOAD.revision.locked, true);
  assert.equal(PUBLIC_DEMO_PAYLOAD.brief.approved_revision_id, null);
  assert.equal(PUBLIC_DEMO_PAYLOAD.brief.status, "public_demo");
  assert.match(PUBLIC_DEMO_SNAPSHOT_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(computePublicDemoProof(), PUBLIC_DEMO_SNAPSHOT_SHA256);
  assert.equal(computePublicDemoProof(), computePublicDemoProof());
  assert.equal(Object.isFrozen(PUBLIC_DEMO_PAYLOAD), true);
  assert.equal(Object.isFrozen(PUBLIC_DEMO_PAYLOAD.brief), true);
  assert.equal(Object.isFrozen(PUBLIC_DEMO_PAYLOAD.revision.requirements), true);
  assert.equal(Object.isFrozen(PUBLIC_DEMO_PAYLOAD.revision.requirements[0]), true);
});

test("public demo files remain byte-identical to their pinned proofs", () => {
  assert.equal(digest("public/demo/reference-olive.jpg"), PUBLIC_DEMO_REFERENCE_SHA256);
  assert.equal(digest("public/demo/render-olive.jpg"), PUBLIC_DEMO_RENDER_SHA256);
});

test("the public demo approval endpoint is an explicit read-only boundary", () => {
  const approvalRoute = readFileSync(
    new URL("../app/api/share/[token]/approve/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    approvalRoute,
    /if \(isPublicDemoToken\(token\)\) return error\("The public demo is read-only\.", 403\);/,
  );
  assert.match(approvalRoute, /if \(!isPlausibleShareToken\(token\)\)/);
  assert.ok(
    approvalRoute.indexOf("isPublicDemoToken(token)") <
      approvalRoute.indexOf("isSupabaseAdminConfigured()"),
  );
});

test("the explicit demo page cannot shadow the immutable customer review", () => {
  const page = readFileSync(
    new URL("../app/s/demo-olive/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /import CustomerReview from "\.\.\/\.\.\/components\/CustomerReview"/);
  assert.match(page, /initialPayload=\{PUBLIC_DEMO_PAYLOAD\}/);
  assert.doesNotMatch(page, /silhouette|Seeded example render|Customer approved/);
});

test("global headers do not leak bearer review URLs through referrers", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

  assert.match(config, /Referrer-Policy", value: "no-referrer"/);
  assert.doesNotMatch(config, /strict-origin-when-cross-origin/);
});
