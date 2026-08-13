-- Lock approved image objects and make first-shop creation race-safe.
-- Run after 003_consent_and_approval.sql.

-- One owner maps to one shop. If legacy duplicates exist, resolve them before
-- applying this migration; failing closed is safer than silently moving briefs.
create unique index if not exists shop_one_per_owner_uidx
  on public.shop (owner_id);

-- Atomically return the caller's shop or create it. The no-op conflict update
-- makes concurrent first requests converge on the same row.
create or replace function public.get_or_create_owned_shop(p_name text)
returns public.shop
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  safe_name text;
  result public.shop;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  safe_name := left(
    regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'),
    120
  );
  if safe_name = '' then
    safe_name := 'My tailoring studio';
  end if;

  insert into public.shop (owner_id, name)
  values (caller_id, safe_name)
  on conflict (owner_id) do update
    set owner_id = excluded.owner_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.get_or_create_owned_shop(text)
  from public, anon;
grant execute on function public.get_or_create_owned_shop(text)
  to authenticated;

-- Resolve an object key to its {shop}/{brief}/{revision} owner. This helper is
-- SECURITY DEFINER so RLS checks cannot recurse; it still verifies auth.uid().
create or replace function public.can_mutate_brief_image(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and cardinality(storage.foldername(p_object_name)) >= 3
    and exists (
      select 1
      from public.revision r
      join public.brief b on b.id = r.brief_id
      join public.shop s on s.id = b.shop_id
      where s.id::text = (storage.foldername(p_object_name))[1]
        and b.id::text = (storage.foldername(p_object_name))[2]
        and r.id::text = (storage.foldername(p_object_name))[3]
        and s.owner_id = (select auth.uid())
        and r.locked_at is null
        and b.approved_revision_id is distinct from r.id
        and p_object_name in (r.reference_path, r.body_path, r.render_path)
    )
    and not exists (
      select 1
      from public.revision protected_revision
      join public.brief protected_brief
        on protected_brief.id = protected_revision.brief_id
      where (
          protected_revision.locked_at is not null
          or protected_brief.approved_revision_id = protected_revision.id
        )
        and p_object_name in (
          protected_revision.reference_path,
          protected_revision.body_path,
          protected_revision.render_path
        )
    );
$$;

revoke all on function public.can_mutate_brief_image(text)
  from public, anon;
grant execute on function public.can_mutate_brief_image(text)
  to authenticated;

-- Replace the original first-folder-only mutation policies. UPDATE remains
-- policy-free, so browser clients cannot overwrite an existing object in place.
drop policy if exists "shop owners can upload brief images" on storage.objects;
drop policy if exists "shop owners can delete brief images" on storage.objects;
drop policy if exists "shop owners can update brief images" on storage.objects;

create policy "owners can upload to unlocked revisions"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'brief-images'
  and public.can_mutate_brief_image(name)
);

create policy "owners can delete from unlocked revisions"
on storage.objects for delete to authenticated
using (
  bucket_id = 'brief-images'
  and public.can_mutate_brief_image(name)
);

-- Approved-data erasure is intentionally server-only: use the Supabase Storage
-- Admin API with the service-role key after explicit authorization/audit checks.
-- service_role bypasses RLS; no browser-facing policy grants this capability.
