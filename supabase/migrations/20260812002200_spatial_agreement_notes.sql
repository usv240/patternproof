-- Editable, tenant-scoped spatial notes on a YouCam result. Notes are frozen by
-- the existing revision trigger as soon as customer review starts.

begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;
  if current_migration is null then raise exception 'PatternProof release sentinel is missing'; end if;
  if current_migration not in (17, 18) then
    raise exception 'Migration 018 requires release 17 (or 18 for an exact rerun), found %', current_migration;
  end if;
end;
$$;

revoke all privileges on table public.annotation from public, anon, authenticated;
grant select on table public.annotation to authenticated;
grant insert (revision_id, author_role, anchor_x, anchor_y, body)
  on table public.annotation to authenticated;
grant delete on table public.annotation to authenticated;

drop policy if exists "annotation owner access" on public.annotation;
drop policy if exists "tailors can read owned annotations" on public.annotation;
drop policy if exists "tailors can add owned annotations" on public.annotation;
drop policy if exists "tailors can remove owned annotations" on public.annotation;

create policy "tailors can read owned annotations"
on public.annotation for select to authenticated
using (revision_id in (
  select revision.id
  from public.revision revision
  join public.brief brief on brief.id = revision.brief_id
  join public.shop shop on shop.id = brief.shop_id
  where shop.owner_id = (select auth.uid())
));

create policy "tailors can add owned annotations"
on public.annotation for insert to authenticated
with check (
  author_role = 'tailor'
  and revision_id in (
    select revision.id
    from public.revision revision
    join public.brief brief on brief.id = revision.brief_id
    join public.shop shop on shop.id = brief.shop_id
    where shop.owner_id = (select auth.uid())
  )
);

create policy "tailors can remove owned annotations"
on public.annotation for delete to authenticated
using (
  author_role = 'tailor'
  and revision_id in (
    select revision.id
    from public.revision revision
    join public.brief brief on brief.id = revision.brief_id
    join public.shop shop on shop.id = brief.shop_id
    where shop.owner_id = (select auth.uid())
  )
);

update public.patternproof_release
set migration = 18, installed_at = clock_timestamp()
where singleton = true and migration = 17;

do $$
begin
  if not exists (
    select 1 from public.patternproof_release
    where singleton = true and migration = 18
  ) then
    raise exception 'Migration 018 did not advance the release sentinel';
  end if;
end;
$$;

commit;
