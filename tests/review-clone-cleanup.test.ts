import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseReviewCloneCleanupManifest } from "../lib/review-clone-cleanup-contract";

const shop = "11111111-1111-4111-8111-111111111111";
const brief = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const prefix = `${shop}/${brief}/${revision}`;

test("clone cleanup accepts exactly one canonical body/reference pair", () => {
  const parsed = parseReviewCloneCleanupManifest([
    `${prefix}/reference.jpg`,
    `${prefix}/body.jpg`,
  ]);
  assert.deepEqual(parsed?.paths, [
    `${prefix}/body.jpg`,
    `${prefix}/reference.jpg`,
  ]);
});

test("clone cleanup rejects duplicate, cross-revision, and extra paths", () => {
  assert.equal(parseReviewCloneCleanupManifest([
    `${prefix}/body.jpg`,
    `${prefix}/body.jpg`,
  ]), undefined);
  assert.equal(parseReviewCloneCleanupManifest([
    `${prefix}/body.jpg`,
    `${shop}/${brief}/${shop}/reference.jpg`,
  ]), undefined);
  assert.equal(parseReviewCloneCleanupManifest([
    `${prefix}/body.jpg`,
    `${prefix}/reference.jpg`,
    `${prefix}/render-${"a".repeat(64)}.jpg`,
  ]), undefined);
  assert.equal(parseReviewCloneCleanupManifest([
    `not-a-uuid/${brief}/${revision}/body.jpg`,
    `not-a-uuid/${brief}/${revision}/reference.jpg`,
  ]), undefined);
  assert.equal(parseReviewCloneCleanupManifest([
    `AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/${brief}/${revision}/body.jpg`,
    `AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/${brief}/${revision}/reference.jpg`,
  ]), undefined);
});

test("maintenance uses the fenced, bounded clone cleanup contract", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const worker = readFileSync(`${root}lib/review-clone-cleanup.ts`, "utf8");
  const route = readFileSync(
    `${root}app/api/maintenance/intake-cleanup/route.ts`,
    "utf8",
  );
  const migration = readFileSync(
    `${root}supabase/migrations/20260812001700_review_clone_saga_reconciliation.sql`,
    "utf8",
  );

  assert.match(worker, /rpc\("claim_review_revision_clone_cleanup"/);
  assert.match(worker, /rpc\("complete_review_revision_clone_cleanup"/);
  assert.match(worker, /storage\.from\(BUCKET\)\.remove\(manifest\.paths\)/);
  assert.match(route, /const INTAKE_DRAIN_BUDGET_MS = 35_000/);
  assert.match(route, /const SECONDARY_CLEANUP_BATCH = 10/);
  assert.match(route, /runReviewCloneCleanup\(admin, SECONDARY_CLEANUP_BATCH\)/);
  assert.match(route, /runBodyPhotoErasureCleanup\(admin, SECONDARY_CLEANUP_BATCH\)/);
  assert.match(migration, /limit least\(greatest\(coalesce\(p_limit, 1\), 1\), 25\)/);
  assert.match(migration, /object\.name = any\(c\.cleanup_object_paths\)/);
  assert.match(
    migration,
    /return coalesce\(completed and cleanup_succeeded, false\)/,
  );
});
