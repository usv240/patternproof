-- Make intake creation, finalization, and cleanup database-coordinated.
-- Run after 010_browser_write_lockdown.sql.

-- cleanup_object_paths is an append-only deletion manifest. It survives the
-- brief/revision cascade, so an interrupted Storage deletion is always
-- retryable from database truth.
alter table public.intake_issuance
  add column if not exists finalization_claim_id uuid,
  add column if not exists finalization_claimed_at timestamptz,
  add column if not exists cleanup_object_paths text[] not null default '{}'::text[];

-- Migration 007 represented an active finalizer only with state/updated_at.
-- Such a process cannot possess a migration-011 fence, so release it safely.
update public.intake_issuance
set state = case
      when expires_at is not null and expires_at > clock_timestamp() then 'issued'
      else 'expired'
    end,
    last_error = 'Legacy finalization lease released during intake fencing upgrade.'
where state = 'finalizing'
  and finalization_claim_id is null
  and finalization_claimed_at is null;

alter table public.intake_issuance
  drop constraint if exists intake_issuance_finalization_claim_check,
  add constraint intake_issuance_finalization_claim_check check (
    (
      state = 'finalizing'
      and finalization_claim_id is not null
      and finalization_claimed_at is not null
    ) or (
      state <> 'finalizing'
      and finalization_claim_id is null
      and finalization_claimed_at is null
    )
  ),
  drop constraint if exists intake_issuance_cleanup_paths_check,
  add constraint intake_issuance_cleanup_paths_check check (
    cardinality(cleanup_object_paths) <= 512
    and array_position(cleanup_object_paths, null) is null
  ),
  drop constraint if exists intake_issuance_raw_deleted_check,
  add constraint intake_issuance_raw_deleted_check check (
    raw_cleanup_state <> 'deleted' or raw_deleted_at is not null
  );

create index if not exists intake_issuance_live_brief_idx
  on public.intake_issuance (brief_id)
  where brief_id is not null;
create index if not exists intake_issuance_issued_brief_idx
  on public.intake_issuance (issued_brief_id, id);

create or replace function public.merge_intake_cleanup_paths(
  p_existing text[],
  p_additions text[]
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(path order by path), '{}'::text[])
  from (
    select distinct trim(candidate) as path
    from unnest(
      coalesce(p_existing, '{}'::text[]) || coalesce(p_additions, '{}'::text[])
    ) as paths(candidate)
    where nullif(trim(candidate), '') is not null
      and char_length(trim(candidate)) <= 1024
  ) normalized;
$$;

revoke all on function public.merge_intake_cleanup_paths(text[], text[])
  from public, anon, authenticated, service_role;

-- Reapply the ledger guard with finalizer fencing and append-only cleanup
-- manifests. Every state transition remains service-only through table grants.
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

  if new.state = 'finalizing' then
    if new.finalization_claim_id is null or new.finalization_claimed_at is null then
      raise exception 'Finalizing intake requires a fenced claim' using errcode = '22023';
    end if;
    if old.state = 'finalizing'
      and (
        new.finalization_claim_id is distinct from old.finalization_claim_id
        or new.finalization_claimed_at is distinct from old.finalization_claimed_at
      )
      and not (
        (select auth.role()) = 'service_role'
        and old.finalization_claimed_at <= clock_timestamp() - interval '15 minutes'
        and old.expires_at > clock_timestamp()
      ) then
      raise exception 'Active intake finalization claim is immutable' using errcode = '55000';
    end if;
  elsif new.finalization_claim_id is not null or new.finalization_claimed_at is not null then
    raise exception 'Only a finalizing intake may retain a finalization claim'
      using errcode = '22023';
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

  if new.cleanup_object_paths is distinct from old.cleanup_object_paths then
    if (select auth.role()) <> 'service_role'
      or not (new.cleanup_object_paths @> old.cleanup_object_paths) then
      raise exception 'Intake cleanup manifest is append-only' using errcode = '22023';
    end if;
  end if;

  if new.raw_cleanup_state is distinct from old.raw_cleanup_state and not (
    (old.raw_cleanup_state = 'pending' and new.raw_cleanup_state in ('removed', 'cleanup_required', 'cleaning'))
    or (old.raw_cleanup_state = 'removed' and new.raw_cleanup_state in ('cleanup_required', 'cleaning'))
    or (old.raw_cleanup_state = 'cleanup_required' and new.raw_cleanup_state in ('removed', 'cleaning'))
    or (old.raw_cleanup_state = 'cleaning' and new.raw_cleanup_state in ('deleted', 'cleanup_required'))
    or (
      old.raw_cleanup_state = 'deleted'
      and new.raw_cleanup_state = 'cleanup_required'
      and (select auth.role()) = 'service_role'
      and new.cleanup_object_paths @> old.cleanup_object_paths
      and new.cleanup_object_paths is distinct from old.cleanup_object_paths
    )
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
    raise exception 'Deleted private objects require a deletion timestamp' using errcode = '22023';
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

-- Atomically create every relational row for an intake reservation after the
-- per-owner quota decision. Any exception rolls the whole reservation back.
create or replace function public.create_intake_reservation(
  p_issuance_id uuid,
  p_owner_id uuid,
  p_shop_id uuid,
  p_brief_id uuid,
  p_revision_id uuid,
  p_upload_nonce uuid,
  p_customer_label text,
  p_category text,
  p_share_token_hash text,
  p_token_expires_at timestamptz
)
returns table (
  accepted boolean,
  issuance_id uuid,
  body_path text,
  reference_path text,
  raw_body_path text,
  raw_reference_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_time timestamptz := clock_timestamp();
  safe_label text;
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
    raise exception 'Intake reservation identifiers are required' using errcode = '22023';
  end if;
  if p_category is null
    or p_category not in ('tops', 'bottoms', 'dresses', 'one-pieces') then
    raise exception 'Unsupported garment category' using errcode = '22023';
  end if;
  if p_share_token_hash !~ '^[0-9a-f]{64}$'
    or p_token_expires_at < reservation_time + interval '1 hour'
    or p_token_expires_at > reservation_time + interval '30 days' then
    raise exception 'Invalid intake token envelope' using errcode = '22023';
  end if;

  safe_label := left(regexp_replace(trim(coalesce(p_customer_label, '')), '\s+', ' ', 'g'), 80);
  if safe_label = '' then safe_label := 'Customer'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 707)
  );
  if not exists (
    select 1 from public.shop s
    where s.id = p_shop_id and s.owner_id = p_owner_id
  ) then
    raise exception 'Intake shop ownership is invalid' using errcode = '42501';
  end if;
  if (
    select count(*)
    from public.intake_issuance i
    where i.owner_id = p_owner_id
      and i.created_at > reservation_time - interval '1 hour'
  ) >= 10 then
    return query select false, null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;

  v_body_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text || '/body.jpg';
  v_reference_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text || '/reference.jpg';
  v_raw_body_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text
    || '/pending-' || p_upload_nonce::text || '-body';
  v_raw_reference_path := p_shop_id::text || '/' || p_brief_id::text || '/' || p_revision_id::text
    || '/pending-' || p_upload_nonce::text || '-reference';

  insert into public.brief (
    id, shop_id, customer_label, share_token_hash, token_expires_at
  ) values (
    p_brief_id, p_shop_id, safe_label, p_share_token_hash, p_token_expires_at
  );

  insert into public.consent (
    brief_id, scope, rights_confirmed, body_processing_confirmed, policy_version
  ) values (
    p_brief_id,
    'visual-intent preview and Cut Card approval',
    true,
    true,
    '2026-08-02'
  );

  insert into public.revision (
    id, brief_id, version, reference_path, body_path, garment_spec
  ) values (
    p_revision_id,
    p_brief_id,
    1,
    v_reference_path,
    v_body_path,
    pg_catalog.jsonb_build_object('category', p_category)
  );

  insert into public.intake_issuance (
    id, owner_id, shop_id, brief_id, issued_brief_id, revision_id, upload_nonce,
    body_path, reference_path, raw_body_path, raw_reference_path,
    state, raw_cleanup_state, cleanup_object_paths,
    created_at, reservation_cleanup_after, updated_at
  ) values (
    p_issuance_id, p_owner_id, p_shop_id, p_brief_id, p_brief_id, p_revision_id,
    p_upload_nonce, v_body_path, v_reference_path, v_raw_body_path,
    v_raw_reference_path, 'reserved', 'pending',
    array[v_raw_body_path, v_raw_reference_path],
    reservation_time, reservation_time + interval '3 hours', reservation_time
  );

  return query select true, p_issuance_id, v_body_path, v_reference_path,
    v_raw_body_path, v_raw_reference_path;
end;
$$;

-- A claim is a 15-minute fencing token. A stale finalizer may be reclaimed only
-- while the upload grant is still live. Existing ready database truth wins.
create or replace function public.claim_intake_finalization(
  p_owner_id uuid,
  p_brief_id uuid,
  p_revision_id uuid
)
returns table (
  claim_acquired boolean,
  intake_state text,
  issuance_id uuid,
  finalization_claim_id uuid,
  shop_id uuid,
  body_path text,
  reference_path text,
  raw_body_path text,
  raw_reference_path text,
  expires_at timestamptz,
  ready_at timestamptz,
  raw_cleanup_state text,
  raw_removed_at timestamptz,
  garment_spec jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_time timestamptz := clock_timestamp();
  v_issuance public.intake_issuance%rowtype;
  v_revision public.revision%rowtype;
  v_claim_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select i.* into v_issuance
  from public.intake_issuance i
  where i.owner_id = p_owner_id
    and i.issued_brief_id = p_brief_id
    and i.revision_id = p_revision_id
  for update;
  if not found then return; end if;

  perform 1
  from public.brief b
  join public.shop s on s.id = b.shop_id
  where b.id = p_brief_id
    and b.id = v_issuance.brief_id
    and b.shop_id = v_issuance.shop_id
    and s.owner_id = p_owner_id
    and b.status not in ('awaiting_customer', 'approved', 'archived')
  for update of b;
  if not found then return; end if;

  select r.* into v_revision
  from public.revision r
  where r.id = p_revision_id
    and r.brief_id = p_brief_id
    and r.body_path = v_issuance.body_path
    and r.reference_path = v_issuance.reference_path
  for update;
  if not found or v_revision.locked_at is not null then return; end if;

  if nullif(trim(v_revision.garment_spec ->> 'intake_ready_at'), '') is not null then
    if v_issuance.state <> 'ready' then
      update public.intake_issuance i
      set state = 'ready',
          ready_at = coalesce(i.ready_at, claim_time),
          finalization_claim_id = null,
          finalization_claimed_at = null,
          last_error = null
      where i.id = v_issuance.id;
    end if;
    select i.* into v_issuance from public.intake_issuance i where i.id = v_issuance.id;
    return query select false, v_issuance.state, v_issuance.id,
      v_issuance.finalization_claim_id, v_issuance.shop_id,
      v_issuance.body_path, v_issuance.reference_path,
      v_issuance.raw_body_path, v_issuance.raw_reference_path,
      v_issuance.expires_at, v_issuance.ready_at,
      v_issuance.raw_cleanup_state, v_issuance.raw_removed_at,
      v_revision.garment_spec;
    return;
  end if;

  if v_issuance.expires_at is null or v_issuance.expires_at <= claim_time then
    if v_issuance.state in ('issued', 'finalizing') then
      update public.intake_issuance
      set state = 'expired',
          finalization_claim_id = null,
          finalization_claimed_at = null,
          last_error = 'Intake upload grant expired before finalization committed.'
      where id = v_issuance.id;
    end if;
    select i.* into v_issuance from public.intake_issuance i where i.id = v_issuance.id;
    return query select false, v_issuance.state, v_issuance.id,
      v_issuance.finalization_claim_id, v_issuance.shop_id,
      v_issuance.body_path, v_issuance.reference_path,
      v_issuance.raw_body_path, v_issuance.raw_reference_path,
      v_issuance.expires_at, v_issuance.ready_at,
      v_issuance.raw_cleanup_state, v_issuance.raw_removed_at,
      v_revision.garment_spec;
    return;
  end if;

  if v_issuance.state = 'issued'
    or (
      v_issuance.state = 'finalizing'
      and v_issuance.finalization_claimed_at <= claim_time - interval '15 minutes'
    ) then
    v_claim_id := pg_catalog.gen_random_uuid();
    update public.intake_issuance
    set state = 'finalizing',
        finalization_claim_id = v_claim_id,
        finalization_claimed_at = claim_time,
        last_error = null
    where id = v_issuance.id;
    select i.* into v_issuance from public.intake_issuance i where i.id = v_issuance.id;
    return query select true, v_issuance.state, v_issuance.id,
      v_issuance.finalization_claim_id, v_issuance.shop_id,
      v_issuance.body_path, v_issuance.reference_path,
      v_issuance.raw_body_path, v_issuance.raw_reference_path,
      v_issuance.expires_at, v_issuance.ready_at,
      v_issuance.raw_cleanup_state, v_issuance.raw_removed_at,
      v_revision.garment_spec;
    return;
  end if;

  return query select false, v_issuance.state, v_issuance.id,
    v_issuance.finalization_claim_id, v_issuance.shop_id,
    v_issuance.body_path, v_issuance.reference_path,
    v_issuance.raw_body_path, v_issuance.raw_reference_path,
    v_issuance.expires_at, v_issuance.ready_at,
    v_issuance.raw_cleanup_state, v_issuance.raw_removed_at,
    v_revision.garment_spec;
end;
$$;

-- Publish normalized image provenance and the ready ledger state in one commit.
create or replace function public.commit_intake_finalization(
  p_issuance_id uuid,
  p_finalization_claim_id uuid,
  p_expected_garment_spec jsonb,
  p_normalized_images jsonb
)
returns table (committed boolean, ready_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  commit_time timestamptz := clock_timestamp();
  v_issuance public.intake_issuance%rowtype;
  v_revision public.revision%rowtype;
  v_new_spec jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_expected_garment_spec) <> 'object'
    or jsonb_typeof(p_normalized_images) <> 'object'
    or jsonb_typeof(p_normalized_images -> 'body') <> 'object'
    or jsonb_typeof(p_normalized_images -> 'reference') <> 'object'
    or p_normalized_images #>> '{body,format}' <> 'jpeg'
    or p_normalized_images #>> '{reference,format}' <> 'jpeg'
    or coalesce(p_normalized_images #>> '{body,sha256}', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_normalized_images #>> '{reference,sha256}', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_normalized_images #>> '{body,width}', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_normalized_images #>> '{body,height}', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_normalized_images #>> '{reference,width}', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_normalized_images #>> '{reference,height}', '') !~ '^[1-9][0-9]*$' then
    raise exception 'Invalid normalized image provenance' using errcode = '22023';
  end if;

  select i.* into v_issuance
  from public.intake_issuance i
  where i.id = p_issuance_id
    and i.state = 'finalizing'
    and i.finalization_claim_id = p_finalization_claim_id
    and i.finalization_claimed_at > commit_time - interval '15 minutes'
  for update;
  if not found then
    return query select false, null::timestamptz;
    return;
  end if;

  perform 1
  from public.brief b
  where b.id = v_issuance.brief_id
    and b.status not in ('awaiting_customer', 'approved', 'archived')
  for update;
  if not found then
    return query select false, null::timestamptz;
    return;
  end if;

  select r.* into v_revision
  from public.revision r
  where r.id = v_issuance.revision_id
    and r.brief_id = v_issuance.issued_brief_id
    and r.body_path = v_issuance.body_path
    and r.reference_path = v_issuance.reference_path
  for update;
  if not found or v_revision.locked_at is not null
    or v_revision.garment_spec is distinct from p_expected_garment_spec
    or exists (
      select 1 from public.review_session rs where rs.revision_id = v_revision.id
    ) then
    return query select false, null::timestamptz;
    return;
  end if;

  v_new_spec := p_expected_garment_spec || pg_catalog.jsonb_build_object(
    'intake_ready_at', commit_time,
    'normalized_images', p_normalized_images
  );
  update public.revision
  set garment_spec = v_new_spec
  where id = v_revision.id;

  update public.intake_issuance
  set state = 'ready',
      ready_at = commit_time,
      finalization_claim_id = null,
      finalization_claimed_at = null,
      last_error = null
  where id = v_issuance.id
    and finalization_claim_id = p_finalization_claim_id;

  return query select true, commit_time;
end;
$$;

create or replace function public.release_intake_finalization(
  p_issuance_id uuid,
  p_finalization_claim_id uuid,
  p_error text default null,
  p_rejected boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_time timestamptz := clock_timestamp();
  next_state text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select case
    when p_rejected then 'rejected'
    when i.expires_at is null or i.expires_at <= release_time then 'expired'
    else 'issued'
  end into next_state
  from public.intake_issuance i
  where i.id = p_issuance_id
    and i.state = 'finalizing'
    and i.finalization_claim_id = p_finalization_claim_id
  for update;
  if not found then return null; end if;

  update public.intake_issuance
  set state = next_state,
      finalization_claim_id = null,
      finalization_claimed_at = null,
      last_error = left(nullif(trim(coalesce(p_error, '')), ''), 1000)
  where id = p_issuance_id
    and state = 'finalizing'
    and finalization_claim_id = p_finalization_claim_id;
  return next_state;
end;
$$;

-- Return bounded cleanup claims with their durable manifest. Reconciliation is
-- intentionally a separate atomic RPC because it must acquire issuance,
-- brief, then revision locks in that order before deciding what may be erased.
drop function if exists public.claim_intake_cleanup(integer);
create function public.claim_intake_cleanup(p_limit integer default 15)
returns table (
  issuance_id uuid,
  cleanup_claim_id uuid,
  cleanup_object_paths text[],
  state text,
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
        and i.finalization_claimed_at > claim_time - interval '15 minutes'
      )
      and (
        i.raw_cleanup_state <> 'cleaning'
        or i.cleanup_claimed_at <= claim_time - interval '15 minutes'
      )
    order by coalesce(i.expires_at, i.reservation_cleanup_after), i.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 15)
  ), claimed as (
    update public.intake_issuance i
    set raw_cleanup_state = 'cleaning',
        cleanup_claim_id = pg_catalog.gen_random_uuid(),
        cleanup_claimed_at = claim_time,
        cleanup_attempted_at = claim_time,
        cleanup_object_paths = public.merge_intake_cleanup_paths(
          i.cleanup_object_paths,
          array[i.raw_body_path, i.raw_reference_path]
        )
    from candidates c
    where i.id = c.id
    returning i.*
  )
  select c.id, c.cleanup_claim_id, c.cleanup_object_paths, c.state, c.expires_at
  from claimed c;
end;
$$;

create or replace function public.reconcile_claimed_intake_cleanup(
  p_issuance_id uuid,
  p_cleanup_claim_id uuid
)
returns table (
  reconciled boolean,
  ready boolean,
  draft_deleted boolean,
  cleanup_object_paths text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reconcile_time timestamptz := clock_timestamp();
  v_issuance public.intake_issuance%rowtype;
  v_issued_brief_id uuid;
  v_brief public.brief%rowtype;
  v_revision public.revision%rowtype;
  v_claim_ready boolean := false;
  v_any_ready boolean := false;
  v_can_delete boolean := false;
  v_deleted boolean := false;
  v_paths text[] := '{}'::text[];
  v_canonical text[] := '{}'::text[];
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  -- Serialize cleanup for a brief, then lock every sibling issuance in UUID
  -- order. Finalizers also take issuance before brief/revision, so no delete
  -- cascade can wait on an issuance while its owner waits on our brief lock.
  select i.issued_brief_id into v_issued_brief_id
  from public.intake_issuance i
  where i.id = p_issuance_id
    and i.raw_cleanup_state = 'cleaning'
    and i.cleanup_claim_id = p_cleanup_claim_id;
  if not found then
    return query select false, false, false, '{}'::text[];
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_issued_brief_id::text, 711)
  );
  perform i.id
  from public.intake_issuance i
  where i.issued_brief_id = v_issued_brief_id
  order by i.id
  for update;

  select i.* into v_issuance
  from public.intake_issuance i
  where i.id = p_issuance_id
    and i.raw_cleanup_state = 'cleaning'
    and i.cleanup_claim_id = p_cleanup_claim_id;
  if not found then
    return query select false, false, false, '{}'::text[];
    return;
  end if;

  select b.* into v_brief
  from public.brief b
  where b.id = v_issuance.issued_brief_id
  for update;

  if found then
    perform r.id
    from public.revision r
    where r.brief_id = v_brief.id
    order by r.id
    for update;
  end if;

  select r.* into v_revision
  from public.revision r
  where r.id = v_issuance.revision_id;
  v_claim_ready := v_issuance.state = 'ready'
    or v_issuance.ready_at is not null
    or nullif(trim(v_revision.garment_spec ->> 'intake_ready_at'), '') is not null;

  select v_claim_ready or exists (
    select 1
    from public.revision r
    where r.brief_id = v_issuance.issued_brief_id
      and nullif(trim(r.garment_spec ->> 'intake_ready_at'), '') is not null
  ) or exists (
    select 1
    from public.intake_issuance i
    where i.issued_brief_id = v_issuance.issued_brief_id
      and (i.state = 'ready' or i.ready_at is not null)
  ) into v_any_ready;

  if v_claim_ready and v_issuance.state <> 'ready' then
    update public.intake_issuance
    set state = 'ready',
        ready_at = coalesce(v_issuance.ready_at, reconcile_time),
        finalization_claim_id = null,
        finalization_claimed_at = null,
        last_error = null
    where id = v_issuance.id;
  elsif not v_claim_ready and v_issuance.state in ('reserved', 'issued', 'finalizing') then
    update public.intake_issuance
    set state = 'expired',
        finalization_claim_id = null,
        finalization_claimed_at = null,
        last_error = 'Incomplete intake expired before cleanup reconciliation.'
    where id = v_issuance.id;
  end if;

  v_paths := public.merge_intake_cleanup_paths(
    v_issuance.cleanup_object_paths,
    array[v_issuance.raw_body_path, v_issuance.raw_reference_path]
  );

  if v_brief.id is null then
    -- No live relation remains to justify retaining canonical source images.
    v_paths := public.merge_intake_cleanup_paths(
      v_paths,
      array[v_issuance.body_path, v_issuance.reference_path]
    );
  elsif not v_any_ready then
    v_can_delete := v_brief.status = 'draft'
      and v_brief.approved_revision_id is null
      and v_brief.shared_revision_id is null
      and not exists (
        select 1 from public.review_session rs where rs.brief_id = v_brief.id
      )
      and not exists (
        select 1 from public.revision r
        where r.brief_id = v_brief.id
          and (
            r.locked_at is not null
            or nullif(trim(r.garment_spec ->> 'intake_ready_at'), '') is not null
          )
      )
      and not exists (
        select 1 from public.intake_issuance i
        where i.issued_brief_id = v_brief.id
          and (
            i.state = 'ready'
            or i.ready_at is not null
            or coalesce(i.expires_at, i.reservation_cleanup_after) > reconcile_time
            or (
              i.state = 'finalizing'
              and i.finalization_claimed_at > reconcile_time - interval '15 minutes'
            )
          )
      );

    if v_can_delete then
      select coalesce(array_agg(path order by path), '{}'::text[])
      into v_canonical
      from (
        select r.body_path as path from public.revision r where r.brief_id = v_brief.id
        union
        select r.reference_path from public.revision r where r.brief_id = v_brief.id
        union
        select r.render_path from public.revision r
          where r.brief_id = v_brief.id and r.render_path is not null
      ) canonical;
      v_paths := public.merge_intake_cleanup_paths(v_paths, v_canonical);

      -- The durable manifest is committed before the cascading relational delete.
      update public.intake_issuance
      set cleanup_object_paths = v_paths
      where id = v_issuance.id;
      delete from public.brief where id = v_brief.id;
      v_deleted := found;
    end if;
  end if;

  update public.intake_issuance
  set cleanup_object_paths = v_paths
  where id = v_issuance.id
    and raw_cleanup_state = 'cleaning'
    and cleanup_claim_id = p_cleanup_claim_id;

  return query select true, v_claim_ready, v_deleted, v_paths;
end;
$$;

-- Explicit draft discard uses the same lock order and persists all raw and
-- canonical paths before deleting any relational row.
create or replace function public.discard_incomplete_intake_draft(
  p_owner_id uuid,
  p_brief_id uuid
)
returns table (
  issuance_id uuid,
  state text,
  raw_cleanup_state text,
  raw_removed_at timestamptz,
  cleanup_object_paths text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brief public.brief%rowtype;
  v_paths text[] := '{}'::text[];
  v_canonical text[] := '{}'::text[];
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  perform i.id
  from public.intake_issuance i
  where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
  order by i.id
  for update;
  if not found then return; end if;

  select b.* into v_brief
  from public.brief b
  join public.shop s on s.id = b.shop_id
  where b.id = p_brief_id and s.owner_id = p_owner_id
  for update of b;
  if not found then return; end if;

  perform r.id
  from public.revision r
  where r.brief_id = p_brief_id
  order by r.id
  for update;

  if v_brief.status <> 'draft'
    or v_brief.approved_revision_id is not null
    or v_brief.shared_revision_id is not null
    or exists (select 1 from public.review_session rs where rs.brief_id = p_brief_id)
    or exists (
      select 1 from public.revision r
      where r.brief_id = p_brief_id
        and (
          r.locked_at is not null
          or nullif(trim(r.garment_spec ->> 'intake_ready_at'), '') is not null
        )
    )
    or exists (
      select 1 from public.intake_issuance i
      where i.issued_brief_id = p_brief_id
        and (
          i.state in ('ready', 'finalizing')
          or i.ready_at is not null
          or i.raw_cleanup_state = 'cleaning'
        )
    ) then
    return;
  end if;

  select coalesce(array_agg(path order by path), '{}'::text[])
  into v_paths
  from (
    select i.raw_body_path as path from public.intake_issuance i
      where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
    union
    select i.raw_reference_path from public.intake_issuance i
      where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
    union
    select i.body_path from public.intake_issuance i
      where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
    union
    select i.reference_path from public.intake_issuance i
      where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
  ) intake_paths;
  select coalesce(array_agg(path order by path), '{}'::text[])
  into v_canonical
  from (
    select r.body_path as path from public.revision r where r.brief_id = p_brief_id
    union
    select r.reference_path from public.revision r where r.brief_id = p_brief_id
    union
    select r.render_path from public.revision r
      where r.brief_id = p_brief_id and r.render_path is not null
  ) revision_paths;
  v_paths := public.merge_intake_cleanup_paths(v_paths, v_canonical);

  update public.intake_issuance i
  set state = case when i.state in ('reserved', 'issued') then 'cancelled' else i.state end,
      cleanup_object_paths = public.merge_intake_cleanup_paths(i.cleanup_object_paths, v_paths),
      raw_cleanup_state = case
        when i.raw_cleanup_state = 'deleted'
          and public.merge_intake_cleanup_paths(i.cleanup_object_paths, v_paths)
            is distinct from i.cleanup_object_paths
          then 'cleanup_required'
        else i.raw_cleanup_state
      end,
      cleanup_attempted_at = clock_timestamp(),
      last_error = null
  where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id;

  -- ON DELETE SET NULL preserves each issuance and its object manifest.
  delete from public.brief where id = p_brief_id;
  if not found then return; end if;

  return query
  select i.id, i.state, i.raw_cleanup_state, i.raw_removed_at,
    public.merge_intake_cleanup_paths(i.cleanup_object_paths, v_paths)
  from public.intake_issuance i
  where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
  order by i.id;
end;
$$;

-- Preserve a historical deletion timestamp when an expanded manifest is
-- reopened, then closed again.
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
      raw_deleted_at = case
        when p_succeeded then coalesce(raw_deleted_at, completion_time)
        else raw_deleted_at
      end,
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

revoke all on function public.reserve_intake_issuance(uuid, uuid, uuid, uuid, uuid, uuid)
  from service_role;
revoke all on function public.create_intake_reservation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.claim_intake_finalization(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_intake_finalization(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.release_intake_finalization(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_intake_cleanup(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_claimed_intake_cleanup(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.discard_incomplete_intake_draft(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_intake_cleanup(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_intake_reservation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz
) to service_role;
grant execute on function public.claim_intake_finalization(uuid, uuid, uuid)
  to service_role;
grant execute on function public.commit_intake_finalization(uuid, uuid, jsonb, jsonb)
  to service_role;
grant execute on function public.release_intake_finalization(uuid, uuid, text, boolean)
  to service_role;
grant execute on function public.claim_intake_cleanup(integer) to service_role;
grant execute on function public.reconcile_claimed_intake_cleanup(uuid, uuid)
  to service_role;
grant execute on function public.discard_incomplete_intake_draft(uuid, uuid)
  to service_role;
grant execute on function public.complete_intake_cleanup(uuid, uuid, boolean, text)
  to service_role;
