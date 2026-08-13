-- Freeze the exact customer-visible revision and approve it atomically.
-- Run after 005_render_idempotency.sql.

alter table public.brief
  add column shared_revision_id uuid references public.revision(id),
  add column shared_snapshot jsonb,
  add column shared_snapshot_sha256 text,
  add column review_started_at timestamptz,
  add column share_token_consumed_at timestamptz,
  add column share_token_revoked_at timestamptz;

create table public.review_session (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.brief(id),
  revision_id uuid not null unique references public.revision(id),
  state text not null check (state in ('active', 'withdrawn', 'approved')),
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null,
  ended_at timestamptz,
  reason text check (reason is null or char_length(reason) between 5 and 1000),
  check (
    (state = 'active' and ended_at is null)
    or (state in ('withdrawn', 'approved') and ended_at is not null)
  ),
  check (
    snapshot_sha256 = encode(extensions.digest(snapshot::text, 'sha256'), 'hex')
  )
);

create unique index review_session_one_active_brief_idx
  on public.review_session (brief_id)
  where state = 'active';

alter table public.approval
  add column snapshot jsonb,
  add column snapshot_sha256 text,
  add constraint approval_snapshot_pair_check check (
    (snapshot is null and snapshot_sha256 is null)
    or (
      snapshot is not null
      and snapshot_sha256 ~ '^[0-9a-f]{64}$'
      and snapshot_sha256 = encode(extensions.digest(snapshot::text, 'sha256'), 'hex')
    )
  );

-- Canonical review content. It intentionally excludes token material and IP data.
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
      'id', r.id,
      'version', r.version,
      'reference_path', r.reference_path,
      'render_path', r.render_path,
      'reference_sha256', r.garment_spec #>> '{normalized_images,reference,sha256}',
      'render_sha256', r.render_hash,
      'category', r.garment_spec ->> 'category',
      'created_at', r.created_at
    ),
    'requirements', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'label', q.label,
          'note', q.note,
          'created_at', q.created_at,
          'feasibility', case when f.id is null then null else jsonb_build_object(
            'id', f.id,
            'status', f.status,
            'tailor_note', f.tailor_note,
            'created_at', f.created_at
          ) end
        ) order by q.created_at, q.id
      )
      from public.requirement q
      left join public.feasibility f on f.requirement_id = q.id
      where q.revision_id = r.id
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'author_role', a.author_role,
          'anchor_x', a.anchor_x,
          'anchor_y', a.anchor_y,
          'body', a.body,
          'created_at', a.created_at
        ) order by a.created_at, a.id
      )
      from public.annotation a
      where a.revision_id = r.id
    ), '[]'::jsonb),
    'consent', (
      select jsonb_build_object(
        'scope', c.scope,
        'rights_confirmed', c.rights_confirmed,
        'body_processing_confirmed', c.body_processing_confirmed,
        'policy_version', c.policy_version,
        'granted_at', c.granted_at
      )
      from public.consent c
      where c.brief_id = b.id
    )
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

revoke all on function public.build_revision_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.build_revision_snapshot(uuid) to service_role;

-- Fail rather than silently selecting nothing for a legacy active review.
do $$
begin
  if exists (
    select 1 from public.brief b
    where b.status = 'awaiting_customer'
      and not exists (select 1 from public.revision r where r.brief_id = b.id)
  ) then
    raise exception 'Cannot migrate awaiting_customer brief without a revision';
  end if;
end;
$$;

update public.brief b
set
  shared_revision_id = coalesce(
    b.approved_revision_id,
    (select r.id from public.revision r where r.brief_id = b.id order by r.version desc limit 1)
  ),
  review_started_at = coalesce(b.review_started_at, now())
where b.status in ('awaiting_customer', 'approved')
  and (b.approved_revision_id is not null or exists (
    select 1 from public.revision r where r.brief_id = b.id
  ));

update public.brief b
set shared_snapshot = public.build_revision_snapshot(b.shared_revision_id)
where b.shared_revision_id is not null
  and b.status in ('awaiting_customer', 'approved');

update public.brief b
set shared_snapshot_sha256 = encode(extensions.digest(b.shared_snapshot::text, 'sha256'), 'hex')
where b.shared_snapshot is not null
  and b.status in ('awaiting_customer', 'approved');

insert into public.review_session (
  brief_id, revision_id, state, snapshot, snapshot_sha256, started_at, ended_at
)
select
  b.id,
  b.shared_revision_id,
  case when b.status = 'approved' then 'approved' else 'active' end,
  b.shared_snapshot,
  b.shared_snapshot_sha256,
  b.review_started_at,
  case when b.status = 'approved' then coalesce(r.locked_at, now()) else null end
from public.brief b
join public.revision r on r.id = b.shared_revision_id
where b.status in ('awaiting_customer', 'approved')
on conflict (revision_id) do nothing;

-- Existing approvals must receive the same immutable evidence contract as new
-- approvals; nullable legacy rows would make the integrity claim untrue.
with evidence as (
  select
    a.id,
    jsonb_build_object(
      'schema_version', 'patternproof-approval-v1',
      'review_snapshot_sha256', rs.snapshot_sha256,
      'review_snapshot', rs.snapshot,
      'approved_by_role', a.approved_by_role,
      'approved_at', a.approved_at
    ) as payload
  from public.approval a
  join public.review_session rs on rs.revision_id = a.revision_id
)
update public.approval a
set snapshot = e.payload,
    snapshot_sha256 = encode(extensions.digest(e.payload::text, 'sha256'), 'hex')
from evidence e
where a.id = e.id
  and (a.snapshot is null or a.snapshot_sha256 is null);

do $$
begin
  if exists (
    select 1 from public.approval
    where snapshot is null or snapshot_sha256 is null
  ) then
    raise exception 'Legacy approvals must be matched to immutable review evidence';
  end if;
end;
$$;

alter table public.approval
  alter column snapshot set not null,
  alter column snapshot_sha256 set not null;
alter table public.brief
  add constraint brief_active_review_shape_check check (
    status <> 'awaiting_customer'
    or (
      shared_revision_id is not null
      and shared_snapshot is not null
      and shared_snapshot_sha256 ~ '^[0-9a-f]{64}$'
      and review_started_at is not null
      and share_token_hash ~ '^[0-9a-f]{64}$'
      and approved_revision_id is null
      and share_token_consumed_at is null
      and share_token_revoked_at is null
    )
  ),
  add constraint brief_shared_snapshot_digest_check check (
    (shared_snapshot is null and shared_snapshot_sha256 is null)
    or (
      shared_snapshot is not null
      and shared_snapshot_sha256 ~ '^[0-9a-f]{64}$'
      and shared_snapshot_sha256 = encode(extensions.digest(shared_snapshot::text, 'sha256'), 'hex')
    )
  );

alter table public.review_session enable row level security;
create policy "owners can read review sessions"
on public.review_session for select to authenticated
using (
  brief_id in (
    select b.id from public.brief b
    join public.shop s on s.id = b.shop_id
    where s.owner_id = auth.uid()
  )
);

-- Every child mutation locks its parent brief first. This closes the race where
-- customer review begins while a requirement or feasibility write is in flight.
create or replace function public.assert_revision_editable(p_revision_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.brief b
  join public.revision r on r.brief_id = b.id
  where r.id = p_revision_id
    and not (b.status = 'awaiting_customer' and b.shared_revision_id = r.id)
  for update of b;
  if not found then
    raise exception 'Customer-visible revision is frozen' using errcode = '55000';
  end if;

  perform 1
  from public.revision r
  where r.id = p_revision_id
    and r.locked_at is null
    and not exists (
      select 1 from public.review_session rs where rs.revision_id = r.id
    )
  for update of r;
  if not found then
    raise exception 'Reviewed or approved revision is immutable' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_revision_editable(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_revision_editable(uuid)
  to authenticated, service_role;

create or replace function public.prevent_locked_requirement_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.revision_id is distinct from old.revision_id then
    raise exception 'A requirement cannot move between revisions';
  end if;
  if tg_op <> 'INSERT' then perform public.assert_revision_editable(old.revision_id); end if;
  if tg_op = 'INSERT' then perform public.assert_revision_editable(new.revision_id); end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_feasibility_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare old_rid uuid; new_rid uuid;
begin
  if tg_op = 'UPDATE' and new.requirement_id is distinct from old.requirement_id then
    raise exception 'A feasibility decision cannot move between requirements';
  end if;
  if tg_op <> 'INSERT' then
    select q.revision_id into old_rid from public.requirement q where q.id = old.requirement_id;
    perform public.assert_revision_editable(old_rid);
  end if;
  if tg_op = 'INSERT' then
    select q.revision_id into new_rid from public.requirement q where q.id = new.requirement_id;
    perform public.assert_revision_editable(new_rid);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_annotation_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.revision_id is distinct from old.revision_id then
    raise exception 'An annotation cannot move between revisions';
  end if;
  if tg_op <> 'INSERT' then perform public.assert_revision_editable(old.revision_id); end if;
  if tg_op = 'INSERT' then perform public.assert_revision_editable(new.revision_id); end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
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

-- Validate tenant ownership and canonical object-key shape before any admin
-- signer can consume paths stored on a revision.
create or replace function public.validate_revision_paths()
returns trigger language plpgsql set search_path = '' as $$
declare shop_id uuid; brief_state public.brief_status; prefix text;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.brief_id is distinct from old.brief_id
    or new.version is distinct from old.version
    or new.created_at is distinct from old.created_at
    or new.body_path is distinct from old.body_path
    or new.reference_path is distinct from old.reference_path
    or (old.render_path is not null and new.render_path is distinct from old.render_path)
    or (old.render_hash is not null and new.render_hash is distinct from old.render_hash)
  ) then
    raise exception 'Revision identity and established asset paths are immutable';
  end if;

  if tg_op = 'INSERT' then
    select b.shop_id, b.status into shop_id, brief_state
    from public.brief b where b.id = new.brief_id for update;
  else
    select b.shop_id, b.status into shop_id, brief_state
    from public.brief b where b.id = new.brief_id;
  end if;
  if shop_id is null then raise exception 'Revision brief was not found'; end if;
  if tg_op = 'INSERT' and brief_state in ('awaiting_customer', 'approved') then
    raise exception 'Withdraw review before creating a new revision';
  end if;
  prefix := shop_id::text || '/' || new.brief_id::text || '/' || new.id::text;

  if new.body_path <> prefix || '/body.jpg'
    or new.reference_path <> prefix || '/reference.jpg'
    or num_nonnulls(new.render_path, new.render_hash) = 1
    or (
      new.render_path is not null
      and (
        new.render_hash !~ '^[0-9a-f]{64}$'
        or new.render_path <> prefix || '/render-' || new.render_hash || '.jpg'
      )
    ) then
    raise exception 'Revision asset path failed tenant integrity checks';
  end if;
  return new;
end;
$$;

drop trigger if exists revision_path_integrity on public.revision;
create trigger revision_path_integrity
before insert or update on public.revision
for each row execute function public.validate_revision_paths();

do $$
begin
  if exists (
    select 1
    from public.revision r
    join public.brief b on b.id = r.brief_id
    where r.body_path <> b.shop_id::text || '/' || b.id::text || '/' || r.id::text || '/body.jpg'
      or r.reference_path <> b.shop_id::text || '/' || b.id::text || '/' || r.id::text || '/reference.jpg'
      or num_nonnulls(r.render_path, r.render_hash) = 1
      or (
        r.render_path is not null
        and (
          r.render_hash !~ '^[0-9a-f]{64}$'
          or r.render_path <> b.shop_id::text || '/' || b.id::text || '/' || r.id::text
            || '/render-' || r.render_hash || '.jpg'
        )
      )
  ) then
    raise exception 'Legacy revision asset paths must be repaired before migration 006';
  end if;
end;
$$;

create or replace function public.prevent_locked_revision_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare reviewed boolean;
begin
  if old.locked_at is not null then
    raise exception 'Approved revisions are immutable; create a new revision instead';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.review_session rs where rs.revision_id = old.id) then
      raise exception 'Reviewed revisions are immutable; create a new revision instead';
    end if;
    return old;
  end if;

  select exists (
    select 1 from public.review_session rs where rs.revision_id = old.id
  ) into reviewed;
  if reviewed then
    if (select auth.role()) = 'service_role'
      and old.locked_at is null
      and new.locked_at is not null
      and (to_jsonb(new) - 'locked_at') = (to_jsonb(old) - 'locked_at')
      and exists (
        select 1
        from public.review_session rs
        join public.brief b on b.id = rs.brief_id
        join public.approval a on a.revision_id = rs.revision_id
        where rs.revision_id = old.id
          and rs.state = 'active'
          and b.status = 'awaiting_customer'
          and b.shared_revision_id = old.id
          and a.locked
      ) then
      return new;
    end if;
    raise exception 'Customer-visible revisions are immutable';
  end if;
  return new;
end;
$$;

-- Review lifecycle fields can change only through exact service-role transitions.
create or replace function public.guard_brief_review_lifecycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('awaiting_customer', 'approved')
      or exists (select 1 from public.review_session rs where rs.brief_id = old.id) then
      raise exception 'Reviewed briefs require the explicit erasure workflow';
    end if;
    return old;
  end if;

  if old.status = 'awaiting_customer' then
    if (select auth.role()) = 'service_role'
      and new.status = 'awaiting_customer'
      and new.share_token_hash ~ '^[0-9a-f]{64}$'
      and new.token_expires_at > clock_timestamp()
      and new.share_token_consumed_at is null
      and new.share_token_revoked_at is null
      and (to_jsonb(new) - array[
        'share_token_hash','token_expires_at','share_token_consumed_at','share_token_revoked_at'
      ]) = (to_jsonb(old) - array[
        'share_token_hash','token_expires_at','share_token_consumed_at','share_token_revoked_at'
      ]) then return new;
    end if;
    if (select auth.role()) = 'service_role'
      and new.status = 'approved'
      and new.approved_revision_id = old.shared_revision_id
      and (to_jsonb(new) - array['status','approved_revision_id','share_token_consumed_at'])
        = (to_jsonb(old) - array['status','approved_revision_id','share_token_consumed_at'])
      and exists (
        select 1 from public.revision r
        join public.approval a on a.revision_id = r.id
        join public.review_session rs on rs.revision_id = r.id
        where r.id = old.shared_revision_id
          and r.locked_at is not null and a.locked and rs.state = 'approved'
      ) then return new;
    end if;

    if (select auth.role()) = 'service_role'
      and new.status = 'awaiting_tailor'
      and new.shared_revision_id is null
      and new.shared_snapshot is null
      and new.shared_snapshot_sha256 is null
      and new.review_started_at is null
      and (to_jsonb(new) - array[
        'status','shared_revision_id','shared_snapshot','shared_snapshot_sha256',
        'review_started_at','share_token_revoked_at'
      ]) = (to_jsonb(old) - array[
        'status','shared_revision_id','shared_snapshot','shared_snapshot_sha256',
        'review_started_at','share_token_revoked_at'
      ])
      and exists (
        select 1 from public.review_session rs
        where rs.revision_id = old.shared_revision_id and rs.state = 'withdrawn'
      ) then return new;
    end if;
    raise exception 'Brief is frozen during customer review';
  end if;

  if new.status = 'awaiting_customer' then
    if (select auth.role()) <> 'service_role'
      or old.status not in ('draft', 'awaiting_tailor')
      or new.share_token_hash !~ '^[0-9a-f]{64}$'
      or new.token_expires_at < clock_timestamp() + interval '1 hour'
      or new.shared_revision_id is null
      or new.shared_snapshot is null
      or new.review_started_at is null
      or not exists (
        select 1 from public.review_session rs
        where rs.brief_id = old.id
          and rs.revision_id = new.shared_revision_id
          and rs.state = 'active'
          and rs.snapshot_sha256 = new.shared_snapshot_sha256
      ) then raise exception 'Invalid customer-review transition'; end if;
    return new;
  end if;

  if old.status = 'approved' or new.status = 'approved'
    or new.shared_revision_id is distinct from old.shared_revision_id
    or new.shared_snapshot is distinct from old.shared_snapshot
    or new.shared_snapshot_sha256 is distinct from old.shared_snapshot_sha256
    or new.review_started_at is distinct from old.review_started_at
    or new.approved_revision_id is distinct from old.approved_revision_id then
    raise exception 'Review lifecycle fields are service-managed';
  end if;
  return new;
end;
$$;

drop trigger if exists brief_review_lifecycle_guard on public.brief;
create trigger brief_review_lifecycle_guard
before update or delete on public.brief
for each row execute function public.guard_brief_review_lifecycle();

create or replace function public.guard_review_session_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Review sessions are service-managed';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.ended_at is not null then
      raise exception 'New review session must be active';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'Review sessions are immutable'; end if;
  if old.state <> 'active'
    or new.state not in ('withdrawn', 'approved')
    or new.ended_at is null
    or (to_jsonb(new) - array['state','ended_at','reason'])
      <> (to_jsonb(old) - array['state','ended_at','reason']) then
    raise exception 'Invalid review-session transition';
  end if;
  return new;
end;
$$;

drop trigger if exists review_session_mutation_guard on public.review_session;
create trigger review_session_mutation_guard
before insert or update or delete on public.review_session
for each row execute function public.guard_review_session_mutation();

-- Storage browser mutations now lock/check the exact canonical path and reject
-- every revision that has ever entered customer review.
create or replace function public.can_mutate_brief_image(p_object_name text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare allowed boolean := false;
begin
  if (select auth.uid()) is null or cardinality(storage.foldername(p_object_name)) < 3 then
    return false;
  end if;

  select true into allowed
  from public.revision r
  join public.brief b on b.id = r.brief_id
  join public.shop s on s.id = b.shop_id
  where s.id::text = (storage.foldername(p_object_name))[1]
    and b.id::text = (storage.foldername(p_object_name))[2]
    and r.id::text = (storage.foldername(p_object_name))[3]
    and s.owner_id = (select auth.uid())
    and r.locked_at is null
    and not (b.status = 'awaiting_customer' and b.shared_revision_id = r.id)
    and not exists (select 1 from public.review_session rs where rs.revision_id = r.id)
    and p_object_name in (r.reference_path, r.body_path, r.render_path)
  for update of b, r;

  if not coalesce(allowed, false) then return false; end if;
  if exists (
    select 1 from public.revision protected_revision
    left join public.review_session rs on rs.revision_id = protected_revision.id
    where (protected_revision.locked_at is not null or rs.id is not null)
      and p_object_name in (
        protected_revision.reference_path,
        protected_revision.body_path,
        protected_revision.render_path
      )
  ) then return false; end if;
  return true;
end;
$$;

revoke all on function public.can_mutate_brief_image(text)
  from public, anon;
grant execute on function public.can_mutate_brief_image(text) to authenticated;

create or replace function public.block_reviewed_render_reservation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('reserved', 'running') and exists (
    select 1
    from public.revision r
    join public.brief b on b.id = r.brief_id
    left join public.review_session rs on rs.revision_id = r.id
    where r.id = new.revision_id
      and (rs.id is not null or (b.status = 'awaiting_customer' and b.shared_revision_id = r.id))
  ) then raise exception 'Customer-visible revisions cannot start render work'; end if;
  return new;
end;
$$;

drop trigger if exists reviewed_render_reservation_guard on public.render_job;
create trigger reviewed_render_reservation_guard
before insert or update on public.render_job
for each row execute function public.block_reviewed_render_reservation();

create or replace function public.require_approval_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role'
    or new.snapshot is null
    or new.snapshot_sha256 is null then
    raise exception 'Approval requires a service-generated immutable snapshot';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_snapshot_required on public.approval;
create trigger approval_snapshot_required
before insert on public.approval
for each row execute function public.require_approval_snapshot();

-- Begin review only after all approval prerequisites and render jobs are settled.
create or replace function public.begin_customer_review(
  p_brief_id uuid,
  p_revision_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.brief_status;
  current_shared uuid;
  review_time timestamptz := clock_timestamp();
  review_snapshot jsonb;
  review_digest text;
  session_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select b.status, b.shared_revision_id into current_status, current_shared
  from public.brief b
  join public.revision r on r.brief_id = b.id
  where b.id = p_brief_id and r.id = p_revision_id
  for update of b, r;
  if not found then raise exception 'Brief or revision not found'; end if;

  if current_status = 'awaiting_customer' and current_shared = p_revision_id then
    select rs.id into session_id from public.review_session rs
    where rs.brief_id = p_brief_id and rs.revision_id = p_revision_id and rs.state = 'active';
    return session_id;
  end if;
  if current_status not in ('draft', 'awaiting_tailor') then
    raise exception 'Brief cannot enter customer review from its current state';
  end if;
  if exists (
    select 1 from public.revision newer
    where newer.brief_id = p_brief_id
      and newer.version > (select version from public.revision where id = p_revision_id)
  ) then raise exception 'Only the latest revision can enter customer review'; end if;
  if not public.can_approve_revision(p_revision_id) then
    raise exception 'Revision does not satisfy review integrity rules';
  end if;
  if exists (
    select 1 from public.render_job j
    where j.revision_id = p_revision_id and j.status in ('reserved', 'running')
  ) then raise exception 'Render work must settle before customer review'; end if;
  if exists (
    select 1 from public.brief b
    where b.id = p_brief_id
      and (b.token_expires_at <= review_time
        or b.share_token_consumed_at is not null
        or b.share_token_revoked_at is not null)
  ) then raise exception 'A fresh share token is required'; end if;

  review_snapshot := public.build_revision_snapshot(p_revision_id);
  review_digest := encode(extensions.digest(review_snapshot::text, 'sha256'), 'hex');

  insert into public.review_session (
    brief_id, revision_id, state, snapshot, snapshot_sha256, started_at
  ) values (
    p_brief_id, p_revision_id, 'active', review_snapshot, review_digest, review_time
  ) returning id into session_id;

  update public.brief
  set status = 'awaiting_customer',
      shared_revision_id = p_revision_id,
      shared_snapshot = review_snapshot,
      shared_snapshot_sha256 = review_digest,
      review_started_at = review_time
  where id = p_brief_id;
  return session_id;
end;
$$;

-- Withdrawal revokes the old token and permanently preserves the viewed
-- revision. A later service workflow must create version+1 with new object keys.
create or replace function public.withdraw_customer_review(
  p_brief_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_revision_id uuid;
  safe_reason text := trim(coalesce(p_reason, ''));
  withdrawal_time timestamptz := clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if char_length(safe_reason) not between 5 and 1000 then
    raise exception 'Withdrawal reason must be 5 to 1000 characters';
  end if;

  select b.shared_revision_id into target_revision_id
  from public.brief b
  where b.id = p_brief_id and b.status = 'awaiting_customer'
  for update;
  if not found then raise exception 'Active customer review not found'; end if;

  update public.review_session rs
  set state = 'withdrawn', ended_at = withdrawal_time, reason = safe_reason
  where rs.brief_id = p_brief_id
    and rs.revision_id = target_revision_id
    and rs.state = 'active';
  if not found then raise exception 'Active review session not found'; end if;

  update public.brief
  set status = 'awaiting_tailor',
      shared_revision_id = null,
      shared_snapshot = null,
      shared_snapshot_sha256 = null,
      review_started_at = null,
      share_token_revoked_at = withdrawal_time
  where id = p_brief_id;
  return target_revision_id;
end;
$$;

-- Rotate only outside review; the raw token never enters the database.
create or replace function public.rotate_brief_share_token(
  p_brief_id uuid,
  p_share_token_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare normalized_hash text := lower(trim(coalesce(p_share_token_hash, '')));
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if normalized_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '30 days' then
    raise exception 'Invalid share-token rotation';
  end if;
  update public.brief
  set share_token_hash = normalized_hash,
      token_expires_at = p_expires_at,
      share_token_consumed_at = null,
      share_token_revoked_at = null
  where id = p_brief_id and status in ('draft', 'awaiting_tailor');
  if not found then raise exception 'Brief is not eligible for token rotation'; end if;
end;
$$;

-- Token verification, exact-snapshot approval, locking, and token consumption
-- occur under one brief row lock. No preflight query is an authorization grant.
create or replace function public.approve_shared_revision(
  p_share_token_hash text,
  p_shared_revision_id uuid,
  p_shared_snapshot_sha256 text
)
returns table (
  brief_id uuid,
  revision_id uuid,
  approval_id uuid,
  approval_snapshot_sha256 text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_brief public.brief%rowtype;
  session_id uuid;
  approval_time timestamptz := clock_timestamp();
  current_snapshot jsonb;
  current_digest text;
  approval_snapshot jsonb;
  approval_digest text;
  new_approval_id uuid;
  token_hash text := lower(trim(coalesce(p_share_token_hash, '')));
  snapshot_hash text := lower(trim(coalesce(p_shared_snapshot_sha256, '')));
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if token_hash !~ '^[0-9a-f]{64}$' or snapshot_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid approval proof' using errcode = '22023';
  end if;

  select b.* into target_brief
  from public.brief b
  where b.share_token_hash = token_hash
    and b.token_expires_at > approval_time
    and b.share_token_consumed_at is null
    and b.share_token_revoked_at is null
    and b.status = 'awaiting_customer'
    and b.shared_revision_id = p_shared_revision_id
    and b.shared_snapshot_sha256 = snapshot_hash
    and b.approved_revision_id is null
  for update;
  if not found then
    raise exception 'Share approval is invalid, stale, or already consumed'
      using errcode = '42501';
  end if;

  perform 1 from public.revision r
  where r.id = p_shared_revision_id and r.brief_id = target_brief.id and r.locked_at is null
  for update;
  if not found then raise exception 'Shared revision is unavailable'; end if;

  select rs.id into session_id
  from public.review_session rs
  where rs.brief_id = target_brief.id
    and rs.revision_id = p_shared_revision_id
    and rs.state = 'active'
    and rs.snapshot_sha256 = snapshot_hash
  for update;
  if not found then raise exception 'Active review session was not found'; end if;

  if not public.can_approve_revision(p_shared_revision_id) then
    raise exception 'Revision no longer satisfies approval integrity rules';
  end if;
  current_snapshot := public.build_revision_snapshot(p_shared_revision_id);
  current_digest := encode(extensions.digest(current_snapshot::text, 'sha256'), 'hex');
  if current_digest <> snapshot_hash or current_snapshot <> target_brief.shared_snapshot then
    raise exception 'Customer-visible snapshot changed before approval';
  end if;

  approval_snapshot := jsonb_build_object(
    'schema_version', 'patternproof-approval-v1',
    'review_snapshot_sha256', snapshot_hash,
    'review_snapshot', current_snapshot,
    'approved_by_role', 'customer',
    'approved_at', approval_time
  );
  approval_digest := encode(extensions.digest(approval_snapshot::text, 'sha256'), 'hex');

  insert into public.approval (
    revision_id, approved_by_role, approved_at, locked, snapshot, snapshot_sha256
  ) values (
    p_shared_revision_id, 'customer', approval_time, true, approval_snapshot, approval_digest
  ) returning id into new_approval_id;

  update public.revision set locked_at = approval_time where id = p_shared_revision_id;
  update public.review_session
  set state = 'approved', ended_at = approval_time
  where id = session_id;
  update public.brief
  set status = 'approved',
      approved_revision_id = p_shared_revision_id,
      share_token_consumed_at = approval_time
  where id = target_brief.id;

  return query select target_brief.id, p_shared_revision_id, new_approval_id, approval_digest;
end;
$$;

-- Disable the older non-atomic approval entry point.
revoke all on function public.approve_revision(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.begin_customer_review(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.withdraw_customer_review(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rotate_brief_share_token(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_shared_revision(text, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.withdraw_customer_review(uuid, text) to service_role;
grant execute on function public.approve_shared_revision(text, uuid, text) to service_role;

-- A harmless coordination column preserves SELECT ... FOR UPDATE capability for
-- authenticated SECURITY INVOKER RPCs without granting asset/spec mutations.
alter table public.revision
  add column coordination_version bigint not null default 0
    check (coordination_version >= 0);

-- Browser clients can create revisions, but cannot rewrite identity or paths.
-- Trusted intake/render services must use the service role for revision updates.
revoke update on public.revision from anon, authenticated;
revoke update on public.brief from anon, authenticated;
grant update (coordination_version) on public.revision to authenticated;
grant update (customer_label) on public.brief to authenticated;
revoke insert, update, delete on public.review_session from anon, authenticated;
revoke insert, update, delete on public.approval from anon, authenticated;


-- Public server entry point for review start: token rotation and snapshot freeze
-- commit together. Retrying the same active review may rotate only its token.
create or replace function public.start_customer_review(
  p_brief_id uuid,
  p_revision_id uuid,
  p_share_token_hash text,
  p_expires_at timestamptz
)
returns table (
  review_session_id uuid,
  shared_revision_id uuid,
  shared_snapshot_sha256 text,
  token_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.brief_status;
  current_shared uuid;
  operation_time timestamptz := clock_timestamp();
  normalized_hash text := lower(trim(coalesce(p_share_token_hash, '')));
  review_snapshot jsonb;
  review_digest text;
  result_session_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if normalized_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at < operation_time + interval '1 hour'
    or p_expires_at > operation_time + interval '30 days' then
    raise exception 'A valid share token with at least one hour remaining is required';
  end if;

  select b.status, b.shared_revision_id into current_status, current_shared
  from public.brief b
  join public.revision r on r.brief_id = b.id
  where b.id = p_brief_id and r.id = p_revision_id
  for update of b, r;
  if not found then raise exception 'Brief or revision not found'; end if;

  if current_status = 'awaiting_customer' then
    if current_shared is distinct from p_revision_id then
      raise exception 'A different revision is already in customer review';
    end if;
    select rs.id, rs.snapshot_sha256
      into result_session_id, review_digest
    from public.review_session rs
    where rs.brief_id = p_brief_id
      and rs.revision_id = p_revision_id
      and rs.state = 'active'
    for update;
    if not found then raise exception 'Active review session was not found'; end if;

    update public.brief
    set share_token_hash = normalized_hash,
        token_expires_at = p_expires_at,
        share_token_consumed_at = null,
        share_token_revoked_at = null
    where id = p_brief_id;

    return query select result_session_id, p_revision_id, review_digest, p_expires_at;
    return;
  end if;

  if current_status not in ('draft', 'awaiting_tailor') then
    raise exception 'Brief cannot enter customer review from its current state';
  end if;
  if exists (
    select 1 from public.revision newer
    where newer.brief_id = p_brief_id
      and newer.version > (select r.version from public.revision r where r.id = p_revision_id)
  ) then raise exception 'Only the latest revision can enter customer review'; end if;
  if not public.can_approve_revision(p_revision_id) then
    raise exception 'Revision does not satisfy review integrity rules';
  end if;
  update public.render_job j
  set status = case when j.status = 'running' then 'timeout' else 'error' end,
      reservation_expires_at = null
  where j.revision_id = p_revision_id
    and (
      (j.status = 'reserved'
        and (j.reservation_expires_at is null or j.reservation_expires_at <= operation_time))
      or (j.status = 'running'
        and j.updated_at <= operation_time - interval '10 minutes')
    );

  if exists (
    select 1 from public.render_job j
    where j.revision_id = p_revision_id
      and (
        (j.status = 'reserved' and j.reservation_expires_at > operation_time)
        or (j.status = 'running' and j.updated_at > operation_time - interval '10 minutes')
      )
  ) then raise exception 'Render work must settle before customer review'; end if;

  if (
    select count(*)
    from storage.objects o
    join public.revision r on r.id = p_revision_id
    where o.bucket_id = 'brief-images'
      and o.name in (r.body_path, r.reference_path, r.render_path)
  ) <> 3 then
    raise exception 'All three private review images must exist before sharing';
  end if;
  review_snapshot := public.build_revision_snapshot(p_revision_id);
  review_digest := encode(extensions.digest(review_snapshot::text, 'sha256'), 'hex');

  update public.brief
  set share_token_hash = normalized_hash,
      token_expires_at = p_expires_at,
      share_token_consumed_at = null,
      share_token_revoked_at = null
  where id = p_brief_id;

  insert into public.review_session (
    brief_id, revision_id, state, snapshot, snapshot_sha256, started_at
  ) values (
    p_brief_id, p_revision_id, 'active', review_snapshot, review_digest, operation_time
  ) returning id into result_session_id;

  update public.brief
  set status = 'awaiting_customer',
      shared_revision_id = p_revision_id,
      shared_snapshot = review_snapshot,
      shared_snapshot_sha256 = review_digest,
      review_started_at = operation_time
  where id = p_brief_id;

  return query select result_session_id, p_revision_id, review_digest, p_expires_at;
end;
$$;

revoke all on function public.start_customer_review(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.start_customer_review(uuid, uuid, text, timestamptz)
  to service_role;

-- Keep the split rotate/begin helpers unavailable through PostgREST; callers
-- use start_customer_review so no committed half-transition is possible.
revoke execute on function public.begin_customer_review(uuid, uuid) from service_role;
revoke execute on function public.rotate_brief_share_token(uuid, text, timestamptz)
  from service_role;