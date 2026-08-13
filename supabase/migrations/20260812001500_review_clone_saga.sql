-- Fenced withdrawal + revision-clone saga.
-- Run after 011_intake_atomicity.sql and before the final release sentinel.

-- A clone reservation names its target object keys before Storage is touched.
-- The target revision does not become visible until both exact private objects
-- exist and commit_review_revision_clone publishes every relational row in one
-- transaction. Uncommitted target objects remain covered by this manifest.
create table public.review_revision_clone (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  shop_id uuid not null references public.shop(id),
  brief_id uuid not null references public.brief(id),
  source_revision_id uuid not null references public.revision(id),
  source_version integer not null check (source_version > 0),
  target_revision_id uuid not null unique,
  target_issuance_id uuid not null unique,
  target_upload_nonce uuid not null unique,
  target_version integer not null,
  reason text not null check (char_length(reason) between 5 and 1000),
  source_body_path text not null,
  source_reference_path text not null,
  target_body_path text not null unique,
  target_reference_path text not null unique,
  cleanup_object_paths text[] not null,
  state text not null default 'reserved'
    check (state in ('reserved', 'cleaning', 'cleanup_required', 'cleaned', 'committed')),
  body_sha256 text,
  reference_sha256 text,
  created_at timestamptz not null,
  reservation_expires_at timestamptz not null,
  cleanup_claim_id uuid,
  cleanup_claimed_at timestamptz,
  cleanup_attempted_at timestamptz,
  cleaned_at timestamptz,
  committed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  updated_at timestamptz not null,
  constraint review_revision_clone_version_check
    check (target_version = source_version + 1),
  constraint review_revision_clone_source_body_path_check check (
    source_body_path = shop_id::text || '/' || brief_id::text || '/'
      || source_revision_id::text || '/body.jpg'
  ),
  constraint review_revision_clone_source_reference_path_check check (
    source_reference_path = shop_id::text || '/' || brief_id::text || '/'
      || source_revision_id::text || '/reference.jpg'
  ),
  constraint review_revision_clone_target_body_path_check check (
    target_body_path = shop_id::text || '/' || brief_id::text || '/'
      || target_revision_id::text || '/body.jpg'
  ),
  constraint review_revision_clone_target_reference_path_check check (
    target_reference_path = shop_id::text || '/' || brief_id::text || '/'
      || target_revision_id::text || '/reference.jpg'
  ),
  constraint review_revision_clone_manifest_check check (
    cardinality(cleanup_object_paths) = 2
    and cleanup_object_paths @> array[target_body_path, target_reference_path]
    and cleanup_object_paths <@ array[target_body_path, target_reference_path]
  ),
  constraint review_revision_clone_expiry_check check (
    reservation_expires_at = created_at + interval '30 minutes'
  ),
  constraint review_revision_clone_claim_check check (
    (
      state = 'cleaning'
      and cleanup_claim_id is not null
      and cleanup_claimed_at is not null
    ) or (
      state <> 'cleaning'
      and cleanup_claim_id is null
      and cleanup_claimed_at is null
    )
  ),
  constraint review_revision_clone_commit_check check (
    (
      state = 'committed'
      and committed_at is not null
      and body_sha256 ~ '^[0-9a-f]{64}$'
      and reference_sha256 ~ '^[0-9a-f]{64}$'
    ) or (
      state <> 'committed'
      and committed_at is null
      and body_sha256 is null
      and reference_sha256 is null
    )
  ),
  constraint review_revision_clone_cleaned_check check (
    (state = 'cleaned') = (cleaned_at is not null)
  )
);

create unique index review_revision_clone_one_active_brief_idx
  on public.review_revision_clone (brief_id)
  where state in ('reserved', 'cleaning');
create index review_revision_clone_owner_created_idx
  on public.review_revision_clone (owner_id, created_at desc);
create index review_revision_clone_cleanup_idx
  on public.review_revision_clone (state, reservation_expires_at, updated_at)
  where state in ('reserved', 'cleaning', 'cleanup_required');

alter table public.review_revision_clone enable row level security;
revoke all on public.review_revision_clone
  from public, anon, authenticated, service_role;

create or replace function public.guard_review_revision_clone_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare mutation_time timestamptz := clock_timestamp();
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Review clone reservations are service-managed'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Review clone audit rows are immutable' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.shop_id is distinct from old.shop_id
    or new.brief_id is distinct from old.brief_id
    or new.source_revision_id is distinct from old.source_revision_id
    or new.source_version is distinct from old.source_version
    or new.target_revision_id is distinct from old.target_revision_id
    or new.target_issuance_id is distinct from old.target_issuance_id
    or new.target_upload_nonce is distinct from old.target_upload_nonce
    or new.target_version is distinct from old.target_version
    or new.reason is distinct from old.reason
    or new.source_body_path is distinct from old.source_body_path
    or new.source_reference_path is distinct from old.source_reference_path
    or new.target_body_path is distinct from old.target_body_path
    or new.target_reference_path is distinct from old.target_reference_path
    or new.cleanup_object_paths is distinct from old.cleanup_object_paths
    or new.created_at is distinct from old.created_at
    or new.reservation_expires_at is distinct from old.reservation_expires_at then
    raise exception 'Review clone reservation identity and manifest are immutable'
      using errcode = '22023';
  end if;

  if new.state is distinct from old.state then
    if not (
      (old.state = 'reserved' and new.state = 'committed'
        and old.reservation_expires_at > mutation_time)
      or (old.state = 'reserved' and new.state = 'cleanup_required')
      or (old.state = 'reserved' and new.state = 'cleaning'
        and old.reservation_expires_at <= mutation_time)
      or (old.state = 'cleanup_required' and new.state = 'cleaning')
      or (old.state = 'cleaning' and new.state in ('cleaned', 'cleanup_required'))
    ) then
      raise exception 'Invalid review clone state transition' using errcode = '22023';
    end if;
  elsif old.state = 'cleaning' then
    if new.cleanup_claim_id is distinct from old.cleanup_claim_id
      or new.cleanup_claimed_at is distinct from old.cleanup_claimed_at then
      if old.cleanup_claimed_at > mutation_time - interval '15 minutes' then
        raise exception 'Active review clone cleanup claim is immutable'
          using errcode = '55000';
      end if;
    end if;
  elsif new is distinct from old then
    raise exception 'Terminal review clone state is immutable' using errcode = '22023';
  end if;

  if old.body_sha256 is not null and new.body_sha256 is distinct from old.body_sha256
    or old.reference_sha256 is not null
      and new.reference_sha256 is distinct from old.reference_sha256
    or old.committed_at is not null and new.committed_at is distinct from old.committed_at
    or old.cleaned_at is not null and new.cleaned_at is distinct from old.cleaned_at then
    raise exception 'Review clone completion evidence is immutable' using errcode = '22023';
  end if;

  new.updated_at := mutation_time;
  return new;
end;
$$;

drop trigger if exists review_revision_clone_update_guard
  on public.review_revision_clone;
create trigger review_revision_clone_update_guard
before update or delete on public.review_revision_clone
for each row execute function public.guard_review_revision_clone_update();

revoke all on function public.guard_review_revision_clone_update()
  from public, anon, authenticated, service_role;

-- Reserve one v+1 target per active brief. The owner advisory lock and brief
-- row lock make retries converge even when the caller lost the first response.
create or replace function public.reserve_review_revision_clone(
  p_owner_id uuid,
  p_brief_id uuid,
  p_reason text
)
returns table (
  clone_id uuid,
  clone_state text,
  source_revision_id uuid,
  target_revision_id uuid,
  target_issuance_id uuid,
  source_body_path text,
  source_reference_path text,
  target_body_path text,
  target_reference_path text,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_time timestamptz := clock_timestamp();
  safe_reason text := trim(coalesce(p_reason, ''));
  v_brief public.brief%rowtype;
  v_source public.revision%rowtype;
  v_session public.review_session%rowtype;
  v_clone public.review_revision_clone%rowtype;
  v_target_revision_id uuid;
  v_target_issuance_id uuid;
  v_target_upload_nonce uuid;
  v_target_body_path text;
  v_target_reference_path text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_brief_id is null then
    raise exception 'Clone owner and brief are required' using errcode = '22023';
  end if;
  if char_length(safe_reason) not between 5 and 1000 then
    raise exception 'Withdrawal reason must be 5 to 1000 characters'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 13013)
  );

  select b.* into v_brief
  from public.brief b
  join public.shop s on s.id = b.shop_id
  where b.id = p_brief_id
    and s.owner_id = p_owner_id
  for update of b;
  if not found then
    raise exception 'Owned brief was not found' using errcode = '42501';
  end if;
  if v_brief.status <> 'awaiting_customer'
    or v_brief.shared_revision_id is null
    or v_brief.approved_revision_id is not null then
    raise exception 'An active customer review is required' using errcode = '55000';
  end if;

  select r.* into v_source
  from public.revision r
  where r.id = v_brief.shared_revision_id
    and r.brief_id = v_brief.id
    and r.locked_at is null
  for update;
  if not found then
    raise exception 'Active review revision was not found' using errcode = '55000';
  end if;

  select rs.* into v_session
  from public.review_session rs
  where rs.brief_id = v_brief.id
    and rs.revision_id = v_source.id
    and rs.state = 'active'
  for update;
  if not found then
    raise exception 'Active review session was not found' using errcode = '55000';
  end if;

  if coalesce(v_source.garment_spec #>> '{normalized_images,body,sha256}', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(v_source.garment_spec #>> '{normalized_images,reference,sha256}', '')
      !~ '^[0-9a-f]{64}$' then
    raise exception 'Reviewed source images lack verified provenance'
      using errcode = '55000';
  end if;

  perform 1
  from storage.buckets bucket
  join storage.objects body_object
    on body_object.bucket_id = bucket.id and body_object.name = v_source.body_path
  join storage.objects reference_object
    on reference_object.bucket_id = bucket.id
      and reference_object.name = v_source.reference_path
  where bucket.id = 'brief-images' and not bucket.public
  for key share of body_object, reference_object;
  if not found then
    raise exception 'Reviewed source images are not present in private storage'
      using errcode = '55000';
  end if;

  update public.review_revision_clone c
  set state = 'cleanup_required',
      last_error = 'Review clone reservation expired before commit.'
  where c.brief_id = v_brief.id
    and c.state = 'reserved'
    and c.reservation_expires_at <= reservation_time;

  select c.* into v_clone
  from public.review_revision_clone c
  where c.brief_id = v_brief.id
    and c.state in ('reserved', 'cleaning')
  order by c.created_at desc
  limit 1
  for update;
  if found then
    return query select
      v_clone.id, v_clone.state, v_clone.source_revision_id,
      v_clone.target_revision_id, v_clone.target_issuance_id,
      v_clone.source_body_path, v_clone.source_reference_path,
      v_clone.target_body_path, v_clone.target_reference_path,
      v_clone.reservation_expires_at;
    return;
  end if;

  v_target_revision_id := pg_catalog.gen_random_uuid();
  v_target_issuance_id := pg_catalog.gen_random_uuid();
  v_target_upload_nonce := pg_catalog.gen_random_uuid();
  v_target_body_path := v_brief.shop_id::text || '/' || v_brief.id::text || '/'
    || v_target_revision_id::text || '/body.jpg';
  v_target_reference_path := v_brief.shop_id::text || '/' || v_brief.id::text || '/'
    || v_target_revision_id::text || '/reference.jpg';

  insert into public.review_revision_clone (
    owner_id, shop_id, brief_id, source_revision_id, source_version,
    target_revision_id, target_issuance_id, target_upload_nonce, target_version,
    reason, source_body_path, source_reference_path,
    target_body_path, target_reference_path, cleanup_object_paths,
    state, created_at, reservation_expires_at, updated_at
  ) values (
    p_owner_id, v_brief.shop_id, v_brief.id, v_source.id, v_source.version,
    v_target_revision_id, v_target_issuance_id, v_target_upload_nonce,
    v_source.version + 1, safe_reason, v_source.body_path,
    v_source.reference_path, v_target_body_path, v_target_reference_path,
    array[v_target_body_path, v_target_reference_path], 'reserved',
    reservation_time, reservation_time + interval '30 minutes', reservation_time
  ) returning * into v_clone;

  return query select
    v_clone.id, v_clone.state, v_clone.source_revision_id,
    v_clone.target_revision_id, v_clone.target_issuance_id,
    v_clone.source_body_path, v_clone.source_reference_path,
    v_clone.target_body_path, v_clone.target_reference_path,
    v_clone.reservation_expires_at;
end;
$$;

-- Commit is idempotent. The reviewed source remains as immutable evidence; the
-- editable target receives copied requirements but no feasibility or annotation
-- rows, and no render, so human review and rendering must be performed again.
create or replace function public.commit_review_revision_clone(
  p_clone_id uuid,
  p_body_sha256 text,
  p_reference_sha256 text
)
returns table (
  committed boolean,
  brief_id uuid,
  source_revision_id uuid,
  target_revision_id uuid,
  target_issuance_id uuid,
  target_version integer,
  ready_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  commit_time timestamptz := clock_timestamp();
  normalized_body_hash text := lower(trim(coalesce(p_body_sha256, '')));
  normalized_reference_hash text := lower(trim(coalesce(p_reference_sha256, '')));
  pre_owner_id uuid;
  pre_brief_id uuid;
  pre_source_revision_id uuid;
  v_brief public.brief%rowtype;
  v_source public.revision%rowtype;
  v_session public.review_session%rowtype;
  v_clone public.review_revision_clone%rowtype;
  v_source_body_hash text;
  v_source_reference_hash text;
  v_target_spec jsonb;
  v_raw_body_path text;
  v_raw_reference_path text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_clone_id is null
    or normalized_body_hash !~ '^[0-9a-f]{64}$'
    or normalized_reference_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact clone identity and image hashes are required'
      using errcode = '22023';
  end if;

  select c.owner_id, c.brief_id, c.source_revision_id
    into pre_owner_id, pre_brief_id, pre_source_revision_id
  from public.review_revision_clone c
  where c.id = p_clone_id;
  if not found then
    return query select false, null::uuid, null::uuid, null::uuid,
      null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pre_owner_id::text, 13013)
  );

  select b.* into v_brief
  from public.brief b
  join public.shop s on s.id = b.shop_id
  where b.id = pre_brief_id and s.owner_id = pre_owner_id
  for update of b;
  if not found then
    raise exception 'Clone brief ownership changed' using errcode = '42501';
  end if;

  select r.* into v_source
  from public.revision r
  where r.id = pre_source_revision_id and r.brief_id = v_brief.id
  for update;
  if not found then
    raise exception 'Clone source revision was not found' using errcode = '55000';
  end if;

  select rs.* into v_session
  from public.review_session rs
  where rs.brief_id = v_brief.id and rs.revision_id = v_source.id
  for update;
  if not found then
    raise exception 'Clone review evidence was not found' using errcode = '55000';
  end if;

  select c.* into v_clone
  from public.review_revision_clone c
  where c.id = p_clone_id
    and c.owner_id = pre_owner_id
    and c.brief_id = pre_brief_id
    and c.source_revision_id = pre_source_revision_id
  for update;
  if not found then
    return query select false, null::uuid, null::uuid, null::uuid,
      null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  if v_clone.state = 'committed' then
    if v_clone.body_sha256 <> normalized_body_hash
      or v_clone.reference_sha256 <> normalized_reference_hash
      or not exists (
        select 1 from public.revision r
        where r.id = v_clone.target_revision_id
          and r.brief_id = v_clone.brief_id
          and r.version = v_clone.target_version
          and r.body_path = v_clone.target_body_path
          and r.reference_path = v_clone.target_reference_path
          and r.garment_spec #>> '{normalized_images,body,sha256}' = v_clone.body_sha256
          and r.garment_spec #>> '{normalized_images,reference,sha256}'
            = v_clone.reference_sha256
      ) or not exists (
        select 1 from public.intake_issuance i
        where i.id = v_clone.target_issuance_id
          and i.revision_id = v_clone.target_revision_id
          and i.state = 'ready'
          and i.ready_at = v_clone.committed_at
      ) then
      raise exception 'Committed clone evidence does not match this retry'
        using errcode = '55000';
    end if;
    return query select true, v_clone.brief_id, v_clone.source_revision_id,
      v_clone.target_revision_id, v_clone.target_issuance_id,
      v_clone.target_version, v_clone.committed_at;
    return;
  end if;

  if v_clone.state <> 'reserved' then
    return query select false, v_clone.brief_id, v_clone.source_revision_id,
      v_clone.target_revision_id, v_clone.target_issuance_id,
      v_clone.target_version, null::timestamptz;
    return;
  end if;
  if v_clone.reservation_expires_at <= commit_time then
    update public.review_revision_clone
    set state = 'cleanup_required',
        last_error = 'Review clone commit arrived after its reservation expired.'
    where id = v_clone.id;
    return query select false, v_clone.brief_id, v_clone.source_revision_id,
      v_clone.target_revision_id, v_clone.target_issuance_id,
      v_clone.target_version, null::timestamptz;
    return;
  end if;

  if v_brief.status <> 'awaiting_customer'
    or v_brief.shared_revision_id is distinct from v_source.id
    or v_brief.approved_revision_id is not null
    or v_session.state <> 'active'
    or v_source.locked_at is not null
    or v_source.version <> v_clone.source_version
    or v_clone.target_version <> v_source.version + 1
    or v_source.body_path <> v_clone.source_body_path
    or v_source.reference_path <> v_clone.source_reference_path
    or exists (
      select 1 from public.revision r
      where r.brief_id = v_brief.id and r.version >= v_clone.target_version
    ) then
    raise exception 'Customer review changed before clone commit'
      using errcode = '55000';
  end if;

  v_source_body_hash := lower(coalesce(
    v_source.garment_spec #>> '{normalized_images,body,sha256}', ''
  ));
  v_source_reference_hash := lower(coalesce(
    v_source.garment_spec #>> '{normalized_images,reference,sha256}', ''
  ));
  if v_source_body_hash !~ '^[0-9a-f]{64}$'
    or v_source_reference_hash !~ '^[0-9a-f]{64}$'
    or normalized_body_hash <> v_source_body_hash
    or normalized_reference_hash <> v_source_reference_hash
    or v_source.garment_spec #>> '{normalized_images,body,format}' <> 'jpeg'
    or v_source.garment_spec #>> '{normalized_images,reference,format}' <> 'jpeg'
    or coalesce(v_source.garment_spec #>> '{normalized_images,body,width}', '')
      !~ '^[1-9][0-9]*$'
    or coalesce(v_source.garment_spec #>> '{normalized_images,body,height}', '')
      !~ '^[1-9][0-9]*$'
    or coalesce(v_source.garment_spec #>> '{normalized_images,reference,width}', '')
      !~ '^[1-9][0-9]*$'
    or coalesce(v_source.garment_spec #>> '{normalized_images,reference,height}', '')
      !~ '^[1-9][0-9]*$' then
    raise exception 'Clone hashes do not match verified source provenance'
      using errcode = '22023';
  end if;

  perform 1
  from storage.buckets bucket
  join storage.objects body_object
    on body_object.bucket_id = bucket.id
      and body_object.name = v_clone.target_body_path
  join storage.objects reference_object
    on reference_object.bucket_id = bucket.id
      and reference_object.name = v_clone.target_reference_path
  where bucket.id = 'brief-images' and not bucket.public
  for key share of body_object, reference_object;
  if not found then
    raise exception 'Both exact cloned images must exist in private storage'
      using errcode = '55000';
  end if;

  update public.review_session
  set state = 'withdrawn', ended_at = commit_time, reason = v_clone.reason
  where id = v_session.id and state = 'active';
  if not found then
    raise exception 'Active review session changed before clone commit'
      using errcode = '55000';
  end if;

  update public.brief
  set status = 'awaiting_tailor',
      shared_revision_id = null,
      shared_snapshot = null,
      shared_snapshot_sha256 = null,
      review_started_at = null,
      share_token_revoked_at = commit_time
  where id = v_brief.id;

  v_target_spec := (v_source.garment_spec - 'intake_ready_at')
    || pg_catalog.jsonb_build_object(
      'intake_ready_at', commit_time,
      'normalized_images', v_source.garment_spec -> 'normalized_images',
      'cloned_from_revision_id', v_source.id,
      'clone_reservation_id', v_clone.id
    );

  insert into public.revision (
    id, brief_id, version, reference_path, body_path, render_path, render_hash,
    garment_spec, locked_at, created_at
  ) values (
    v_clone.target_revision_id, v_clone.brief_id, v_clone.target_version,
    v_clone.target_reference_path, v_clone.target_body_path, null, null,
    v_target_spec, null, commit_time
  );

  insert into public.requirement (revision_id, label, note, created_at)
  select v_clone.target_revision_id, q.label, q.note, q.created_at
  from public.requirement q
  where q.revision_id = v_source.id
  order by q.created_at, q.id;

  v_raw_body_path := v_clone.shop_id::text || '/' || v_clone.brief_id::text || '/'
    || v_clone.target_revision_id::text || '/pending-'
    || v_clone.target_upload_nonce::text || '-body';
  v_raw_reference_path := v_clone.shop_id::text || '/' || v_clone.brief_id::text || '/'
    || v_clone.target_revision_id::text || '/pending-'
    || v_clone.target_upload_nonce::text || '-reference';

  insert into public.intake_issuance (
    id, owner_id, shop_id, brief_id, issued_brief_id, revision_id, upload_nonce,
    body_path, reference_path, raw_body_path, raw_reference_path,
    state, raw_cleanup_state, cleanup_object_paths,
    created_at, reservation_cleanup_after, ready_at,
    raw_removed_at, raw_deleted_at, updated_at
  ) values (
    v_clone.target_issuance_id, v_clone.owner_id, v_clone.shop_id,
    v_clone.brief_id, v_clone.brief_id, v_clone.target_revision_id,
    v_clone.target_upload_nonce, v_clone.target_body_path,
    v_clone.target_reference_path, v_raw_body_path, v_raw_reference_path,
    'ready', 'deleted', '{}'::text[], commit_time,
    commit_time + interval '3 hours', commit_time,
    commit_time, commit_time, commit_time
  );

  update public.review_revision_clone
  set state = 'committed',
      body_sha256 = normalized_body_hash,
      reference_sha256 = normalized_reference_hash,
      committed_at = commit_time,
      last_error = null
  where id = v_clone.id and state = 'reserved';
  if not found then
    raise exception 'Clone reservation changed before commit' using errcode = '55000';
  end if;

  return query select true, v_clone.brief_id, v_clone.source_revision_id,
    v_clone.target_revision_id, v_clone.target_issuance_id,
    v_clone.target_version, commit_time;
end;
$$;

create or replace function public.abort_review_revision_clone(
  p_clone_id uuid,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare aborted boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.review_revision_clone
  set state = 'cleanup_required',
      last_error = left(coalesce(nullif(trim(p_error), ''),
        'Review clone copy requires cleanup.'), 1000)
  where id = p_clone_id and state = 'reserved'
  returning true into aborted;
  if aborted then return true; end if;
  return exists (
    select 1 from public.review_revision_clone c
    where c.id = p_clone_id
      and c.state in ('cleaning', 'cleanup_required', 'cleaned')
  );
end;
$$;

create or replace function public.claim_review_revision_clone_cleanup(
  p_limit integer default 10
)
returns table (
  clone_id uuid,
  cleanup_claim_id uuid,
  cleanup_object_paths text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare claim_time timestamptz := clock_timestamp();
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select c.id
    from public.review_revision_clone c
    where (
      c.state = 'cleanup_required'
      or (c.state = 'reserved' and c.reservation_expires_at <= claim_time)
      or (c.state = 'cleaning'
        and c.cleanup_claimed_at <= claim_time - interval '15 minutes')
    )
    order by c.reservation_expires_at, c.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 25)
  ), claimed as (
    update public.review_revision_clone c
    set state = 'cleaning',
        cleanup_claim_id = pg_catalog.gen_random_uuid(),
        cleanup_claimed_at = claim_time,
        cleanup_attempted_at = claim_time,
        last_error = null
    from candidates candidate
    where c.id = candidate.id
    returning c.*
  )
  select c.id, c.cleanup_claim_id, c.cleanup_object_paths
  from claimed c;
end;
$$;

create or replace function public.complete_review_revision_clone_cleanup(
  p_clone_id uuid,
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
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.review_revision_clone
  set state = case when p_succeeded then 'cleaned' else 'cleanup_required' end,
      cleanup_claim_id = null,
      cleanup_claimed_at = null,
      cleanup_attempted_at = completion_time,
      cleaned_at = case when p_succeeded then completion_time else null end,
      last_error = case
        when p_succeeded then null
        else left(coalesce(nullif(trim(p_error), ''),
          'Review clone object cleanup requires retry.'), 1000)
      end
  where id = p_clone_id
    and state = 'cleaning'
    and cleanup_claim_id = p_cleanup_claim_id
  returning true into completed;
  return coalesce(completed, false);
end;
$$;

revoke all on function public.reserve_review_revision_clone(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_review_revision_clone(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.abort_review_revision_clone(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_review_revision_clone_cleanup(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_review_revision_clone_cleanup(
  uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;

grant execute on function public.reserve_review_revision_clone(uuid, uuid, text)
  to service_role;
grant execute on function public.commit_review_revision_clone(uuid, text, text)
  to service_role;
grant execute on function public.abort_review_revision_clone(uuid, text)
  to service_role;
grant execute on function public.claim_review_revision_clone_cleanup(integer)
  to service_role;
grant execute on function public.complete_review_revision_clone_cleanup(
  uuid, uuid, boolean, text
) to service_role;

-- A content digest may legitimately repeat across revisions. The object path,
-- which contains the revision UUID, is the unique persisted object identity.
alter table public.revision
  drop constraint if exists revision_render_hash_key;
drop index if exists public.revision_render_hash_key;
create unique index if not exists revision_render_path_unique_idx
  on public.revision (render_path)
  where render_path is not null;
