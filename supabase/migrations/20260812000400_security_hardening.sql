-- P0 security hardening. Run after schema.sql, policies.sql, and storage.sql.

create table if not exists public.render_job (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  revision_id uuid not null references public.revision(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running','success','error','timeout')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists render_job_requester_idx
  on public.render_job(requested_by, created_at desc);

alter table public.render_job enable row level security;

create policy "owners can read their render jobs"
on public.render_job for select to authenticated
using (
  requested_by = auth.uid()
  and exists (
    select 1
    from public.revision r
    join public.brief b on b.id = r.brief_id
    join public.shop s on s.id = b.shop_id
    where r.id = render_job.revision_id and s.owner_id = auth.uid()
  )
);

create policy "owners can create their render jobs"
on public.render_job for insert to authenticated
with check (
  requested_by = auth.uid()
  and exists (
    select 1
    from public.revision r
    join public.brief b on b.id = r.brief_id
    join public.shop s on s.id = b.shop_id
    where r.id = render_job.revision_id and s.owner_id = auth.uid()
  )
);

create policy "owners can update their render jobs"
on public.render_job for update to authenticated
using (requested_by = auth.uid())
with check (requested_by = auth.uid());

-- SECURITY DEFINER approval functions are server-only. The server must first
-- verify the raw share token, its expiry, and the target revision.
revoke all on function public.can_approve_revision(uuid) from public, anon, authenticated;
revoke all on function public.approve_revision(uuid) from public, anon, authenticated;
grant execute on function public.can_approve_revision(uuid) to service_role;
grant execute on function public.approve_revision(uuid) to service_role;

-- Correct DELETE semantics and freeze the revision row after approval.
create or replace function public.prevent_locked_revision_mutation()
returns trigger language plpgsql as $$
begin
  if old.locked_at is not null then
    raise exception 'Approved revisions are immutable; create a new revision instead';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Freeze every production-meaningful child record once its revision is locked.
create or replace function public.prevent_locked_requirement_mutation()
returns trigger language plpgsql as $$
declare rid uuid := coalesce(new.revision_id, old.revision_id);
begin
  if exists (select 1 from public.revision where id = rid and locked_at is not null) then
    raise exception 'Requirements on an approved revision are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_feasibility_mutation()
returns trigger language plpgsql as $$
declare qid uuid := coalesce(new.requirement_id, old.requirement_id);
begin
  if exists (
    select 1 from public.requirement q
    join public.revision r on r.id = q.revision_id
    where q.id = qid and r.locked_at is not null
  ) then raise exception 'Feasibility decisions on an approved revision are immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_annotation_mutation()
returns trigger language plpgsql as $$
declare rid uuid := coalesce(new.revision_id, old.revision_id);
begin
  if exists (select 1 from public.revision where id = rid and locked_at is not null) then
    raise exception 'Annotations on an approved revision are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_approval_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Approval records are immutable';
end;
$$;

drop trigger if exists locked_requirement_guard on public.requirement;
create trigger locked_requirement_guard before insert or update or delete on public.requirement
for each row execute function public.prevent_locked_requirement_mutation();

drop trigger if exists locked_feasibility_guard on public.feasibility;
create trigger locked_feasibility_guard before insert or update or delete on public.feasibility
for each row execute function public.prevent_locked_feasibility_mutation();

drop trigger if exists locked_annotation_guard on public.annotation;
create trigger locked_annotation_guard before insert or update or delete on public.annotation
for each row execute function public.prevent_locked_annotation_mutation();

drop trigger if exists locked_approval_guard on public.approval;
create trigger locked_approval_guard before update or delete on public.approval
for each row execute function public.prevent_locked_approval_mutation();

-- Fill missing owner policies from the original policy set.
create policy "annotation owner access" on public.annotation for all to authenticated
using (revision_id in (
  select r.id from public.revision r join public.brief b on b.id=r.brief_id
  join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid()
)) with check (revision_id in (
  select r.id from public.revision r join public.brief b on b.id=r.brief_id
  join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid()
));

create policy "consent owner access" on public.consent for all to authenticated
using (brief_id in (
  select b.id from public.brief b join public.shop s on s.id=b.shop_id
  where s.owner_id=auth.uid()
)) with check (brief_id in (
  select b.id from public.brief b join public.shop s on s.id=b.shop_id
  where s.owner_id=auth.uid()
));

create policy "approval owner read" on public.approval for select to authenticated
using (revision_id in (
  select r.id from public.revision r join public.brief b on b.id=r.brief_id
  join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid()
));
