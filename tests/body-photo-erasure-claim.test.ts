import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const migration = readFileSync(
  `${root}supabase/migrations/20260812002100_body_photo_erasure_claim_fix.sql`,
  "utf8",
);

test("migration 017 removes the ambiguous erasure conflict target", () => {
  assert.match(
    migration,
    /create or replace function public\.claim_body_photo_erasure\(p_brief_id uuid\)/,
  );
  assert.match(
    migration,
    /on conflict on constraint body_photo_erasure_revision_id_key do nothing/,
  );
  assert.doesNotMatch(
    migration,
    /on conflict\s*\(\s*revision_id\s*\)/,
  );
});

test("migration 017 is fenced, rerunnable, and advances readiness", () => {
  assert.match(migration, /current_migration not in \(16, 17\)/);
  assert.match(
    migration,
    /from public\.patternproof_release release[\s\S]*for update/,
  );
  assert.match(
    migration,
    /set migration = 17,[\s\S]*where singleton = true\s+and migration = 16/,
  );
  assert.match(
    migration,
    /revoke all on function public\.claim_body_photo_erasure\(uuid\)[\s\S]*grant execute[\s\S]*to service_role/,
  );
});
