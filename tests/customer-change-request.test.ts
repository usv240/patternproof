import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260813000100_customer_change_requests.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/share/[token]/request-change/route.ts", import.meta.url),
  "utf8",
);
const approvalRoute = readFileSync(
  new URL("../app/api/share/[token]/approve/route.ts", import.meta.url),
  "utf8",
);

test("migration 020 binds one open customer veto to an exact frozen revision", () => {
  assert.match(migration, /current_migration not in \(19, 20\)/);
  assert.match(migration, /source_version integer not null check \(source_version >= 1\)/);
  assert.match(migration, /customer_change_request_one_open_brief_idx[\s\S]*where state = 'open'/);
  assert.match(migration, /from public\.brief b[\s\S]*for update;/);
  assert.match(migration, /shared_revision_id is distinct from p_shared_revision_id/);
  assert.match(migration, /shared_snapshot_sha256 is distinct from p_shared_snapshot_sha256/);
  assert.match(migration, /token_expires_at <= clock_timestamp\(\)/);
});

test("approval and customer veto are serialized and cannot both win", () => {
  assert.match(migration, /approval_customer_change_guard/);
  assert.match(migration, /before insert on public\.approval/);
  assert.match(migration, /Customer requested a new revision/);
  assert.match(migration, /old\.status = 'awaiting_customer' and new\.status = 'awaiting_tailor'/);
  assert.match(migration, /set state = 'accepted', resolved_at = clock_timestamp\(\)/);
  assert.match(migration, /create or replace function public\.request_shared_revision_change[\s\S]*security definer/);
});

test("the bearer-link mutation is bounded, origin checked, and identity checked", () => {
  assert.match(route, /hasTrustedMutationOrigin\(request\)/);
  assert.match(route, /readBoundedJsonBody\(request, MAX_BODY_BYTES\)/);
  assert.match(route, /isPublicDemoToken\(token\).*read-only/);
  assert.match(route, /hashShareToken\(token\)/);
  assert.match(route, /row\.revision_id !== input\.revisionId/);
  assert.match(route, /row\.snapshot_sha256 !== input\.snapshotSha256/);
  assert.doesNotMatch(route, /request\.(?:json|text)\(\)/);
  assert.ok(route.indexOf("isPublicDemoToken(token)") < route.indexOf("isSupabaseAdminConfigured()"));
});

test("both customer outcomes remain private, no-store mutations", () => {
  for (const source of [route, approvalRoute]) {
    assert.match(source, /"Cache-Control": "private, no-store"/);
    assert.match(source, /"Referrer-Policy": "no-referrer"/);
  }
  assert.match(migration, /grant select on table public\.customer_change_request to authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.request_shared_revision_change\(text, uuid, text, text\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete) on table public\.customer_change_request/);
});
