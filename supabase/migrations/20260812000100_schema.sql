-- PatternProof: pilot-ready core schema.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare installed_schema text;
begin
  select n.nspname into installed_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if installed_schema is distinct from 'extensions' then
    alter extension pgcrypto set schema extensions;
  end if;
end;
$$;

grant usage on schema extensions to anon, authenticated, service_role;

create type public.brief_status as enum ('draft', 'awaiting_tailor', 'awaiting_customer', 'approved', 'archived');
create type public.feasibility_status as enum ('as_shown', 'with_adjustment', 'not_feasible');
create type public.approver_role as enum ('customer', 'tailor');

create table public.shop (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.brief (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  customer_label text not null check (char_length(customer_label) between 1 and 80),
  status public.brief_status not null default 'draft',
  share_token_hash text not null unique,
  token_expires_at timestamptz not null,
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.revision (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.brief(id) on delete cascade,
  version integer not null check (version > 0),
  reference_path text not null,
  body_path text not null,
  render_path text,
  render_hash text unique,
  garment_spec jsonb not null default '{}'::jsonb,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (brief_id, version)
);

create table public.requirement (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.revision(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create table public.feasibility (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null unique references public.requirement(id) on delete cascade,
  status public.feasibility_status not null,
  tailor_note text check (char_length(tailor_note) <= 1000),
  created_at timestamptz not null default now()
);

create table public.annotation (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.revision(id) on delete cascade,
  author_role public.approver_role not null,
  anchor_x numeric check (anchor_x between 0 and 1),
  anchor_y numeric check (anchor_y between 0 and 1),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.consent (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null unique references public.brief(id) on delete cascade,
  scope text not null,
  rights_confirmed boolean not null default false,
  ip_hash text,
  granted_at timestamptz not null default now()
);

create table public.approval (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null unique references public.revision(id) on delete cascade,
  approved_by_role public.approver_role not null,
  approved_at timestamptz not null default now(),
  locked boolean not null default true,
  check (approved_by_role = 'customer' and locked)
);

create table public.render_cache (
  render_hash text primary key,
  render_path text not null,
  created_at timestamptz not null default now()
);

create index brief_shop_idx on public.brief(shop_id);
create index revision_brief_idx on public.revision(brief_id, version desc);
create index requirement_revision_idx on public.requirement(revision_id);

-- A renderer/result can be present, but an approval is legal only after every requirement
-- has a human feasibility decision and the customer granted image and reference-use consent.
create or replace function public.can_approve_revision(p_revision_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.revision r
    join public.brief b on b.id = r.brief_id
    join public.consent c on c.brief_id = b.id and c.rights_confirmed
    where r.id = p_revision_id
      and r.render_path is not null
      and r.locked_at is null
      and exists (select 1 from public.requirement q where q.revision_id = r.id)
      and not exists (
        select 1 from public.requirement q
        left join public.feasibility f on f.requirement_id = q.id
        where q.revision_id = r.id and f.id is null
      )
  );
$$;

create or replace function public.approve_revision(p_revision_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_approve_revision(p_revision_id) then
    raise exception 'Revision does not satisfy the Cut Card integrity rule';
  end if;
  insert into public.approval (revision_id, approved_by_role, locked)
  values (p_revision_id, 'customer', true);
  update public.revision set locked_at = now() where id = p_revision_id;
  update public.brief set status = 'approved'
  where id = (select brief_id from public.revision where id = p_revision_id);
end;
$$;

create or replace function public.prevent_locked_revision_mutation()
returns trigger language plpgsql as $$
begin
  if old.locked_at is not null and new is distinct from old then
    raise exception 'Approved revisions are immutable; create a new revision instead';
  end if;
  return new;
end;
$$;

create trigger revisions_are_immutable_after_approval
before update or delete on public.revision
for each row execute function public.prevent_locked_revision_mutation();
