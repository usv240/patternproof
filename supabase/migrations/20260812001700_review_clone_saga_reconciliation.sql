-- Reconcile late Storage writes after a clone reservation has been cleaned.
-- Run after 013_review_clone_saga_lockdown.sql and before 014.

create index if not exists review_revision_clone_cleaned_reconciliation_idx
  on public.review_revision_clone (cleaned_at, id)
  where state = 'cleaned';

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
      or (
        old.state = 'cleaned'
        and new.state = 'cleaning'
        and new.cleaned_at is null
        and exists (
          select 1
          from storage.objects object
          where object.bucket_id = 'brief-images'
            and object.name = any(old.cleanup_object_paths)
        )
      )
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

  if (
      old.body_sha256 is not null
      and new.body_sha256 is distinct from old.body_sha256
    ) or (
      old.reference_sha256 is not null
      and new.reference_sha256 is distinct from old.reference_sha256
    ) or (
      old.committed_at is not null
      and new.committed_at is distinct from old.committed_at
    ) or (
      old.cleaned_at is not null
      and new.cleaned_at is distinct from old.cleaned_at
      and not (
        old.state = 'cleaned'
        and new.state = 'cleaning'
        and new.cleaned_at is null
      )
    ) then
    raise exception 'Review clone completion evidence is immutable' using errcode = '22023';
  end if;

  new.updated_at := mutation_time;
  return new;
end;
$$;

-- Expired reservations, failed cleanups, stale claims, and exact objects that
-- reappeared after a successful cleanup all return through one fenced queue.
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
      or (
        c.state = 'cleaned'
        and exists (
          select 1
          from storage.objects object
          where object.bucket_id = 'brief-images'
            and object.name = any(c.cleanup_object_paths)
        )
      )
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
        cleaned_at = null,
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
  cleanup_succeeded boolean := coalesce(p_succeeded, false);
  cleanup_error text := nullif(trim(p_error), '');
  completed boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  perform 1
  from public.review_revision_clone c
  where c.id = p_clone_id
    and c.state = 'cleaning'
    and c.cleanup_claim_id = p_cleanup_claim_id
  for update;
  if not found then
    return false;
  end if;

  if cleanup_succeeded and exists (
    select 1
    from public.review_revision_clone c
    join storage.objects object
      on object.bucket_id = 'brief-images'
      and object.name = any(c.cleanup_object_paths)
    where c.id = p_clone_id
  ) then
    cleanup_succeeded := false;
    cleanup_error := 'A cloned target object still exists after cleanup.';
  end if;

  update public.review_revision_clone
  set state = case
        when cleanup_succeeded then 'cleaned'
        else 'cleanup_required'
      end,
      cleanup_claim_id = null,
      cleanup_claimed_at = null,
      cleanup_attempted_at = completion_time,
      cleaned_at = case when cleanup_succeeded then completion_time else null end,
      last_error = case
        when cleanup_succeeded then null
        else left(coalesce(cleanup_error,
          'Review clone object cleanup requires retry.'), 1000)
      end
  where id = p_clone_id
    and state = 'cleaning'
    and cleanup_claim_id = p_cleanup_claim_id
  returning true into completed;
  -- True means the fenced claim committed and Storage absence was proven.
  -- A late object reappearance requeues the row and must not report "cleaned".
  return coalesce(completed and cleanup_succeeded, false);
end;
$$;

revoke all on function public.guard_review_revision_clone_update()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_review_revision_clone_cleanup(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_review_revision_clone_cleanup(
  uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;

grant execute on function public.claim_review_revision_clone_cleanup(integer)
  to service_role;
grant execute on function public.complete_review_revision_clone_cleanup(
  uuid, uuid, boolean, text
) to service_role;
