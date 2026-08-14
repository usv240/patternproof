import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("migration 022 preserves consent immutability while allowing a fenced parent cascade", () => {
  const sql = source("supabase/migrations/20260814000100_draft_discard_consent_cascade.sql");
  assert.match(sql, /current_migration not in \(21, 22\)/);
  assert.match(sql, /as \$\$\r?\n/);
  assert.match(sql, /\r?\n\$\$;\r?\n\r?\nupdate public\.patternproof_release/);
  assert.equal((sql.match(/as \$\$/g) ?? []).length, 2, "each PL/pgSQL function uses intact dollar-quote delimiters");
  assert.match(sql, /tg_op = 'DELETE' and not exists/);
  assert.match(sql, /select 1 from public\.brief b where b\.id = bid/);
  assert.match(sql, /Consent for a reviewed Cut Card is immutable/);
  assert.ok(
    sql.indexOf("return query") < sql.indexOf("delete from public.brief"),
    "the cleanup response must be captured before ON DELETE SET NULL",
  );
  assert.match(sql, /set migration = 22/);
});

test("health requires the draft-discard consent-cascade fix", () => {
  const health = source("app/api/health/route.ts");
  assert.match(health, /eq\("migration", 22\)/);
});
