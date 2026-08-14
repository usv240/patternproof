import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("zero-login entry silently creates an isolated anonymous session", () => {
  const route = source("app/api/auth/guest/route.ts");
  const button = source("app/components/GuestWorkspaceButton.tsx");
  const entry = source("app/components/CutCardEntry.tsx");
  assert.match(route, /hasTrustedMutationOrigin/);
  assert.match(route, /supabase\.auth\.signInAnonymously\(\)/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(button, /fetch\("\/api\/auth\/guest"/);
  assert.match(button, /window\.location\.assign\("\/brief\/new"\)/);
  assert.match(source("app/create/page.tsx"), /No account needed/);
  assert.match(source("app/components/SampleCutCard.tsx"), /GuestWorkspaceButton/);
  assert.doesNotMatch(entry, /Sign-in required|Sign in to continue/);
});

test("anonymous auth is enabled locally and guest render spend is lifetime bounded", () => {
  const config = source("supabase/config.toml");
  const migration = source("supabase/migrations/20260813000200_guest_render_ceiling.sql");
  assert.match(config, /enable_anonymous_sign_ins = true/);
  assert.match(migration, /auth_user\.is_anonymous/);
  assert.match(migration, /lifetime_owner_calls >= 2/);
  assert.match(migration, /guest render limit reached/);
  assert.match(migration, /set migration = 21/);
});

test("guest pages preserve tenant isolation instead of exposing public data", () => {
  const intake = source("app/api/brief/intake/session/route.ts");
  const policies = source("supabase/migrations/20260812002000_access_privileges.sql");
  assert.match(intake, /supabase\.auth\.getUser\(\)/);
  assert.match(intake, /p_owner_id: ownerId/);
  assert.match(policies, /owner_shop\.owner_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(policies, /to anon[\s\S]*grant select on table/);
});