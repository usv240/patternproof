-- Let a bearer-link customer veto cutting and request a new revision without
-- receiving tailor or tenant privileges. Requests bind to the frozen snapshot.
begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;
  if current_migration is null then raise exception 'PatternProof release sentinel is missing'; end if;
  if current_migration not in (19, 20) then
    raise exception 'Migration 020 requires release 19 (or 20 for an exact rerun), found %', current_migration;
  end if;
end;
$$;

create table if not exists public.customer_change_request (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.brief(id) on delete restrict,
  revision_id uuid not null references public.revision(id) on delete restrict,
  source_version integer not null check (source_version >= 1),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check (char_length(reason) between 5 and 1000),
  state text not null default 'open' check (state in ('open', 'accepted')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check (
    (state = 'open' and resolved_at is null)
    or (state = 'accepted' and resolved_at is not null)
  )
);

create unique index if not exists customer_change_request_one_open_brief_idx
  on public.customer_change_request (brief_id) where state = 'open';
create index if not exists customer_change_request_brief_history_idx
  on public.customer_change_request (brief_id, created_at desc);

alter table public.customer_change_request enable row level security;
revoke all privileges on table public.customer_change_request
  from public, anon, authenticated, service_role;
grant select on table public.customer_change_request to authenticated, service_role;

drop policy if exists "owners can read customer change requests"
  on public.customer_change_request;
create policy "owners can read customer change requests"
on public.customer_change_request for select to authenticated
using (
  exists (
    select 1 from public.brief b
    join public.shop s on s.id = b.shop_id
    where b.id = customer_change_request.brief_id
      and s.owner_id = (select auth.uid())
  )
);

create or replace function public.request_shared_revision_change(
  p_share_token_hash text,
  p_shared_revision_id uuid,
  p_shared_snapshot_sha256 text,
  p_reason text
)
returns table (
  request_id uuid,
  brief_id uuid,
  revision_id uuid,
  source_version integer,
  snapshot_sha256 text,
  reason text,
  state text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_reason text := trim(coalesce(p_reason, ''));
  v_brief public.brief%rowtype;
  v_request public.customer_change_request%rowtype;
  v_source_version integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if coalesce(p_share_token_hash, '') !~ '^[0-9a-f]{64}$'
    or p_shared_revision_id is null
    or coalesce(p_shared_snapshot_sha256, '') !~ '^[0-9a-f]{64}$'
    or char_length(safe_reason) not between 5 and 1000 then
    raise exception 'Invalid change request' using errcode = '22023';
  end if;

  select b.* into v_brief
  from public.brief b
  where b.share_token_hash = p_share_token_hash
  for update;
  if not found
    or v_brief.status <> 'awaiting_customer'
    or v_brief.approved_revision_id is not null
    or v_brief.shared_revision_id is distinct from p_shared_revision_id
    or v_brief.shared_snapshot_sha256 is distinct from p_shared_snapshot_sha256
    or v_brief.token_expires_at <= clock_timestamp()
    or v_brief.share_token_revoked_at is not null then
    raise exception 'Customer review is stale or unavailable' using errcode = 'P0001';
  end if;

  select revision.version into v_source_version
  from public.revision revision
  where revision.id = p_shared_revision_id and revision.brief_id = v_brief.id;
  if v_source_version is null then
    raise exception 'Shared revision is unavailable' using errcode = 'P0001';
  end if;

  select request.* into v_request
  from public.customer_change_request request
  where request.brief_id = v_brief.id and request.state = 'open'
  for update;
  if found then
    if v_request.revision_id is distinct from p_shared_revision_id
      or v_request.snapshot_sha256 is distinct from p_shared_snapshot_sha256 then
      raise exception 'Existing request is bound to another snapshot' using errcode = 'P0001';
    end if;
    return query select v_request.id, v_request.brief_id, v_request.revision_id,
      v_request.source_version, v_request.snapshot_sha256, v_request.reason, v_request.state, v_request.created_at;
    return;
  end if;

  insert into public.customer_change_request (
    brief_id, revision_id, source_version, snapshot_sha256, reason
  ) values (
    v_brief.id, p_shared_revision_id, v_source_version, p_shared_snapshot_sha256, safe_reason
  ) returning * into v_request;

  return query select v_request.id, v_request.brief_id, v_request.revision_id,
    v_request.source_version, v_request.snapshot_sha256, v_request.reason, v_request.state, v_request.created_at;
end;
$$;

create or replace function public.prevent_approval_with_open_change_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.revision revision
    join public.customer_change_request request
      on request.brief_id = revision.brief_id and request.state = 'open'
    where revision.id = new.revision_id
  ) then
    raise exception 'Customer requested a new revision' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_customer_change_guard on public.approval;
create trigger approval_customer_change_guard
before insert on public.approval
for each row execute function public.prevent_approval_with_open_change_request();

create or replace function public.accept_customer_change_on_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'awaiting_customer' and new.status = 'awaiting_tailor' then
    update public.customer_change_request
    set state = 'accepted', resolved_at = clock_timestamp()
    where brief_id = new.id and state = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists brief_accept_customer_change on public.brief;
create trigger brief_accept_customer_change
after update of status on public.brief
for each row execute function public.accept_customer_change_on_revision();

revoke all on function public.request_shared_revision_change(text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_shared_revision_change(text, uuid, text, text)
  to service_role;
revoke all on function public.prevent_approval_with_open_change_request()
  from public, anon, authenticated, service_role;
revoke all on function public.accept_customer_change_on_revision()
  from public, anon, authenticated, service_role;

update public.patternproof_release
set migration = 20, installed_at = clock_timestamp()
where singleton = true and migration = 19;

do $$
begin
  if not exists (
    select 1 from public.patternproof_release where singleton = true and migration = 20
  ) then
    raise exception 'Migration 020 did not advance the release sentinel';
  end if;
end;
$$;

commit;
