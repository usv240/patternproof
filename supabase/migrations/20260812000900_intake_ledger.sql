-- Durable intake issuance, grant expiry, and raw-object cleanup ledger.
-- Run after 006_review_freeze_and_integrity.sql.

create table public.intake_issuance (
  id uuid primary key,
  owner_id uuid not null,
  shop_id uuid not null,
  brief_id uuid references public.brief(id) on delete set null,
  issued_brief_id uuid not null,
  revision_id uuid not null unique,
  upload_nonce uuid not null,
  body_path text not null unique,
  reference_path text not null unique,
  raw_body_path text not null unique,
  raw_reference_path text not null unique,
  state text not null default 'reserved'
    check (state in ('reserved', 'issued', 'finalizing', 'ready', 'rejected', 'failed', 'cancelled', 'expired')),
  raw_cleanup_state text not null default 'pending'
    check (raw_cleanup_state in ('pending', 'removed', 'cleanup_required', 'cleaning', 'deleted')),
  created_at timestamptz not null,
  reservation_cleanup_after timestamptz not null,
  issued_at timestamptz,
  expires_at timestamptz,
  ready_at timestamptz,
  raw_removed_at timestamptz,
  raw_deleted_at timestamptz,
  cleanup_attempted_at timestamptz,
  cleanup_claim_id uuid,
  cleanup_claimed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  updated_at timestamptz not null,
  constraint intake_issuance_live_brief_check
    check (brief_id is null or brief_id = issued_brief_id),
  constraint intake_issuance_activation_pair_check
    check ((issued_at is null) = (expires_at is null)),
  constraint intake_issuance_expiry_check
    check (expires_at is null or expires_at = issued_at + interval '2 hours'),
  constraint intake_issuance_reservation_cleanup_check
    check (reservation_cleanup_after = created_at + interval '3 hours'),
  constraint intake_issuance_ready_check
    check ((state = 'ready') = (ready_at is not null)),
  constraint intake_issuance_removed_check
    check (raw_cleanup_state <> 'removed' or raw_removed_at is not null),
  constraint intake_issuance_raw_deleted_check
    check ((raw_cleanup_state = 'deleted') = (raw_deleted_at is not null)),
  constraint intake_issuance_cleanup_claim_check
    check (
      (raw_cleanup_state = 'cleaning' and cleanup_claim_id is not null and cleanup_claimed_at is not null)
      or (raw_cleanup_state <> 'cleaning' and cleanup_claim_id is null and cleanup_claimed_at is null)
    ),
  constraint intake_issuance_body_path_check
    check (body_path = shop_id::text || '/' || issued_brief_id::text || '/' || revision_id::text || '/body.jpg'),
  constraint intake_issuance_reference_path_check
    check (reference_path = shop_id::text || '/' || issued_brief_id::text || '/' || revision_id::text || '/reference.jpg'),
  constraint intake_issuance_raw_body_path_check
    check (raw_body_path = shop_id::text || '/' || issued_brief_id::text || '/' || revision_id::text || '/pending-' || upload_nonce::text || '-body'),
  constraint intake_issuance_raw_reference_path_check
    check (raw_reference_path = shop_id::text || '/' || issued_brief_id::text || '/' || revision_id::text || '/pending-' || upload_nonce::text || '-reference')
);

create index intake_issuance_owner_created_idx
  on public.intake_issuance (owner_id, created_at desc);
create index intake_issuance_cleanup_idx
  on public.intake_issuance (
    raw_cleanup_state,
    coalesce(expires_at, reservation_cleanup_after)
  )
  where raw_cleanup_state <> 'deleted';

alter table public.intake_issuance enable row level security;
revoke all on table public.intake_issuance from public, anon, authenticated, service_role;
grant select, update on table public.intake_issuance to service_role;

-- Reserve a durable quota row before upload URLs are minted. Rows count against
-- the rolling-hour owner limit regardless of later brief deletion or state.
create or replace function public.reserve_intake_issuance(
  p_issuance_id uuid,
  p_owner_id uuid,
  p_shop_id uuid,
  p_brief_id uuid,
  p_revision_id uuid,
  p_upload_nonce uuid
)
returns table (
  accepted boolean,
  issuance_id uuid,
  raw_body_path text,
  raw_reference_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_time timestamptz := clock_timestamp();
  v_body_path text;
  v_reference_path text;
  v_raw_body_path text;
  v_raw_reference_path text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_issuance_id is null or p_owner_id is null or p_shop_id is null
    or p_brief_id is null or p_revision_id is null or p_upload_nonce is null then
    raise exception 'Intake issuance identifiers are required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.shop s
    join public.brief b on b.shop_id = s.id
    join public.revision r on r.brief_id = b.id
    where s.id = p_shop_id
      and s.owner_id = p_owner_id
      and b.id = p_brief_id
      and r.id = p_revision_id
      and r.locked_at is null
  ) then
    raise exception 'Intake ownership relationship is invalid' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 707)
  );
  if (
    select count(*)
    from public.intake_issuance i
    where i.owner_id = p_owner_id
      and i.created_at > reservation_time - interval '1 hour'
  ) >= 10 then
    return query select false, null::uuid, null::text, null::text;
    return;
  end if;

  v_body_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text || '/body.jpg';
  v_reference_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text || '/reference.jpg';
  v_raw_body_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text || '/pending-' || p_upload_nonce::text || '-body';
  v_raw_reference_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text || '/pending-' || p_upload_nonce::text || '-reference';

  insert into public.intake_issuance (
    id, owner_id, shop_id, brief_id, issued_brief_id, revision_id, upload_nonce,
    body_path, reference_path, raw_body_path, raw_reference_path,
    state, raw_cleanup_state, created_at, reservation_cleanup_after, updated_at
  ) values (
    p_issuance_id, p_owner_id, p_shop_id, p_brief_id, p_brief_id, p_revision_id,
    p_upload_nonce, v_body_path, v_reference_path, v_raw_body_path,
    v_raw_reference_path, 'reserved', 'pending', reservation_time,
    reservation_time + interval '3 hours', reservation_time
  );

  return query select true, p_issuance_id, v_raw_body_path, v_raw_reference_path;
end;
$$;

-- Activate the exact two-hour grant window only after both signed upload URLs
-- have been minted. A failed activation remains conservatively sweepable after
-- reservation_cleanup_after, which outlives either possible grant.
create or replace function public.activate_intake_issuance(p_issuance_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  activation_time timestamptz := clock_timestamp();
  result timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.intake_issuance
  set state = 'issued',
      issued_at = activation_time,
      expires_at = activation_time + interval '2 hours',
      last_error = null
  where id = p_issuance_id and state = 'reserved'
  returning expires_at into result;
  if result is null then
    raise exception 'Intake reservation is unavailable' using errcode = '55000';
  end if;
  return result;
end;
$$;

revoke all on function public.reserve_intake_issuance(uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.activate_intake_issuance(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_intake_issuance(uuid, uuid, uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.activate_intake_issuance(uuid)
  to service_role;

-- Ledger identity and path snapshots never change. The live brief link may only
-- become NULL through ON DELETE SET NULL. Cleanup state remains retryable until
-- a claimed post-expiry sweep records durable deletion.
create or replace function public.guard_intake_issuance_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.shop_id is distinct from old.shop_id
    or new.issued_brief_id is distinct from old.issued_brief_id
    or new.revision_id is distinct from old.revision_id
    or new.upload_nonce is distinct from old.upload_nonce
    or new.body_path is distinct from old.body_path
    or new.reference_path is distinct from old.reference_path
    or new.raw_body_path is distinct from old.raw_body_path
    or new.raw_reference_path is distinct from old.raw_reference_path
    or new.created_at is distinct from old.created_at
    or new.reservation_cleanup_after is distinct from old.reservation_cleanup_after then
    raise exception 'Intake issuance identity is immutable' using errcode = '22023';
  end if;
  if new.brief_id is distinct from old.brief_id
    and not (old.brief_id is not null and new.brief_id is null) then
    raise exception 'Intake live brief link can only be cleared' using errcode = '22023';
  end if;

  if old.issued_at is null and new.issued_at is not null then
    if old.state <> 'reserved' or new.state <> 'issued'
      or new.expires_at <> new.issued_at + interval '2 hours' then
      raise exception 'Invalid intake activation' using errcode = '22023';
    end if;
  elsif new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'Intake grant timestamps are immutable' using errcode = '22023';
  end if;

  if new.state is distinct from old.state and not (
    (old.state = 'reserved' and new.state in ('issued', 'failed', 'cancelled', 'expired'))
    or (old.state = 'issued' and new.state in ('finalizing', 'ready', 'failed', 'cancelled', 'expired'))
    or (old.state = 'finalizing' and new.state in ('issued', 'ready', 'rejected', 'failed', 'expired'))
    or (
      old.state in ('failed', 'expired') and new.state = 'ready'
      and (select auth.role()) = 'service_role'
      and exists (
        select 1 from public.revision r
        where r.id = old.revision_id
          and nullif(trim(r.garment_spec ->> 'intake_ready_at'), '') is not null
      )
    )
  ) then
    raise exception 'Invalid intake issuance state transition' using errcode = '22023';
  end if;

  if old.ready_at is not null and new.ready_at is distinct from old.ready_at then
    raise exception 'Intake ready timestamp is immutable' using errcode = '22023';
  end if;
  if new.state = 'ready' and new.ready_at is null then
    raise exception 'Ready intake requires a ready timestamp' using errcode = '22023';
  end if;
  if new.state <> 'ready' and new.ready_at is not null then
    raise exception 'Only a ready intake may have a ready timestamp' using errcode = '22023';
  end if;

  if new.raw_cleanup_state is distinct from old.raw_cleanup_state and not (
    (old.raw_cleanup_state = 'pending' and new.raw_cleanup_state in ('removed', 'cleanup_required', 'cleaning'))
    or (old.raw_cleanup_state = 'removed' and new.raw_cleanup_state in ('cleanup_required', 'cleaning'))
    or (old.raw_cleanup_state = 'cleanup_required' and new.raw_cleanup_state in ('removed', 'cleaning'))
    or (old.raw_cleanup_state = 'cleaning' and new.raw_cleanup_state in ('deleted', 'cleanup_required'))
  ) then
    raise exception 'Invalid intake cleanup state transition' using errcode = '22023';
  end if;
  if old.raw_removed_at is not null and new.raw_removed_at is distinct from old.raw_removed_at then
    raise exception 'Raw removal timestamp is immutable' using errcode = '22023';
  end if;
  if new.raw_cleanup_state = 'removed' and new.raw_removed_at is null then
    raise exception 'Removed raw uploads require a removal timestamp' using errcode = '22023';
  end if;
  if old.raw_deleted_at is not null and new.raw_deleted_at is distinct from old.raw_deleted_at then
    raise exception 'Raw deletion timestamp is immutable' using errcode = '22023';
  end if;
  if new.raw_cleanup_state = 'deleted' and new.raw_deleted_at is null then
    raise exception 'Deleted raw uploads require a deletion timestamp' using errcode = '22023';
  end if;
  if new.raw_cleanup_state <> 'deleted' and new.raw_deleted_at is not null then
    raise exception 'Only deleted raw uploads may have a deletion timestamp' using errcode = '22023';
  end if;
  if new.raw_cleanup_state = 'cleaning' then
    if new.cleanup_claim_id is null or new.cleanup_claimed_at is null then
      raise exception 'Claimed cleanup requires claim metadata' using errcode = '22023';
    end if;
  elsif new.cleanup_claim_id is not null or new.cleanup_claimed_at is not null then
    raise exception 'Only an active cleanup may retain claim metadata' using errcode = '22023';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists intake_issuance_update_guard on public.intake_issuance;
create trigger intake_issuance_update_guard
before update on public.intake_issuance
for each row execute function public.guard_intake_issuance_update();

revoke all on function public.guard_intake_issuance_update()
  from public, anon, authenticated, service_role;

-- Claim bounded cleanup work atomically. Cleanup never starts before every
-- possible signed upload grant has expired, and active finalizers get a lease.
create or replace function public.claim_intake_cleanup(p_limit integer default 100)
returns table (
  issuance_id uuid,
  cleanup_claim_id uuid,
  brief_id uuid,
  issued_brief_id uuid,
  revision_id uuid,
  body_path text,
  reference_path text,
  raw_body_path text,
  raw_reference_path text,
  state text,
  ready_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_time timestamptz := clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select i.id
    from public.intake_issuance i
    where i.raw_cleanup_state <> 'deleted'
      and coalesce(i.expires_at, i.reservation_cleanup_after) <= claim_time
      and not (
        i.state = 'finalizing'
        and i.updated_at > claim_time - interval '15 minutes'
      )
      and (
        i.raw_cleanup_state <> 'cleaning'
        or i.cleanup_claimed_at <= claim_time - interval '15 minutes'
      )
    order by coalesce(i.expires_at, i.reservation_cleanup_after), i.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 100)
  ), claimed as (
    update public.intake_issuance i
    set raw_cleanup_state = 'cleaning',
        cleanup_claim_id = pg_catalog.gen_random_uuid(),
        cleanup_claimed_at = claim_time,
        cleanup_attempted_at = claim_time
    from candidates c
    where i.id = c.id
    returning i.*
  )
  select
    c.id,
    c.cleanup_claim_id,
    c.brief_id,
    c.issued_brief_id,
    c.revision_id,
    c.body_path,
    c.reference_path,
    c.raw_body_path,
    c.raw_reference_path,
    c.state,
    c.ready_at,
    c.expires_at
  from claimed c;
end;
$$;

create or replace function public.complete_intake_cleanup(
  p_issuance_id uuid,
  p_cleanup_claim_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  completion_time timestamptz := clock_timestamp();
  completed boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.intake_issuance
  set raw_cleanup_state = case when p_succeeded then 'deleted' else 'cleanup_required' end,
      raw_deleted_at = case when p_succeeded then completion_time else null end,
      cleanup_claim_id = null,
      cleanup_claimed_at = null,
      cleanup_attempted_at = completion_time,
      last_error = case
        when p_succeeded then null
        else left(coalesce(nullif(trim(p_error), ''), 'Private object cleanup requires retry.'), 1000)
      end
  where id = p_issuance_id
    and cleanup_claim_id = p_cleanup_claim_id
    and raw_cleanup_state = 'cleaning'
  returning true into completed;
  return coalesce(completed, false);
end;
$$;

revoke all on function public.claim_intake_cleanup(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_intake_cleanup(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_intake_cleanup(integer) to service_role;
grant execute on function public.complete_intake_cleanup(uuid, uuid, boolean, text)
  to service_role;
