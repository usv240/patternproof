import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isCanonicalFrozenReferencePath,
  isCanonicalFrozenRenderPath,
} from "../lib/security/storage-path";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/20260814000200_youcam_evidence_chain.sql");
const effectiveReferenceMigration = source("supabase/migrations/20260814000300_effective_reference_render_key.sql");

test("evidence-chain migration is fenced, private, and uses exact provider unit costs", () => {
  assert.match(migration, /current_migration not in \(22, 23\)/);
  assert.match(migration, /set migration = 23/);
  assert.match(migration, /alter table public\.youcam_evidence_job enable row level security/);
  assert.match(migration, /alter table public\.youcam_evidence_usage enable row level security/);
  assert.match(migration, /when 'background_removal' then 1/);
  assert.match(migration, /when 'fabric_vto' then 2/);
  assert.match(migration, /when 'approved_motion' then 5/);
  assert.match(migration, /lifetime_units \+ unit_cost > 12/);
  assert.match(migration, /budget\.id = 'youcam-cloth-v3'/);
  assert.match(migration, /job_status text, claimed boolean/);
  assert.match(migration, /existing\.status, false/);
  assert.match(migration, /'reserved'::text, true/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete).*youcam_evidence.*to authenticated/i);
});

test("Clothes VTO reservation binds to the effective rescued-reference hash", () => {
  assert.match(effectiveReferenceMigration, /migration in \(23, 24\)/);
  assert.match(effectiveReferenceMigration, /coalesce\(r\.reference_rescued_hash, r\.garment_spec #>>/);
  assert.match(effectiveReferenceMigration, /reference-hash invariant is not unique/);
  assert.match(effectiveReferenceMigration, /set migration = 24/);
  assert.match(effectiveReferenceMigration, /grant execute on function public\.reserve_render_job[\s\S]*to service_role/);
});

test("motion remains outside the immutable revision while effective visual evidence freezes", () => {
  assert.doesNotMatch(migration, /add column if not exists motion_path/);
  assert.match(migration, /feature = 'approved_motion'[\s\S]*brief_status <> 'approved'/);
  assert.match(migration, /coalesce\(r\.reference_rescued_path, r\.reference_path\)/);
  assert.match(migration, /coalesce\(r\.fabric_render_path, r\.render_path\)/);
  assert.match(migration, /Motion is available only after customer approval/);
});

test("official YouCam endpoints are feature-specific and video parameters are server-fixed", () => {
  const client = source("lib/youcam/evidence-client.ts");
  assert.match(client, /\/task\/template\/fabric/);
  assert.match(client, /path = "\/task\/sod"/);
  assert.match(client, /path = "\/task\/fabric"/);
  assert.match(client, /path = "\/task\/image-to-video\/youcam"/);
  assert.match(client, /model: "youcam-video-v2"/);
  assert.match(client, /resolution: "480"/);
  assert.match(client, /dst_duration: 5/);
  assert.doesNotMatch(client, /\n\s*duration: 5/);
  assert.doesNotMatch(client, /input\.prompt|input\.duration|input\.resolution/);
});

test("Fabric VTO selection is revalidated against the server-side template catalog", () => {
  const route = source("app/api/youcam/evidence/route.ts");
  assert.match(route, /const catalog = await listFabricTemplates\(\)/);
  assert.match(route, /catalog\.templates\.find\(\(item\) => item\.id === body\.templateId\)/);
  assert.match(route, /predefined fabric direction/i);
  assert.match(route, /if \(!reservation\.claimed\)/);
  assert.match(route, /reservation\?\.claimed && reservation\.status === "reserved"/);
});

test("frozen evidence path helpers accept only exact revision-owned variants", () => {
  const prefix = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
  const hash = "a".repeat(64);
  assert.equal(isCanonicalFrozenReferencePath(`${prefix}/reference.jpg`, prefix), true);
  assert.equal(isCanonicalFrozenReferencePath(`${prefix}/reference-clean-${hash}.jpg`, prefix), true);
  assert.equal(isCanonicalFrozenRenderPath(`${prefix}/render-${hash}.jpg`, prefix), true);
  assert.equal(isCanonicalFrozenRenderPath(`${prefix}/fabric-${hash}.jpg`, prefix), true);
  assert.equal(isCanonicalFrozenRenderPath(`${prefix}/motion-${hash}.mp4`, prefix), false);
  assert.equal(isCanonicalFrozenRenderPath(`other/${prefix}/fabric-${hash}.jpg`, prefix), false);
});

test("product copy refuses swatch, drape, and checksum overclaims", () => {
  const lab = source("app/components/YouCamEvidenceLab.tsx");
  assert.match(lab, /predefined visual direction, not an uploaded swatch or drape simulation/i);
  assert.match(lab, /Motion is presentation-only and is excluded from the frozen construction checksum/i);
});
test("every evidence route stays bounded, origin-checked, and server-rehosted", () => {
  const createRoute = source("app/api/youcam/evidence/route.ts");
  const pollRoute = source("app/api/youcam/evidence/[jobId]/route.ts");
  const rehost = source("lib/youcam/evidence-rehost.ts");
  assert.match(createRoute, /hasTrustedMutationOrigin\(request\)/);
  assert.match(createRoute, /readBoundedJsonBody\(request, MAX_BODY_BYTES\)/);
  assert.doesNotMatch(createRoute, /request\.(?:json|text)\(\)/);
  assert.match(pollRoute, /authorizeEvidencePoll\(jobId\)/);
  assert.match(rehost, /readBoundedResponseBlob\(response, MAX_RESULT_BYTES\)/);
  assert.match(rehost, /isPrivateNetworkAddress/);
  assert.match(rehost, /redirect: "manual"/);
  assert.match(rehost, /video\/mp4/);
});

test("the public proof ledger exposes the bounded four-feature lifecycle", () => {
  const proof = source("app/proof/page.tsx");
  for (const label of ["Background Removal", "Clothes VTO V3", "Fabric VTO", "Image-to-Video V2"]) {
    assert.match(proof, new RegExp(label));
  }
  assert.match(proof, /never changes the frozen construction checksum/i);
  assert.match(proof, /complete 10-unit chain/i);
});