import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

function budgetFunction(sql: string): string {
  const start = sql.indexOf(
    "create or replace function public.consume_render_budget",
  );
  const end = sql.indexOf(
    "revoke all on function public.consume_render_budget",
    start,
  );
  assert.ok(start >= 0, "consume_render_budget must be replaced");
  assert.ok(end > start, "the replacement function must have a bounded body");
  return sql.slice(start, end);
}

test("migration 015 is fenced by release 14 and rerun-safe at release 15", () => {
  const migration = source("supabase/migrations/20260812001900_render_unit_accounting.sql");

  assert.match(migration, /current_migration not in \(14, 15\)/);
  assert.match(
    migration,
    /from public\.patternproof_release release[\s\S]*for update/,
  );
  assert.match(
    migration,
    /least\(budget\.max_units, budget\.consumed_units \* 2\)/,
  );
  assert.match(
    migration,
    /where release\.singleton = true\s+and release\.migration = 14/,
  );
  assert.match(
    migration,
    /set migration = 15,[\s\S]*where singleton = true\s+and migration = 14/,
  );
});

test("every usage row records the exact authenticated two-unit cost", () => {
  const migration = source("supabase/migrations/20260812001900_render_unit_accounting.sql");

  assert.match(migration, /add column if not exists units_consumed integer/);
  assert.match(
    migration,
    /set units_consumed = 2\s+where units_consumed is distinct from 2/,
  );
  assert.match(migration, /alter column units_consumed set default 2/);
  assert.match(migration, /alter column units_consumed set not null/);
  assert.match(migration, /check \(units_consumed = 2\)/);
});

test("exact spent attempts are idempotent and new attempts charge two atomically", () => {
  const fn = budgetFunction(source("supabase/migrations/20260812001900_render_unit_accounting.sql"));
  const earlyUsageCheck = fn.indexOf("from public.render_usage usage");
  const jobLock = fn.indexOf("from public.render_job render");
  const usageInsert = fn.indexOf("insert into public.render_usage");
  const budgetUpdate = fn.indexOf("update public.render_budget budget");
  const exhausted = fn.indexOf("global render budget exhausted");

  assert.ok(earlyUsageCheck >= 0 && earlyUsageCheck < jobLock);
  assert.match(fn, /unit_cost constant integer := 2/);
  assert.match(
    fn,
    /job_id,\s+attempt_number,\s+requested_by,\s+units_consumed[\s\S]*job\.requested_by,\s+unit_cost/,
  );
  assert.match(
    fn,
    /consumed_units = budget\.consumed_units \+ unit_cost/,
  );
  assert.match(
    fn,
    /budget\.consumed_units \+ unit_cost <= budget\.max_units/,
  );
  assert.ok(usageInsert >= 0 && budgetUpdate > usageInsert);
  assert.ok(exhausted > budgetUpdate, "exhaustion must raise after the insert");
  assert.match(fn, /raise exception 'global render budget exhausted'/);
});

test("health readiness requires the erasure-claim fix sentinel", () => {
  const health = source("app/api/health/route.ts");

  assert.match(health, /\.eq\("migration", 20\)/);
  assert.doesNotMatch(health, /\.eq\("migration", 16\)/);
});
