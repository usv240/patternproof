-- Allow consent cleanup only inside an already-authorized parent cascade.
-- Direct consent mutation remains locked whenever its brief still exists.
begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;
  if current_migration not in (21, 22) then
    raise exception 'Migration 022 requires release 21 (or 22 for rerun), found %', current_migration;
  end if;
end;
$$;

create or replace function public.prevent_locked_consent_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare bid uuid;
begin
  if tg_op = 'UPDATE' and new.brief_id is distinct from old.brief_id then
    raise exception 'Consent cannot move between briefs';
  end if;
  bid := case when tg_op = 'INSERT' then new.brief_id else old.brief_id end;

  -- A parent DELETE has already passed the fenced draft-discard checks before
  -- its ON DELETE CASCADE reaches consent. No standalone consent row can reach
  -- this branch because the foreign key forbids an absent parent.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.brief b where b.id = bid
  ) then
    return old;
  end if;

  perform 1 from public.brief b
  where b.id = bid
    and b.status <> 'awaiting_customer'
    and not exists (
      select 1 from public.revision r where r.brief_id = b.id and r.locked_at is not null
    )
  for update of b;
  if not found then raise exception 'Consent for a reviewed Cut Card is immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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

  -- Capture the response before ON DELETE SET NULL clears issued_brief_id.
  -- RETURN QUERY buffers these rows; the transaction still rolls back them if
  -- the fenced parent deletion or a cascade trigger fails.
  return query
  select i.id, i.state, i.raw_cleanup_state, i.raw_removed_at,
    public.merge_intake_cleanup_paths(i.cleanup_object_paths, v_paths)
  from public.intake_issuance i
  where i.owner_id = p_owner_id and i.issued_brief_id = p_brief_id
  order by i.id;

  delete from public.brief where id = p_brief_id;
  if not found then
    raise exception 'Draft disappeared during cleanup' using errcode = '40001';
  end if;
  return;
end;
$$;

update public.patternproof_release
set migration = 22, installed_at = clock_timestamp()
where singleton = true and migration = 21;

do $$ begin
  if not exists (select 1 from public.patternproof_release where singleton and migration = 22) then
    raise exception 'Migration 022 did not advance the release sentinel';
  end if;
end; $$;

commit;
