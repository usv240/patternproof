import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const migration = readFileSync(
  `${root}supabase/migrations/20260812002000_access_privileges.sql`,
  "utf8",
);

const authenticatedFunctionSignatures = [
  "get_or_create_owned_shop(text)",
  "assert_revision_editable(uuid)",
];

const serviceFunctionSignatures = [
  "abort_reserved_render_attempt(uuid, integer)",
  "abort_review_revision_clone(uuid, text)",
  "activate_intake_issuance(uuid)",
  "approve_shared_revision(text, uuid, text)",
  "attach_reserved_render_task(uuid, integer, text)",
  "build_revision_snapshot(uuid)",
  "can_approve_revision(uuid)",
  "claim_body_photo_erasure(uuid)",
  "claim_body_photo_erasure_cleanup(integer)",
  "claim_intake_cleanup(integer)",
  "claim_intake_finalization(uuid, uuid, uuid)",
  "claim_review_revision_clone_cleanup(integer)",
  "commit_intake_finalization(uuid, uuid, jsonb, jsonb)",
  "commit_review_revision_clone(uuid, text, text)",
  "complete_body_photo_erasure(uuid, uuid, boolean, text)",
  "complete_intake_cleanup(uuid, uuid, boolean, text)",
  "complete_review_revision_clone_cleanup(uuid, uuid, boolean, text)",
  "consume_render_budget(uuid, integer)",
  "create_intake_reservation(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz)",
  "discard_incomplete_intake_draft(uuid, uuid)",
  "reconcile_claimed_intake_cleanup(uuid, uuid)",
  "release_intake_finalization(uuid, uuid, text, boolean)",
  "reserve_render_job(uuid, text, text, text, uuid)",
  "reserve_review_revision_clone(uuid, uuid, text)",
  "start_customer_review(uuid, uuid, text, timestamptz)",
];

function between(start: string, end: string): string {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing section: ${start}`);
  assert.ok(to > from, `unbounded section: ${start}`);
  return migration.slice(from, to);
}

test("migration 016 is fenced by release 15 and exactly rerunnable at 16", () => {
  assert.match(migration, /current_migration not in \(15, 16\)/);
  assert.match(
    migration,
    /from public\.patternproof_release release[\s\S]*for update/,
  );
  assert.match(
    migration,
    /set migration = 16,[\s\S]*where singleton = true\s+and migration = 15/,
  );
});

test("browser roles lose inherited table powers and regain only owned app paths", () => {
  const authenticated = between(
    "-- Authenticated server-rendered and route-handler reads.",
    "-- Direct admin-client reads",
  );

  assert.match(
    migration,
    /revoke all privileges on table[\s\S]*public\.review_revision_clone[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public[\s\S]*revoke all privileges on tables from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /alter default privileges for role postgres\s+revoke execute on functions from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /revoke all privileges on all functions in schema public\s+from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_or_create_owned_shop\(text\)[\s\S]*to authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.assert_revision_editable\(uuid\)[\s\S]*to authenticated/,
  );

  assert.match(
    authenticated,
    /public\.shop,[\s\S]*public\.review_session,[\s\S]*public\.body_photo_erasure[\s\S]*to authenticated/,
  );
  assert.match(
    authenticated,
    /grant insert \(revision_id, label, note\)[\s\S]*public\.requirement to authenticated/,
  );
  assert.match(
    authenticated,
    /grant insert \(requirement_id, status, tailor_note\)[\s\S]*public\.feasibility to authenticated/,
  );
  assert.match(
    authenticated,
    /grant update \(status, tailor_note\)[\s\S]*public\.feasibility to authenticated/,
  );
  assert.doesNotMatch(authenticated, /public\.annotation/);
  assert.doesNotMatch(authenticated, /grant delete|grant truncate|grant trigger/i);
});

test("service table grants exclude RPC-only ledgers and use column writes", () => {
  const service = between(
    "-- Direct admin-client reads",
    "-- Storage schema ACLs are platform-owned",
  );

  assert.match(
    service,
    /public\.shop,[\s\S]*public\.annotation,[\s\S]*public\.patternproof_release[\s\S]*to service_role/,
  );
  assert.match(service, /grant update \([\s\S]*\) on table public\.brief to service_role/);
  assert.match(service, /grant update \(render_path, render_hash, locked_at\)/);
  assert.match(service, /grant insert \([\s\S]*\) on table public\.approval to service_role/);
  assert.doesNotMatch(service, /public\.render_budget/);
  assert.doesNotMatch(service, /public\.render_usage/);
  assert.doesNotMatch(service, /public\.review_revision_clone/);
  assert.doesNotMatch(service, /grant delete|grant truncate|grant trigger/i);
  assert.doesNotMatch(service, /grant update \(state, ended_at, reason\)/);
});

test("public function EXECUTE is reset to exact authenticated and service allowlists", () => {
  const authenticatedGrants = Array.from(
    migration.matchAll(
      /grant execute on function public\.([^\r\n]+)\s+to authenticated;/g,
    ),
    (match) => match[1],
  );
  const serviceGrants = Array.from(
    migration.matchAll(
      /grant execute on function public\.([^\r\n]+) to service_role;/g,
    ),
    (match) => match[1],
  );

  assert.deepEqual(authenticatedGrants, authenticatedFunctionSignatures);
  assert.deepEqual(serviceGrants, serviceFunctionSignatures);
});

test("private Storage read policy binds the outer object path", () => {
  const storagePolicy = between(
    "drop policy if exists \"shop owners can upload brief images\"",
    "update public.patternproof_release",
  );

  assert.match(
    storagePolicy,
    /storage\.foldername\(storage\.objects\.name\)/,
  );
  assert.match(
    storagePolicy,
    /drop policy if exists "owners can upload to unlocked revisions"/,
  );
  assert.match(
    storagePolicy,
    /drop policy if exists "owners can delete from unlocked revisions"/,
  );
  assert.match(
    storagePolicy,
    /policy\.roles && array\['public', 'anon', 'authenticated'\]::name\[\]/,
  );
  assert.match(storagePolicy, /relation\.relrowsecurity/);
  assert.match(storagePolicy, /storage\.objects RLS must remain enabled/);
  assert.doesNotMatch(storagePolicy, /storage\.foldername\(name\)/);
});
