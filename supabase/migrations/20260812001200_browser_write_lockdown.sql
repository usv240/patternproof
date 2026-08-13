-- Close direct-browser paths around normalized intake and render provenance.
-- Run after 009_body_photo_erasure.sql.

-- These RPCs already authenticate auth.uid() and prove exact ownership. Run
-- them with definer table rights so browsers can no longer write jobs directly.
alter function public.reserve_render_job(uuid, text, text, text, uuid) security definer;
alter function public.attach_reserved_render_task(uuid, integer, text) security definer;
alter function public.get_or_create_owned_shop(text) security definer;

drop policy if exists "owners can create their render jobs" on public.render_job;
drop policy if exists "owners can update their render jobs" on public.render_job;
revoke insert, update, delete on public.render_job from anon, authenticated;

-- Brief, revision, consent, and canonical object creation are server-managed.
-- Browser uploads use single-path signed grants; the server decodes and writes
-- normalized canonical objects with the service role.
revoke insert, update, delete on public.brief from anon, authenticated;
revoke insert, update, delete on public.revision from anon, authenticated;
revoke insert, update, delete on public.consent from anon, authenticated;
revoke insert, update, delete on public.shop from anon, authenticated;

-- Narrow row-lock grants required by assert_revision_editable. These columns
-- carry no asset/spec/status authority and remain protected by review guards.
grant update (customer_label) on public.brief to authenticated;
grant update (coordination_version) on public.revision to authenticated;

drop policy if exists "shop owners can upload brief images" on storage.objects;
drop policy if exists "shop owners can update brief images" on storage.objects;
drop policy if exists "shop owners can delete brief images" on storage.objects;
revoke insert, update, delete on storage.objects from anon, authenticated;

-- Defense in depth: even trusted RPCs cannot reserve a vendor call unless the
-- exact owner/revision/path tuple completed the normalized intake ledger.
create or replace function public.require_ready_intake_for_render()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'reserved' and not exists (
    select 1
    from public.intake_issuance i
    join public.revision r on r.id = i.revision_id
    where i.revision_id = new.revision_id
      and i.owner_id = new.requested_by
      and i.brief_id = r.brief_id
      and i.state = 'ready'
      and i.ready_at is not null
      and i.body_path = r.body_path
      and i.reference_path = r.reference_path
  ) then
    raise exception 'A verified ready intake is required for rendering'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists ready_intake_render_guard on public.render_job;
create trigger ready_intake_render_guard
before insert or update on public.render_job
for each row execute function public.require_ready_intake_for_render();

revoke all on function public.require_ready_intake_for_render()
  from public, anon, authenticated, service_role;

-- Only the server may attach or terminate a vendor attempt. A consumed budget
-- row is the provenance proof that an attachment/error belongs to a server-made
-- YouCam POST.
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
    and exists (
      select 1 from public.render_usage u
      where u.job_id = j.id
        and u.attempt_number = p_attempt_number
        and u.requested_by = j.requested_by
    )
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

create or replace function public.mark_reserved_render_error(
  p_job_id uuid,
  p_attempt_number integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare marked boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.render_job j
  set status = 'error', reservation_expires_at = null
  where j.id = p_job_id
    and j.status = 'reserved'
    and j.task_id is null
    and j.attempt_count = p_attempt_number
    and exists (
      select 1 from public.render_usage u
      where u.job_id = j.id
        and u.attempt_number = p_attempt_number
        and u.requested_by = j.requested_by
    )
  returning true into marked;
  return coalesce(marked, false);
end;
$$;

create or replace function public.release_unspent_render_reservation(
  p_job_id uuid,
  p_attempt_number integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare released boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.render_job j
  set status = 'deferred', reservation_expires_at = null
  where j.id = p_job_id
    and j.status = 'reserved'
    and j.task_id is null
    and j.attempt_count = p_attempt_number
    and not exists (
      select 1 from public.render_usage u
      where u.job_id = j.id and u.attempt_number = p_attempt_number
    )
  returning true into released;
  return coalesce(released, false);
end;
$$;

revoke all on function public.attach_reserved_render_task(uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_reserved_render_error(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.release_unspent_render_reservation(uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.attach_reserved_render_task(uuid, integer, text)
  to service_role;
grant execute on function public.mark_reserved_render_error(uuid, integer)
  to service_role;
grant execute on function public.release_unspent_render_reservation(uuid, integer)
  to service_role;

-- Resolve ambiguous budget-call commits from database truth. If usage exists,
-- the vendor POST may have happened and the attempt is terminally failed. If it
-- does not, the same attempt is deferred and can be reclaimed without burning
-- one of the three external attempts.
create or replace function public.abort_reserved_render_attempt(
  p_job_id uuid,
  p_attempt_number integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_owner uuid;
  spent boolean;
  next_status text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select j.requested_by into job_owner
  from public.render_job j
  where j.id = p_job_id
    and j.status = 'reserved'
    and j.task_id is null
    and j.attempt_count = p_attempt_number
  for update;
  if not found then return null; end if;

  select exists (
    select 1 from public.render_usage u
    where u.job_id = p_job_id
      and u.attempt_number = p_attempt_number
      and u.requested_by = job_owner
  ) into spent;
  next_status := case when spent then 'error' else 'deferred' end;

  update public.render_job
  set status = next_status, reservation_expires_at = null
  where id = p_job_id;
  return next_status;
end;
$$;

revoke all on function public.abort_reserved_render_attempt(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.abort_reserved_render_attempt(uuid, integer)
  to service_role;
