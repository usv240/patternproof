-- Durable vendor-call budget. Run after 005_render_idempotency.sql.
-- This gate is consumed immediately before the server makes a YouCam POST;
-- direct database job rows cannot spend vendor credits.

create table if not exists public.render_budget (
  id text primary key check (id = 'youcam-cloth-v3'),
  max_units integer not null check (max_units between 1 and 1000000),
  consumed_units integer not null default 0
    check (consumed_units between 0 and max_units),
  updated_at timestamptz not null default now()
);

insert into public.render_budget (id, max_units, consumed_units)
values ('youcam-cloth-v3', 900, 0)
on conflict (id) do nothing;

create table if not exists public.render_usage (
  job_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 3),
  requested_by uuid not null,
  consumed_at timestamptz not null default now(),
  primary key (job_id, attempt_number)
);

create index if not exists render_usage_requester_time_idx
  on public.render_usage (requested_by, consumed_at desc);

alter table public.render_budget enable row level security;
alter table public.render_usage enable row level security;
revoke all on public.render_budget from public, anon, authenticated;
revoke all on public.render_usage from public, anon, authenticated;

-- Returns true both for a newly consumed unit and an already-consumed exact
-- attempt. It raises when the durable per-owner or global circuit breaker is hit.
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
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select j.* into job
  from public.render_job j
  where j.id = p_job_id
    and j.status = 'reserved'
    and j.task_id is null
    and j.attempt_count = p_attempt_number
    and j.reservation_expires_at > clock_timestamp()
  for update;

  if not found then
    return false;
  end if;

  if exists (
    select 1 from public.render_usage u
    where u.job_id = p_job_id and u.attempt_number = p_attempt_number
  ) then
    return true;
  end if;

  -- Distinct jobs from one owner must not all pass the rolling-window count
  -- concurrently. This lock is transaction-scoped and owner-specific.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(job.requested_by::text, 80803)
  );

  select count(*) into recent_owner_calls
  from public.render_usage u
  where u.requested_by = job.requested_by
    and u.consumed_at >= clock_timestamp() - interval '5 minutes';

  if recent_owner_calls >= 5 then
    raise exception 'durable owner render limit reached' using errcode = 'P0001';
  end if;

  -- Serialize consumers on the singleton row. The usage insert and budget
  -- increment commit together, so concurrent requests cannot overspend.
  perform 1 from public.render_budget b
  where b.id = 'youcam-cloth-v3'
  for update;

  insert into public.render_usage (
    job_id,
    attempt_number,
    requested_by
  ) values (
    job.id,
    p_attempt_number,
    job.requested_by
  )
  on conflict (job_id, attempt_number) do nothing
  returning job_id into usage_inserted;

  if usage_inserted is null then
    return true;
  end if;

  update public.render_budget b
  set consumed_units = b.consumed_units + 1,
      updated_at = clock_timestamp()
  where b.id = 'youcam-cloth-v3'
    and b.consumed_units < b.max_units
  returning b.id into budget_updated;

  if budget_updated is null then
    raise exception 'global render budget exhausted' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

revoke all on function public.consume_render_budget(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.consume_render_budget(uuid, integer)
  to service_role;

-- Operators can raise/lower max_units or reset consumed_units only through a
-- reviewed service-role SQL change. No browser policy exposes the budget.
