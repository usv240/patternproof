-- Repair fresh-install API privileges without reopening browser-managed data paths.
-- Safe to rerun after release 16: the ACL and policy statements are declarative,
-- while the readiness timestamp advances only once from release 15.
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
  if current_migration not in (15, 16) then
    raise exception 'Migration 016 requires release 15 (or 16 for an exact rerun), found %',
      current_migration;
  end if;
end;
$$;

-- Supabase's postgres defaults can grant Dxtm (TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN) without granting API reads. Reset every PatternProof table first so
-- no role inherits a destructive/non-API privilege and every allow is explicit.
revoke all privileges on table
  public.shop,
  public.brief,
  public.revision,
  public.requirement,
  public.feasibility,
  public.annotation,
  public.consent,
  public.approval,
  public.render_cache,
  public.render_job,
  public.render_usage,
  public.review_session,
  public.intake_issuance,
  public.render_budget,
  public.body_photo_erasure,
  public.patternproof_release,
  public.review_revision_clone
from public, anon, authenticated, service_role;

-- UUIDs are used today, but remove inherited sequence mutation rights as a
-- future-safe default. Future postgres-owned public tables/sequences must opt in
-- explicitly; reserved Supabase platform-owner defaults are left untouched.
revoke all privileges on all sequences in schema public
  from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;

-- PostgREST exposes executable public functions as RPCs. Authentication uses
-- the Auth schema, so the application needs only shop bootstrap plus the
-- editability helper invoked from requirement/feasibility triggers.
revoke all privileges on all functions in schema public
  from public, anon, authenticated, service_role;
grant execute on function public.get_or_create_owned_shop(text)
  to authenticated;
grant execute on function public.assert_revision_editable(uuid)
  to authenticated;

grant execute on function public.abort_reserved_render_attempt(uuid, integer) to service_role;
grant execute on function public.abort_review_revision_clone(uuid, text) to service_role;
grant execute on function public.activate_intake_issuance(uuid) to service_role;
grant execute on function public.approve_shared_revision(text, uuid, text) to service_role;
grant execute on function public.attach_reserved_render_task(uuid, integer, text) to service_role;
grant execute on function public.build_revision_snapshot(uuid) to service_role;
grant execute on function public.can_approve_revision(uuid) to service_role;
grant execute on function public.claim_body_photo_erasure(uuid) to service_role;
grant execute on function public.claim_body_photo_erasure_cleanup(integer) to service_role;
grant execute on function public.claim_intake_cleanup(integer) to service_role;
grant execute on function public.claim_intake_finalization(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_review_revision_clone_cleanup(integer) to service_role;
grant execute on function public.commit_intake_finalization(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.commit_review_revision_clone(uuid, text, text) to service_role;
grant execute on function public.complete_body_photo_erasure(uuid, uuid, boolean, text) to service_role;
grant execute on function public.complete_intake_cleanup(uuid, uuid, boolean, text) to service_role;
grant execute on function public.complete_review_revision_clone_cleanup(uuid, uuid, boolean, text) to service_role;
grant execute on function public.consume_render_budget(uuid, integer) to service_role;
grant execute on function public.create_intake_reservation(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.discard_incomplete_intake_draft(uuid, uuid) to service_role;
grant execute on function public.reconcile_claimed_intake_cleanup(uuid, uuid) to service_role;
grant execute on function public.release_intake_finalization(uuid, uuid, text, boolean) to service_role;
grant execute on function public.reserve_render_job(uuid, text, text, text, uuid) to service_role;
grant execute on function public.reserve_review_revision_clone(uuid, uuid, text) to service_role;
grant execute on function public.start_customer_review(uuid, uuid, text, timestamptz) to service_role;


-- Authenticated server-rendered and route-handler reads. RLS remains the tenant
-- boundary. review_session is also read by assert_revision_editable().
grant select on table
  public.shop,
  public.brief,
  public.revision,
  public.requirement,
  public.feasibility,
  public.consent,
  public.render_job,
  public.review_session,
  public.body_photo_erasure
to authenticated;

-- The only authenticated relational writes exercised by the application.
-- Intake, consent, lifecycle, render provenance, approval, and cleanup remain
-- fenced behind service-only functions.
grant insert (revision_id, label, note)
  on table public.requirement to authenticated;
grant insert (requirement_id, status, tailor_note)
  on table public.feasibility to authenticated;
grant update (status, tailor_note)
  on table public.feasibility to authenticated;
grant update (customer_label)
  on table public.brief to authenticated;
grant update (coordination_version)
  on table public.revision to authenticated;

-- Direct admin-client reads plus the dependencies of the service-only,
-- SECURITY INVOKER snapshot/review/approval functions.
grant select on table
  public.shop,
  public.brief,
  public.revision,
  public.requirement,
  public.feasibility,
  public.annotation,
  public.consent,
  public.approval,
  public.review_session,
  public.render_job,
  public.intake_issuance,
  public.patternproof_release
to service_role;

grant update (
  status,
  share_token_hash,
  token_expires_at,
  approved_revision_id,
  shared_revision_id,
  shared_snapshot,
  shared_snapshot_sha256,
  review_started_at,
  share_token_consumed_at,
  share_token_revoked_at
) on table public.brief to service_role;
grant update (render_path, render_hash, locked_at)
  on table public.revision to service_role;
grant update (state, ended_at)
  on table public.review_session to service_role;
grant update (status, reservation_expires_at)
  on table public.render_job to service_role;
grant update (
  raw_cleanup_state,
  cleanup_attempted_at,
  last_error,
  raw_removed_at
) on table public.intake_issuance to service_role;

grant insert (
  brief_id,
  revision_id,
  state,
  snapshot,
  snapshot_sha256,
  started_at
) on table public.review_session to service_role;
grant insert (
  revision_id,
  approved_by_role,
  approved_at,
  locked,
  snapshot,
  snapshot_sha256
) on table public.approval to service_role;

-- Storage schema ACLs are platform-owned and Storage is not exposed through the
-- public PostgREST schema. Browser access is controlled by a private bucket and
-- these RLS policies. Qualify the outer object name: the bootstrap policy's `name`
-- binds to public.shop.name inside the EXISTS subquery and hides every normal
-- UUID-keyed object from its owner.
drop policy if exists "shop owners can upload brief images" on storage.objects;
drop policy if exists "shop owners can update brief images" on storage.objects;
drop policy if exists "shop owners can delete brief images" on storage.objects;
drop policy if exists "owners can upload to unlocked revisions" on storage.objects;
drop policy if exists "owners can update unlocked revisions" on storage.objects;
drop policy if exists "owners can delete from unlocked revisions" on storage.objects;
drop policy if exists "shop owners can read brief images" on storage.objects;
create policy "shop owners can read brief images"
on storage.objects for select to authenticated
using (
  bucket_id = 'brief-images'
  and exists (
    select 1
    from public.shop owner_shop
    where owner_shop.id::text = (storage.foldername(storage.objects.name))[1]
      and owner_shop.owner_id = (select auth.uid())
  )
);

do $$
begin
  if not coalesce((
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'storage.objects'::regclass
  ), false) then
    raise exception 'storage.objects RLS must remain enabled';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.roles && array['public', 'anon', 'authenticated']::name[]
      and (
        policy.cmd <> 'SELECT'
        or policy.policyname <> 'shop owners can read brief images'
      )
  ) then
    raise exception 'Browser Storage policies must contain only the authenticated brief-image read policy';
  end if;
end;
$$;

update public.patternproof_release
set migration = 16,
    installed_at = clock_timestamp()
where singleton = true
  and migration = 15;

do $$
begin
  if not exists (
    select 1 from public.patternproof_release
    where singleton = true and migration = 16
  ) then
    raise exception 'Migration 016 did not advance the release sentinel';
  end if;
end;
$$;

commit;
