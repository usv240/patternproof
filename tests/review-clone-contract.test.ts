import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

function sqlFunction(sql: string, name: string, nextName: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const end = sql.indexOf(`create or replace function public.${nextName}`, start);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} must precede ${nextName}`);
  return sql.slice(start, end);
}

test("review withdrawal follows reserve, verified target readback, then commit", () => {
  const route = source("app/api/brief/[briefId]/withdraw-review/route.ts");

  const reserve = route.indexOf('rpc("reserve_review_revision_clone"');
  const sourceRead = route.indexOf("download(reservation.source_body_path)");
  const targetWrite = route.indexOf("upload(reservation.target_body_path");
  const targetRead = route.indexOf("download(reservation.target_body_path)");
  const targetHash = route.indexOf(
    "digest(Buffer.from(await targetBody.data.arrayBuffer()))",
  );
  const commit = route.indexOf("let committed = await commitClone", targetHash);

  assert.ok(reserve >= 0, "the route must reserve a fenced clone");
  assert.ok(sourceRead > reserve, "source reads must follow reservation");
  assert.ok(targetWrite > sourceRead, "target writes must follow source reads");
  assert.ok(targetRead > targetWrite, "stored target bytes must be read back");
  assert.ok(targetHash > targetRead, "hashes must come from target readback");
  assert.ok(commit > targetHash, "commit must receive verified target hashes");
  assert.match(route, /rpc\("commit_review_revision_clone"/);
  assert.match(route, /p_body_sha256:\s*hashes\.body/);
  assert.match(route, /p_reference_sha256:\s*hashes\.reference/);
  assert.match(route, /committed = await commitClone[\s\S]*committed = await commitClone/);
});

test("abort cleanup is fenced and never deletes a concurrently committed target", () => {
  const route = source("app/api/brief/[briefId]/withdraw-review/route.ts");
  const abandonStart = route.indexOf("async function abandonClone");
  const commitStart = route.indexOf("async function commitClone", abandonStart);
  const abandon = route.slice(abandonStart, commitStart);

  const abort = abandon.indexOf('rpc("abort_review_revision_clone"');
  const committedGuard = abandon.indexOf("if (aborted.data !== true)");
  const remove = abandon.indexOf(".remove([");
  assert.ok(abort >= 0);
  assert.ok(committedGuard > abort);
  assert.ok(remove > committedGuard);
  assert.match(
    abandon,
    /if \(aborted\.data !== true\) \{[\s\S]*return;[\s\S]*\.remove\(\[reservation\.target_body_path, reservation\.target_reference_path\]\)/,
  );
  assert.match(
    route,
    /if \(admin && reservation && \(!commitAttempted \|\| commitConfirmedFailed\)\)/,
  );
});

test("legacy one-step withdrawal is absent from the route and revoked in SQL", () => {
  const route = source("app/api/brief/[briefId]/withdraw-review/route.ts");
  const lockdown = source("supabase/migrations/20260812001600_review_clone_saga_lockdown.sql");

  assert.doesNotMatch(route, /withdraw_customer_review/);
  assert.match(
    lockdown,
    /revoke execute on function public\.withdraw_customer_review\(uuid, text\)\s+from service_role/,
  );
  assert.match(
    lockdown,
    /create unique index review_revision_clone_one_active_brief_idx[\s\S]*where state = 'reserved'/,
  );
});

test("database commit publishes the editable revision atomically after evidence checks", () => {
  const migration = source("supabase/migrations/20260812001500_review_clone_saga.sql");
  const reserve = sqlFunction(
    migration,
    "reserve_review_revision_clone",
    "commit_review_revision_clone",
  );
  const commit = sqlFunction(
    migration,
    "commit_review_revision_clone",
    "abort_review_revision_clone",
  );

  assert.doesNotMatch(reserve, /insert into public\.(?:revision|requirement|intake_issuance)/);
  assert.match(reserve, /pg_advisory_xact_lock/);
  assert.match(reserve, /array\[v_target_body_path, v_target_reference_path\]/);

  const provenance = commit.indexOf("Clone hashes do not match verified source provenance");
  const storage = commit.indexOf("from storage.buckets bucket");
  const withdraw = commit.indexOf("update public.review_session");
  const briefReset = commit.indexOf("update public.brief");
  const revision = commit.indexOf("insert into public.revision");
  const requirements = commit.indexOf("insert into public.requirement");
  const issuance = commit.indexOf("insert into public.intake_issuance");
  const committed = commit.indexOf("set state = 'committed'");

  assert.ok(provenance >= 0);
  assert.ok(storage > provenance, "private target objects follow hash validation");
  assert.ok(withdraw > storage, "review is withdrawn only after object evidence");
  assert.ok(briefReset > withdraw);
  assert.ok(revision > briefReset);
  assert.ok(requirements > revision);
  assert.ok(issuance > requirements);
  assert.ok(committed > issuance, "manifest commits after every relational row");

  assert.match(commit, /v_clone\.reservation_expires_at <= commit_time/);
  assert.match(commit, /where bucket\.id = 'brief-images' and not bucket\.public/);
  assert.match(commit, /v_clone\.target_reference_path, v_clone\.target_body_path, null, null/);
  assert.match(commit, /select v_clone\.target_revision_id, q\.label, q\.note, q\.created_at/);
  assert.match(commit, /'ready', 'deleted', '\{\}'::text\[\]/);
  assert.doesNotMatch(commit, /insert into public\.(?:annotation|feasibility_decision)/);
  assert.doesNotMatch(commit, /(?:update|delete from) public\.revision/);
});

test("expired and late-written targets remain in a reconciled cleanup queue", () => {
  const saga = source("supabase/migrations/20260812001500_review_clone_saga.sql");
  const reconciliation = source(
    "supabase/migrations/20260812001700_review_clone_saga_reconciliation.sql",
  );
  const sentinel = source("supabase/migrations/20260812001800_release_readiness_14.sql");
  const abort = sqlFunction(
    saga,
    "abort_review_revision_clone",
    "claim_review_revision_clone_cleanup",
  );

  assert.match(abort, /set state = 'cleanup_required'/);
  assert.match(abort, /where id = p_clone_id and state = 'reserved'/);
  assert.match(
    reconciliation,
    /c\.state = 'cleaned'[\s\S]*object\.name = any\(c\.cleanup_object_paths\)/,
  );
  assert.match(reconciliation, /for update skip locked/);
  assert.match(
    reconciliation,
    /if cleanup_succeeded and exists \([\s\S]*object\.name = any\(c\.cleanup_object_paths\)[\s\S]*cleanup_succeeded := false/,
  );
  assert.match(
    reconciliation,
    /state = case[\s\S]*when cleanup_succeeded then 'cleaned'[\s\S]*else 'cleanup_required'/,
  );
  assert.match(sentinel, /values \(true, 14, clock_timestamp\(\)\)/);
});
