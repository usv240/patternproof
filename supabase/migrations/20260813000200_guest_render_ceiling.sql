-- Bound zero-login guest workspaces to two lifetime YouCam attempts.
-- Permanent email-backed pilot users retain the rolling owner ceiling.
begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;
  if current_migration not in (20, 21) then
    raise exception 'Migration 021 requires release 20 (or 21 for rerun), found %', current_migration;
  end if;
end;
$$;

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
  lifetime_owner_calls integer;
  guest_user boolean;
  unit_cost constant integer := 2;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.render_usage usage
    where usage.job_id = p_job_id and usage.attempt_number = p_attempt_number
  ) then return true; end if;

  select render.* into job
  from public.render_job render
  where render.id = p_job_id
    and render.status = 'reserved'
    and render.task_id is null
    and render.attempt_count = p_attempt_number
    and render.reservation_expires_at > clock_timestamp()
  for update;

  if not found then
    return exists (
      select 1 from public.render_usage usage
      where usage.job_id = p_job_id and usage.attempt_number = p_attempt_number
    );
  end if;

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

  select coalesce(auth_user.is_anonymous, false)
  into guest_user
  from auth.users auth_user
  where auth_user.id = job.requested_by;

  if guest_user then
    select count(*) into lifetime_owner_calls
    from public.render_usage usage
    where usage.requested_by = job.requested_by;
    if lifetime_owner_calls >= 2 then
      raise exception 'guest render limit reached' using errcode = 'P0001';
    end if;
  end if;

  perform 1 from public.render_budget budget
  where budget.id = 'youcam-cloth-v3' for update;
  if not found then
    raise exception 'global render budget is unavailable' using errcode = '55000';
  end if;

  insert into public.render_usage (job_id, attempt_number, requested_by, units_consumed)
  values (job.id, p_attempt_number, job.requested_by, unit_cost)
  on conflict (job_id, attempt_number) do nothing
  returning job_id into usage_inserted;
  if usage_inserted is null then return true; end if;

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
grant execute on function public.consume_render_budget(uuid, integer) to service_role;

update public.patternproof_release
set migration = 21, installed_at = clock_timestamp()
where singleton = true and migration = 20;

do $$ begin
  if not exists (select 1 from public.patternproof_release where singleton and migration = 21) then
    raise exception 'Migration 021 did not advance the release sentinel';
  end if;
end; $$;

commit;