-- Separate consent assertions and make the approved Cut Card explicit/stable.

alter table public.consent
  add column if not exists body_processing_confirmed boolean not null default false,
  add column if not exists policy_version text not null default '2026-08-02';

alter table public.brief
  add column if not exists approved_revision_id uuid references public.revision(id);

create or replace function public.can_approve_revision(p_revision_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.revision r
    join public.brief b on b.id = r.brief_id
    join public.consent c on c.brief_id = b.id
      and c.rights_confirmed
      and c.body_processing_confirmed
    where r.id = p_revision_id
      and r.render_path is not null
      and r.locked_at is null
      and exists (select 1 from public.requirement q where q.revision_id = r.id)
      and not exists (
        select 1
        from public.requirement q
        left join public.feasibility f on f.requirement_id = q.id
        where q.revision_id = r.id
          and (
            f.id is null
            or f.status = 'not_feasible'
            or (f.status = 'with_adjustment' and nullif(trim(f.tailor_note), '') is null)
          )
      )
  );
$$;

create or replace function public.approve_revision(p_revision_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_brief uuid;
begin
  if not public.can_approve_revision(p_revision_id) then
    raise exception 'Revision does not satisfy the Cut Card integrity rule';
  end if;
  select brief_id into target_brief from public.revision where id = p_revision_id;
  insert into public.approval (revision_id, approved_by_role, locked)
  values (p_revision_id, 'customer', true);
  update public.revision set locked_at = now() where id = p_revision_id;
  update public.brief
    set status = 'approved', approved_revision_id = p_revision_id
    where id = target_brief;
end;
$$;

revoke all on function public.can_approve_revision(uuid) from public, anon, authenticated;
revoke all on function public.approve_revision(uuid) from public, anon, authenticated;
grant execute on function public.can_approve_revision(uuid) to service_role;
grant execute on function public.approve_revision(uuid) to service_role;

-- These lifecycle fields are changed only by trusted server transactions.
revoke update(status, approved_revision_id) on public.brief from anon, authenticated;
revoke update(locked_at) on public.revision from anon, authenticated;

create or replace function public.prevent_locked_consent_mutation()
returns trigger language plpgsql as $$
declare bid uuid := coalesce(new.brief_id, old.brief_id);
begin
  if exists (
    select 1 from public.revision where brief_id = bid and locked_at is not null
  ) then raise exception 'Consent attached to an approved Cut Card is immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists locked_consent_guard on public.consent;
create trigger locked_consent_guard before update or delete on public.consent
for each row execute function public.prevent_locked_consent_mutation();
