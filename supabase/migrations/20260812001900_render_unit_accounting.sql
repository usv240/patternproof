-- Correct YouCam Clothes VTO V3 accounting to two units per vendor attempt.
-- Run after 014_release_readiness.sql. This migration is transactionally safe
-- to rerun after sentinel 15 has already been installed.

begin;

-- Lock the singleton for the whole migration. An upgrade must start at 014;
-- accepting 015 makes an exact rerun a no-op for the one-time budget backfill.
do $$
declare
  current_migration integer;
begin
  select release.migration
  into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;

  if current_migration is null then
    raise exception 'PatternProof release sentinel is missing; expected migration 14'
      using errcode = '55000';
  end if;

  if current_migration not in (14, 15) then
    raise exception 'Migration 015 requires release sentinel 14 (or 15 for an idempotent rerun), found %',
      current_migration
      using errcode = '55000';
  end if;
end;
$$;

alter table public.render_usage
  add column if not exists units_consumed integer;

-- Existing ledger rows represented admitted Clothes VTO V3 vendor attempts.
-- Backfill them to the authenticated provider cost and freeze that provenance.
update public.render_usage
set units_consumed = 2
where units_consumed is distinct from 2;

alter table public.render_usage
  alter column units_consumed set default 2,
  alter column units_consumed set not null;

alter table public.render_usage
  drop constraint if exists render_usage_units_consumed_exact_check;

alter table public.render_usage
  add constraint render_usage_units_consumed_exact_check
    check (units_consumed = 2);

-- Migration 008 counted one unit per admitted attempt. Correct legacy totals
-- exactly once, without violating the operator's existing hard ceiling. The
-- sentinel predicate is false on every rerun after this transaction commits.
update public.render_budget budget
set consumed_units = least(budget.max_units, budget.consumed_units * 2),
    updated_at = clock_timestamp()
where budget.id = 'youcam-cloth-v3'
  and exists (
    select 1
    from public.patternproof_release release
    where release.singleton = true
      and release.migration = 14
  );

do $$
begin
  if not exists (
    select 1
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
  ) then
    raise exception 'YouCam Clothes VTO render budget is missing'
      using errcode = '55000';
  end if;
end;
$$;

-- Returns true for both a newly charged attempt and an exact already-spent
-- attempt. A new attempt's ledger insert and two-unit increment commit as one
-- transaction; raising on exhaustion rolls back the inserted usage row.
create or replace function public.consume_render_budget(
  p_job_id uuid,
  p_attempt_number integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.render_job%rowtype;
  usage_inserted uuid;
  budget_updated text;
  recent_owner_calls integer;
  unit_cost constant integer := 2;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  -- A repeated call after an ambiguous RPC acknowledgement must not require a
  -- still-live reservation and must never charge the exact attempt twice.
  if exists (
    select 1
    from public.render_usage usage
    where usage.job_id = p_job_id
      and usage.attempt_number = p_attempt_number
  ) then
    return true;
  end if;

  select render.* into job
  from public.render_job render
  where render.id = p_job_id
    and render.status = 'reserved'
    and render.task_id is null
    and render.attempt_count = p_attempt_number
    and render.reservation_expires_at > clock_timestamp()
  for update;

  if not found then
    -- The job may have advanced while a concurrent first consumer committed.
    return exists (
      select 1
      from public.render_usage usage
      where usage.job_id = p_job_id
        and usage.attempt_number = p_attempt_number
    );
  end if;

  if exists (
    select 1
    from public.render_usage usage
    where usage.job_id = p_job_id
      and usage.attempt_number = p_attempt_number
  ) then
    return true;
  end if;

  -- Distinct jobs from one owner must not all pass the rolling-window ceiling
  -- concurrently. The ceiling remains five vendor attempts per five minutes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(job.requested_by::text, 80803)
  );

  select count(*) into recent_owner_calls
  from public.render_usage usage
  where usage.requested_by = job.requested_by
    and usage.consumed_at >= clock_timestamp() - interval '5 minutes';

  if recent_owner_calls >= 5 then
    raise exception 'durable owner render limit reached' using errcode = 'P0001';
  end if;

  -- Serialize consumers on the singleton. The insert precedes the conditional
  -- increment only inside this transaction; an exhaustion exception rolls both
  -- operations back, so no uncharged provenance row can survive.
  perform 1
  from public.render_budget budget
  where budget.id = 'youcam-cloth-v3'
  for update;

  if not found then
    raise exception 'global render budget is unavailable' using errcode = '55000';
  end if;

  insert into public.render_usage (
    job_id,
    attempt_number,
    requested_by,
    units_consumed
  ) values (
    job.id,
    p_attempt_number,
    job.requested_by,
    unit_cost
  )
  on conflict (job_id, attempt_number) do nothing
  returning job_id into usage_inserted;

  if usage_inserted is null then
    return true;
  end if;

  update public.render_budget budget
  set consumed_units = budget.consumed_units + unit_cost,
      updated_at = clock_timestamp()
  where budget.id = 'youcam-cloth-v3'
    and budget.consumed_units + unit_cost <= budget.max_units
  returning budget.id into budget_updated;

  if budget_updated is null then
    raise exception 'global render budget exhausted' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

revoke all on function public.consume_render_budget(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_render_budget(uuid, integer)
  to service_role;

-- Advancing this row is last: every schema/function/backfill change above must
-- commit before health checks may recognize release 15.
update public.patternproof_release
set migration = 15,
    installed_at = clock_timestamp()
where singleton = true
  and migration = 14;

do $$
begin
  if not exists (
    select 1
    from public.patternproof_release release
    where release.singleton = true
      and release.migration = 15
  ) then
    raise exception 'Migration 015 could not advance the release sentinel'
      using errcode = '55000';
  end if;
end;
$$;

commit;
