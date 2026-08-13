-- Link each new spatial note to the exact customer non-negotiable it explains.
-- Existing unlinked notes remain readable for backward-compatible frozen proofs.

begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;
  if current_migration is null then raise exception 'PatternProof release sentinel is missing'; end if;
  if current_migration not in (18, 19) then
    raise exception 'Migration 019 requires release 18 (or 19 for an exact rerun), found %', current_migration;
  end if;
end;
$$;

alter table public.annotation
  add column if not exists requirement_id uuid references public.requirement(id) on delete restrict;

create or replace function public.assert_annotation_requirement_matches_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.requirement_id is not null and not exists (
    select 1 from public.requirement requirement
    where requirement.id = new.requirement_id
      and requirement.revision_id = new.revision_id
  ) then
    raise exception 'Pinned requirement must belong to the same revision'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists annotation_requirement_matches_revision on public.annotation;
create trigger annotation_requirement_matches_revision
before insert or update of revision_id, requirement_id on public.annotation
for each row execute function public.assert_annotation_requirement_matches_revision();

revoke all privileges on table public.annotation from public, anon, authenticated;
grant select on table public.annotation to authenticated;
grant insert (revision_id, requirement_id, author_role, anchor_x, anchor_y, body)
  on table public.annotation to authenticated;
grant delete on table public.annotation to authenticated;

create or replace function public.build_revision_snapshot(p_revision_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'schema_version', 'patternproof-review-v2',
    'shop', jsonb_build_object('id', s.id, 'name', s.name),
    'brief', jsonb_build_object('id', b.id, 'customer_label', b.customer_label),
    'revision', jsonb_build_object(
      'id', r.id, 'version', r.version, 'reference_path', r.reference_path,
      'render_path', r.render_path,
      'reference_sha256', r.garment_spec #>> '{normalized_images,reference,sha256}',
      'render_sha256', r.render_hash, 'category', r.garment_spec ->> 'category',
      'created_at', r.created_at
    ),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'label', q.label, 'note', q.note, 'created_at', q.created_at,
        'feasibility', case when f.id is null then null else jsonb_build_object(
          'id', f.id, 'status', f.status, 'tailor_note', f.tailor_note,
          'created_at', f.created_at
        ) end
      ) order by q.created_at, q.id)
      from public.requirement q left join public.feasibility f on f.requirement_id = q.id
      where q.revision_id = r.id
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'requirement_id', a.requirement_id, 'author_role', a.author_role,
        'anchor_x', a.anchor_x, 'anchor_y', a.anchor_y, 'body', a.body,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.annotation a where a.revision_id = r.id
    ), '[]'::jsonb),
    'consent', (select jsonb_build_object(
      'scope', c.scope, 'rights_confirmed', c.rights_confirmed,
      'body_processing_confirmed', c.body_processing_confirmed,
      'policy_version', c.policy_version, 'granted_at', c.granted_at
    ) from public.consent c where c.brief_id = b.id order by c.granted_at desc, c.id desc limit 1)
  ) into result
  from public.revision r
  join public.brief b on b.id = r.brief_id
  join public.shop s on s.id = b.shop_id
  where r.id = p_revision_id;
  if result is null then
    raise exception 'Revision snapshot source was not found' using errcode = '22023';
  end if;
  return result;
end;
$$;

update public.patternproof_release
set migration = 19, installed_at = clock_timestamp()
where singleton = true and migration = 18;

do $$
begin
  if not exists (select 1 from public.patternproof_release where singleton = true and migration = 19) then
    raise exception 'Migration 019 did not advance the release sentinel';
  end if;
end;
$$;

commit;
