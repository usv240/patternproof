import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

test("intake creation uses one relational reservation transaction", () => {
  const route = source("app/api/brief/intake/session/route.ts");
  const migration = source("supabase/migrations/20260812001300_intake_atomicity.sql");

  assert.match(route, /rpc\("create_intake_reservation"/);
  assert.doesNotMatch(route, /reserve_intake_issuance/);
  assert.doesNotMatch(route, /\.from\("(?:brief|consent|revision)"\)\s*\.insert/);
  assert.match(migration, /create or replace function public\.create_intake_reservation/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /insert into public\.brief[\s\S]*insert into public\.consent[\s\S]*insert into public\.revision[\s\S]*insert into public\.intake_issuance/);
});

test("finalization is fenced and publishes ready state atomically", () => {
  const route = source("app/api/brief/intake/finalize/route.ts");
  const migration = source("supabase/migrations/20260812001300_intake_atomicity.sql");

  assert.match(route, /rpc\("claim_intake_finalization"/);
  assert.match(route, /rpc\("commit_intake_finalization"/);
  assert.match(route, /isReadyInDatabase/);
  assert.doesNotMatch(route, /state:\s*"finalizing"/);
  assert.match(migration, /finalization_claim_id uuid/);
  assert.match(migration, /finalization_claimed_at timestamptz/);
  assert.match(migration, /interval '15 minutes'/);

  const commitStart = migration.indexOf(
    "create or replace function public.commit_intake_finalization",
  );
  const releaseStart = migration.indexOf(
    "create or replace function public.release_intake_finalization",
  );
  const commitBody = migration.slice(commitStart, releaseStart);
  assert.match(commitBody, /update public\.revision[\s\S]*update public\.intake_issuance/);
  assert.match(commitBody, /state = 'ready'/);
});

test("cleanup records its exact object manifest before draft deletion", () => {
  const route = source("app/api/maintenance/intake-cleanup/route.ts");
  const migration = source("supabase/migrations/20260812001300_intake_atomicity.sql");

  assert.match(route, /const BATCH_SIZE = 15/);
  assert.match(route, /const MAX_INTAKE_CLAIMS = 100/);
  assert.match(route, /const INTAKE_DRAIN_BUDGET_MS = 35_000/);
  assert.match(route, /rpc\("reconcile_claimed_intake_cleanup"/);
  assert.doesNotMatch(route, /\.from\("brief"\)/);

  const reconcileStart = migration.indexOf(
    "create or replace function public.reconcile_claimed_intake_cleanup",
  );
  const discardStart = migration.indexOf(
    "create or replace function public.discard_incomplete_intake_draft",
  );
  const reconcileBody = migration.slice(reconcileStart, discardStart);
  assert.ok(reconcileBody.indexOf("set cleanup_object_paths = v_paths") >= 0);
  assert.ok(
    reconcileBody.indexOf("set cleanup_object_paths = v_paths")
      < reconcileBody.indexOf("delete from public.brief"),
  );
  assert.match(reconcileBody, /order by i\.id[\s\S]*for update/);
  assert.match(reconcileBody, /order by r\.id[\s\S]*for update/);
});

test("explicit draft discard is a service-only manifest-first RPC", () => {
  const route = source("app/api/brief/intake/session/route.ts");
  const migration = source("supabase/migrations/20260812001300_intake_atomicity.sql");

  assert.match(route, /rpc\("discard_incomplete_intake_draft"/);
  const discardStart = migration.indexOf(
    "create or replace function public.discard_incomplete_intake_draft",
  );
  const completeStart = migration.indexOf(
    "create or replace function public.complete_intake_cleanup",
  );
  const discardBody = migration.slice(discardStart, completeStart);
  assert.ok(discardBody.indexOf("cleanup_object_paths =") >= 0);
  assert.ok(
    discardBody.indexOf("cleanup_object_paths =")
      < discardBody.indexOf("delete from public.brief"),
  );
  assert.match(
    migration,
    /grant execute on function public\.discard_incomplete_intake_draft\(uuid, uuid\)\s+to service_role/,
  );
});
