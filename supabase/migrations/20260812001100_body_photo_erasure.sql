-- Audited, retryable erasure of the sensitive customer body photo after approval.
-- The immutable review/approval snapshot and its digest remain intact; only the
-- exact canonical body object may be removed. Run after 008_render_budget.sql.

create table public.body_photo_erasure (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  shop_id uuid not null references public.shop(id),
  brief_id uuid not null references public.brief(id),
  revision_id uuid not null unique references public.revision(id),
  body_path text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'cleanup_required', 'completed')),
  requested_at timestamptz not null default now(),
  claim_id uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  updated_at timestamptz not null default now(),
  constraint body_photo_erasure_path_check check (
    body_path = shop_id::text || '/' || brief_id::text || '/' || revision_id::text || '/body.jpg'
  ),
  constraint body_photo_erasure_claim_check check (
    (status = 'processing' and claim_id is not null and claimed_at is not null)
    or (status <> 'processing' and claim_id is null and claimed_at is null)
  ),
  constraint body_photo_erasure_completion_check check (
    (status = 'completed') = (completed_at is not null)
  )
);

alter table public.body_photo_erasure enable row level security;

create policy "owners can read body photo erasure records"
on public.body_photo_erasure for select to authenticated
using (owner_id = (select auth.uid()));

revoke all on table public.body_photo_erasure
  from public, anon, authenticated, service_role;
grant select on table public.body_photo_erasure to authenticated;

create or replace function public.guard_body_photo_erasure_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Body-photo erasure is service-managed' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.shop_id is distinct from old.shop_id
    or new.brief_id is distinct from old.brief_id
    or new.revision_id is distinct from old.revision_id
    or new.body_path is distinct from old.body_path
    or new.requested_at is distinct from old.requested_at then
    raise exception 'Body-photo erasure identity is immutable' using errcode = '22023';
  end if;
  if new.status is distinct from old.status and not (
    (old.status in ('pending', 'cleanup_required') and new.status = 'processing')
    or (old.status = 'processing' and new.status in ('completed', 'cleanup_required'))
  ) then
    raise exception 'Invalid body-photo erasure transition' using errcode = '22023';
  end if;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'Body-photo erasure completion is immutable' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists body_photo_erasure_update_guard on public.body_photo_erasure;
create trigger body_photo_erasure_update_guard
before update on public.body_photo_erasure
for each row execute function public.guard_body_photo_erasure_update();

create or replace function public.guard_body_photo_erasure_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Body-photo erasure records are immutable';
end;
$$;

drop trigger if exists body_photo_erasure_delete_guard on public.body_photo_erasure;
create trigger body_photo_erasure_delete_guard
before delete on public.body_photo_erasure
for each row execute function public.guard_body_photo_erasure_delete();

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
  ) on conflict (revision_id) do nothing;

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

create or replace function public.complete_body_photo_erasure(
  p_erasure_id uuid,
  p_claim_id uuid,
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
  update public.body_photo_erasure
  set status = case when p_succeeded then 'completed' else 'cleanup_required' end,
      claim_id = null,
      claimed_at = null,
      completed_at = case when p_succeeded then completion_time else null end,
      last_error = case
        when p_succeeded then null
        else left(coalesce(nullif(trim(p_error), ''), 'Body-photo cleanup requires retry.'), 1000)
      end
  where id = p_erasure_id
    and claim_id = p_claim_id
    and status = 'processing'
  returning true into completed;
  return coalesce(completed, false);
end;
$$;

create or replace function public.claim_body_photo_erasure_cleanup(
  p_limit integer default 25
)
returns table (
  erasure_id uuid,
  shop_id uuid,
  brief_id uuid,
  revision_id uuid,
  body_path text,
  claim_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare claim_time timestamptz := clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select e.id
    from public.body_photo_erasure e
    where e.status = 'cleanup_required'
      or (e.status = 'processing' and e.claimed_at <= claim_time - interval '15 minutes')
    order by e.updated_at, e.requested_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 100)
  ), claimed as (
    update public.body_photo_erasure e
    set status = 'processing',
        claim_id = pg_catalog.gen_random_uuid(),
        claimed_at = claim_time,
        last_error = null
    from candidates c
    where e.id = c.id
    returning e.*
  )
  select c.id, c.shop_id, c.brief_id, c.revision_id, c.body_path, c.claim_id
  from claimed c;
end;
$$;

revoke all on function public.guard_body_photo_erasure_update()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_body_photo_erasure_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_body_photo_erasure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_body_photo_erasure(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_body_photo_erasure(uuid) to service_role;
grant execute on function public.complete_body_photo_erasure(uuid, uuid, boolean, text)
  to service_role;

revoke all on function public.claim_body_photo_erasure_cleanup(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_body_photo_erasure_cleanup(integer)
  to service_role;
