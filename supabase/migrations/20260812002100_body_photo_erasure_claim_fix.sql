-- Forward fix for PostgreSQL 42702 in claim_body_photo_erasure.
-- The function returns a column named revision_id, so an unqualified
-- ON CONFLICT (revision_id) is ambiguous inside PL/pgSQL. Target the table's
-- named unique constraint instead. Safe to rerun at release 17.

begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;

  if current_migration is null then
    raise exception 'PatternProof release sentinel is missing';
  end if;
  if current_migration not in (16, 17) then
    raise exception 'Migration 017 requires release 16 (or 17 for an exact rerun), found %',
      current_migration;
  end if;
end;
$$;

create or replace function public.claim_body_photo_erasure(p_brief_id uuid)
returns table (
  erasure_id uuid,
  shop_id uuid,
  brief_id uuid,
  revision_id uuid,
  body_path text,
  erasure_status text,
  claim_id uuid,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_time timestamptz := clock_timestamp();
  target_owner_id uuid;
  target_shop_id uuid;
  target_revision_id uuid;
  target_body_path text;
  target_erasure public.body_photo_erasure%rowtype;
  new_claim_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select s.owner_id, b.shop_id, b.approved_revision_id, r.body_path
    into target_owner_id, target_shop_id, target_revision_id, target_body_path
  from public.brief b
  join public.shop s on s.id = b.shop_id
  join public.revision r on r.id = b.approved_revision_id and r.brief_id = b.id
  where b.id = p_brief_id
    and b.status in ('approved', 'archived')
    and r.locked_at is not null
  for update of b, r;
  if not found then
    raise exception 'Only an approved customer photo can be erased' using errcode = '55000';
  end if;
  if target_body_path <> target_shop_id::text || '/' || p_brief_id::text || '/'
      || target_revision_id::text || '/body.jpg' then
    raise exception 'Approved body path is not canonical' using errcode = '22023';
  end if;

  insert into public.body_photo_erasure (
    owner_id, shop_id, brief_id, revision_id, body_path, requested_at, updated_at
  ) values (
    target_owner_id, target_shop_id, p_brief_id, target_revision_id,
    target_body_path, operation_time, operation_time
  ) on conflict on constraint body_photo_erasure_revision_id_key do nothing;

  select e.* into target_erasure
  from public.body_photo_erasure e
  where e.revision_id = target_revision_id
  for update;

  if target_erasure.status = 'completed' then
    return query select
      target_erasure.id, target_erasure.shop_id, target_erasure.brief_id,
      target_erasure.revision_id, target_erasure.body_path, target_erasure.status,
      null::uuid, target_erasure.completed_at;
    return;
  end if;
  if target_erasure.status = 'processing'
    and target_erasure.claimed_at > operation_time - interval '15 minutes' then
    raise exception 'Body-photo erasure is already processing' using errcode = '55000';
  end if;

  new_claim_id := pg_catalog.gen_random_uuid();
  update public.body_photo_erasure
  set status = 'processing',
      claim_id = new_claim_id,
      claimed_at = operation_time,
      last_error = null
  where id = target_erasure.id
  returning * into target_erasure;

  return query select
    target_erasure.id, target_erasure.shop_id, target_erasure.brief_id,
    target_erasure.revision_id, target_erasure.body_path, target_erasure.status,
    target_erasure.claim_id, target_erasure.completed_at;
end;
$$;

revoke all on function public.claim_body_photo_erasure(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_body_photo_erasure(uuid) to service_role;

update public.patternproof_release
set migration = 17,
    installed_at = clock_timestamp()
where singleton = true
  and migration = 16;

do $$
begin
  if not exists (
    select 1 from public.patternproof_release
    where singleton = true and migration = 17
  ) then
    raise exception 'Migration 017 did not advance the release sentinel';
  end if;
end;
$$;

commit;
