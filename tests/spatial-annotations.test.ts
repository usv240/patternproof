import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path: string) => readFileSync(root + path, "utf8");

test("spatial annotation input is bounded and coordinate normalized", () => {
  const validation = source("lib/brief-workspace.ts");
  assert.match(validation, /parseAnnotationInput/);
  assert.match(validation, /input\.anchorX < 0[\s\S]*input\.anchorX > 1/);
  assert.match(validation, /input\.anchorY < 0[\s\S]*input\.anchorY > 1/);
  assert.match(validation, /input\.body\.length > 1_000/);
});

test("annotation routes preserve auth, origin, body, ownership, and lock boundaries", () => {
  const create = source("app/api/brief/[briefId]/annotations/route.ts");
  const remove = source("app/api/brief/[briefId]/annotations/[annotationId]/route.ts");
  for (const route of [create, remove]) {
    assert.match(route, /hasTrustedMutationOrigin/);
    assert.match(route, /supabase\.auth\.getUser\(\)/);
    assert.match(route, /awaiting_customer/);
  }
  assert.match(create, /readBoundedJsonBody/);
  assert.match(create, /render_path/);
  assert.match(create, /author_role: "tailor"/);
  assert.match(remove, /\.eq\("revision_id", revisionResult\.data\.id\)/);
});

test("migration 018 grants only tailor-scoped spatial writes and remains rerunnable", () => {
  const migration = source("supabase/migrations/20260812002200_spatial_agreement_notes.sql");
  assert.match(migration, /current_migration not in \(17, 18\)/);
  assert.match(migration, /grant select on table public\.annotation to authenticated/);
  assert.match(migration, /grant insert \(revision_id, author_role, anchor_x, anchor_y, body\)/);
  assert.match(migration, /grant delete on table public\.annotation to authenticated/);
  assert.match(migration, /author_role = 'tailor'/);
  assert.match(migration, /shop\.owner_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /grant update/);
  assert.doesNotMatch(migration, /to anon|to public/);
});

test("workspace exposes a click-to-pin result and frozen snapshots already include notes", () => {
  const workspace = source("app/components/TailorWorkspace.tsx");
  const snapshot = source("supabase/migrations/20260812000800_review_freeze_and_integrity.sql");
  assert.match(workspace, /Pin the construction detail/);
  assert.match(workspace, /className=\{`design-pin \$\{/);
  assert.match(workspace, /addPinnedNote/);
  assert.match(snapshot, /'annotations'[\s\S]*from public\.annotation/);
});
test("migration 019 binds every new pin to a same-revision requirement", () => {
  const migration = source("supabase/migrations/20260812003000_requirement_linked_agreement_map.sql");
  const route = source("app/api/brief/[briefId]/annotations/route.ts");
  const workspace = source("app/components/TailorWorkspace.tsx");
  const customer = source("app/components/CustomerReview.tsx");
  assert.match(migration, /current_migration not in \(18, 19\)/);
  assert.match(migration, /requirement_id uuid references public\.requirement\(id\) on delete restrict/);
  assert.match(migration, /Pinned requirement must belong to the same revision/);
  assert.match(migration, /'requirement_id', a\.requirement_id/);
  assert.match(route, /\.eq\("id", parsed\.value\.requirementId\)[\s\S]*\.eq\("revision_id", revisionResult\.data\.id\)/);
  assert.match(workspace, /Non-negotiable this pin explains/);
  assert.match(customer, /Requirement-linked agreement map/);
  assert.match(customer, /annotationStatus/);
});
