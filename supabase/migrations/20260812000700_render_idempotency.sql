-- Reserve YouCam work before making the external API call.
-- Run after 004_storage_and_shop_integrity.sql.

-- A reservation exists before YouCam returns its task ID.
alter table public.render_job
  alter column task_id drop not null,
  add column normalized_image_hash text,
  add column garment_category text,
  add column api_version text,
  add column attempt_count integer not null default 1,
  add column reservation_expires_at timestamptz,
  add column prior_task_ids text[] not null default '{}'::text[];

alter table public.render_job
  drop constraint if exists render_job_status_check;

alter table public.render_job
  add constraint render_job_status_check
    check (status in ('reserved', 'deferred', 'running', 'success', 'error', 'timeout')),
  add constraint render_job_attempt_count_check
    check (attempt_count between 1 and 3),
  add constraint render_job_hash_format_check
    check (
      normalized_image_hash is null
      or normalized_image_hash ~ '^[0-9a-f]{64}$'
    ),
  add constraint render_job_category_check
    check (
      garment_category is null
      or garment_category in ('auto', 'full_body', 'upper_body', 'lower_body')
    ),
  add constraint render_job_api_version_check
    check (
      api_version is null
      or (
        api_version = lower(trim(api_version))
        and char_length(api_version) between 1 and 64
        and api_version ~ '^[a-z0-9][a-z0-9._/-]*$'
      )
    ),
  add constraint render_job_idempotency_fields_check
    check (
      num_nonnulls(normalized_image_hash, garment_category, api_version)
      in (0, 3)
    ),
  add constraint render_job_reservation_shape_check
    check (
      status <> 'reserved'
      or (task_id is null and reservation_expires_at is not null)
    ),
  add constraint render_job_idempotency_key
    unique (revision_id, normalized_image_hash, garment_category, api_version);

-- The usage ledger is declared here because reservation recovery must know
-- whether a vendor call may have occurred. Migration 008 adds its indexes,
-- RLS, and global budget gate.
create table if not exists public.render_usage (
  job_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 3),
  requested_by uuid not null,
  consumed_at timestamptz not null default now(),
  primary key (job_id, attempt_number)
);

alter table public.render_usage enable row level security;
revoke all on public.render_usage from public, anon, authenticated;
-- Returns exactly one row. reserved=true grants this caller the right to make
-- one vendor POST for the returned attempt. All other callers reuse job_id.
create or replace function public.reserve_render_job(
  p_revision_id uuid,
  p_normalized_image_hash text,
  p_garment_category text,
  p_api_version text,
  p_requested_by uuid
)
returns table (
  job_id uuid,
  job_status text,
  vendor_task_id text,
  reserved boolean,
  attempt_number integer,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := p_requested_by;
  normalized_hash text := lower(trim(coalesce(p_normalized_image_hash, '')));
  normalized_category text := lower(trim(coalesce(p_garment_category, '')));
  normalized_version text := lower(trim(coalesce(p_api_version, '')));
  body_hash text;
  reference_hash text;
  expected_hash text;
  reservation_time timestamptz := clock_timestamp();
  job public.render_job%rowtype;
begin
  if (select auth.role()) <> 'service_role' or caller_id is null then
    raise exception 'Service role and requester are required' using errcode = '42501';
  end if;

  if normalized_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'normalized image hash must be SHA-256 hex'
      using errcode = '22023';
  end if;
  if normalized_category not in ('auto', 'full_body', 'upper_body', 'lower_body') then
    raise exception 'unsupported garment category' using errcode = '22023';
  end if;
  if char_length(normalized_version) not between 1 and 64
    or normalized_version !~ '^[a-z0-9][a-z0-9._/-]*$' then
    raise exception 'invalid API version' using errcode = '22023';
  end if;

  -- Lock the revision briefly so approval cannot race this reservation.
  select
    r.garment_spec #>> '{normalized_images,body,sha256}',
    r.garment_spec #>> '{normalized_images,reference,sha256}'
  into body_hash, reference_hash
  from public.revision r
  join public.brief b on b.id = r.brief_id
  join public.shop s on s.id = b.shop_id
  where r.id = p_revision_id
    and s.owner_id = caller_id
    and r.locked_at is null
  for update of r;

  if not found then
    raise exception 'Revision is unavailable or locked' using errcode = '42501';
  end if;

  if body_hash is null
    or body_hash !~ '^[0-9a-f]{64}$'
    or reference_hash is null
    or reference_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Revision normalized images are not ready' using errcode = '55000';
  end if;

  -- Contract: sha256("patternproof-render-input-v1:<body-sha256>:<reference-sha256>").
  expected_hash := encode(
    extensions.digest(
      'patternproof-render-input-v1:' || body_hash || ':' || reference_hash,
      'sha256'
    ),
    'hex'
  );
  if normalized_hash <> expected_hash then
    raise exception 'normalized image hash does not match this revision'
      using errcode = '22023';
  end if;

  insert into public.render_job (
    task_id,
    revision_id,
    requested_by,
    status,
    normalized_image_hash,
    garment_category,
    api_version,
    attempt_count,
    reservation_expires_at,
    updated_at
  )
  values (
    null,
    p_revision_id,
    caller_id,
    'reserved',
    normalized_hash,
    normalized_category,
    normalized_version,
    1,
    reservation_time + interval '5 minutes',
    reservation_time
  )
  on conflict on constraint render_job_idempotency_key do nothing
  returning * into job;

  if found then
    return query select
      job.id,
      job.status,
      job.task_id,
      true,
      job.attempt_count,
      job.reservation_expires_at;
    return;
  end if;

  -- The unique-key winner is committed before this row lock is acquired.
  select j.* into job
  from public.render_job j
  where j.revision_id = p_revision_id
    and j.normalized_image_hash = normalized_hash
    and j.garment_category = normalized_category
    and j.api_version = normalized_version
  for update;

  if not found then
    raise exception 'Reservation changed concurrently; retry the request'
      using errcode = '40001';
  end if;

  -- A pre-vendor failure releases the same attempt into a short deferred
  -- state. Reclaiming it does not consume one of the three vendor attempts.
  if (
    job.status = 'deferred'
    and job.task_id is null
    and job.updated_at <= reservation_time - interval '5 seconds'
  ) or (
    job.status = 'reserved'
    and job.task_id is null
    and job.reservation_expires_at <= reservation_time
    and not exists (
      select 1 from public.render_usage u
      where u.job_id = job.id and u.attempt_number = job.attempt_count
    )
  ) then
    update public.render_job j
    set status = 'reserved',
        reservation_expires_at = reservation_time + interval '5 minutes',
        updated_at = reservation_time
    where j.id = job.id
    returning j.* into job;

    return query select
      job.id,
      job.status,
      job.task_id,
      true,
      job.attempt_count,
      job.reservation_expires_at;
    return;
  end if;
  -- At most two controlled retries are allowed. A failed/timeout attempt has a
  -- 30-second cooldown; an abandoned pre-call reservation has a five-minute lease.
  if job.attempt_count < 3 and (
    (
      job.status in ('error', 'timeout')
      and job.updated_at <= reservation_time - interval '30 seconds'
    )
    or (
      job.status = 'reserved'
      and job.task_id is null
      and job.reservation_expires_at <= reservation_time
    )
  ) then
    update public.render_job j
    set
      prior_task_ids = case
        when j.task_id is null then j.prior_task_ids
        else array_append(j.prior_task_ids, j.task_id)
      end,
      task_id = null,
      status = 'reserved',
      requested_by = caller_id,
      attempt_count = j.attempt_count + 1,
      reservation_expires_at = reservation_time + interval '5 minutes',
      updated_at = reservation_time
    where j.id = job.id
    returning j.* into job;

    return query select
      job.id,
      job.status,
      job.task_id,
      true,
      job.attempt_count,
      job.reservation_expires_at;
    return;
  end if;

  return query select
    job.id,
    job.status,
    job.task_id,
    false,
    job.attempt_count,
    job.reservation_expires_at;
end;
$$;

-- The RPC runs only with the authenticated caller's existing table/RLS rights.
revoke all on function public.reserve_render_job(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_render_job(uuid, text, text, text, uuid)
  to service_role;

-- Freeze the idempotency key and enforce bounded lifecycle transitions even if
-- an authenticated client writes its own job row directly.
create or replace function public.guard_render_job_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mutation_time timestamptz := clock_timestamp();
begin
  if new.id is distinct from old.id
    or new.revision_id is distinct from old.revision_id
    or new.requested_by is distinct from old.requested_by
    or new.normalized_image_hash is distinct from old.normalized_image_hash
    or new.garment_category is distinct from old.garment_category
    or new.api_version is distinct from old.api_version
    or new.created_at is distinct from old.created_at then
    raise exception 'Render job identity is immutable' using errcode = '22023';
  end if;

  if new.attempt_count = old.attempt_count then
    if not (
      (old.status = 'reserved' and new.status in ('reserved', 'deferred', 'running', 'error', 'timeout'))
      or (old.status = 'deferred' and new.status in ('deferred', 'reserved'))
      or (old.status = 'running' and new.status in ('running', 'success', 'error', 'timeout'))
      or (old.status = 'success' and new.status = 'success')
      or (old.status = 'error' and new.status = 'error')
      or (old.status = 'timeout' and new.status = 'timeout')
    ) then
      raise exception 'Invalid render job status transition' using errcode = '22023';
    end if;

    if old.task_id is not null and new.task_id is distinct from old.task_id then
      raise exception 'Vendor task ID is immutable within an attempt' using errcode = '22023';
    end if;
    if old.status = 'reserved' and new.status = 'running' and new.task_id is null then
      raise exception 'A running render requires a vendor task ID' using errcode = '22023';
    end if;
    if old.status = 'reserved' and new.task_id is not null and new.status <> 'running' then
      raise exception 'Attaching a vendor task must start the render' using errcode = '22023';
    end if;
    if old.status = 'reserved' and new.status = 'reserved'
      and new.reservation_expires_at is distinct from old.reservation_expires_at
      and not (
        old.task_id is null
        and old.reservation_expires_at <= mutation_time
        and new.reservation_expires_at > mutation_time
        and new.reservation_expires_at <= mutation_time + interval '5 minutes 5 seconds'
        and not exists (
          select 1 from public.render_usage u
          where u.job_id = old.id and u.attempt_number = old.attempt_count
        )
      ) then
      raise exception 'A live or spent reservation lease cannot be extended in place'
        using errcode = '22023';
    end if;
    if new.prior_task_ids is distinct from old.prior_task_ids then
      raise exception 'Prior vendor task IDs are append-only on retry' using errcode = '22023';
    end if;
  elsif new.attempt_count = old.attempt_count + 1 then
    if old.attempt_count >= 3
      or new.status <> 'reserved'
      or new.task_id is not null
      or new.reservation_expires_at <= mutation_time
      or new.reservation_expires_at > mutation_time + interval '5 minutes 5 seconds'
      or not (
        (old.status in ('error', 'timeout')
          and old.updated_at <= mutation_time - interval '30 seconds')
        or (old.status = 'reserved' and old.task_id is null
          and old.reservation_expires_at <= mutation_time)
      ) then
      raise exception 'Render retry is not eligible' using errcode = '22023';
    end if;

    if old.task_id is null then
      if new.prior_task_ids is distinct from old.prior_task_ids then
        raise exception 'Prior vendor task IDs are append-only' using errcode = '22023';
      end if;
    elsif new.prior_task_ids is distinct from array_append(old.prior_task_ids, old.task_id) then
      raise exception 'The previous vendor task ID must be retained' using errcode = '22023';
    end if;
  else
    raise exception 'Render attempt number can only advance by one' using errcode = '22023';
  end if;

  new.updated_at := mutation_time;
  return new;
end;
$$;

drop trigger if exists render_job_update_guard on public.render_job;
create trigger render_job_update_guard
before update on public.render_job
for each row execute function public.guard_render_job_update();

revoke all on function public.guard_render_job_update()
  from public, anon, authenticated, service_role;

-- Attach the YouCam task only to the exact winning attempt and only while its
-- lease and revision are still valid. Late responses cannot overwrite a retry.
create or replace function public.attach_reserved_render_task(
  p_job_id uuid,
  p_attempt_number integer,
  p_vendor_task_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment_time timestamptz := clock_timestamp();
  normalized_task_id text := trim(coalesce(p_vendor_task_id, ''));
  attached boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if char_length(normalized_task_id) not between 1 and 512
    or normalized_task_id !~ '^[A-Za-z0-9_+/=-]+$' then
    raise exception 'Invalid vendor task ID' using errcode = '22023';
  end if;

  perform 1
  from public.render_job j
  join public.revision r on r.id = j.revision_id
  join public.brief b on b.id = r.brief_id
  where j.id = p_job_id
    and j.status = 'reserved'
    and j.task_id is null
    and j.attempt_count = p_attempt_number
    and j.reservation_expires_at > attachment_time
    and r.locked_at is null
    and b.status not in ('awaiting_customer', 'approved', 'archived')
  for update of j, r;
  if not found then return false; end if;

  update public.render_job
  set task_id = normalized_task_id,
      status = 'running',
      reservation_expires_at = null
  where id = p_job_id
    and status = 'reserved'
    and task_id is null
    and attempt_count = p_attempt_number
  returning true into attached;
  return coalesce(attached, false);
end;
$$;

revoke all on function public.attach_reserved_render_task(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.attach_reserved_render_task(uuid, integer, text)
  to service_role;