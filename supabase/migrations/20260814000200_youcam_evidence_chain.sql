-- Optional YouCam evidence chain: reference background rescue, predefined fabric
-- direction, and post-approval presentation motion. All features share the existing
-- global YouCam budget; the frozen Cut Card remains the construction authority.
begin;

do $$
declare current_migration integer;
begin
  select release.migration into current_migration
  from public.patternproof_release release
  where release.singleton = true
  for update;
  if current_migration not in (22, 23) then
    raise exception 'Migration 023 requires release 22 (or 23 for rerun), found %', current_migration;
  end if;
end;
$$;

alter table public.revision
  add column if not exists reference_rescued_path text,
  add column if not exists reference_rescued_hash text,
  add column if not exists fabric_render_path text,
  add column if not exists fabric_render_hash text,
  add column if not exists fabric_template_id text,
  add column if not exists fabric_template_title text;

do $$ begin
  alter table public.revision add constraint revision_reference_rescue_pair
    check ((reference_rescued_path is null) = (reference_rescued_hash is null));
exception when duplicate_object then null; end; $$;
do $$ begin
  alter table public.revision add constraint revision_fabric_evidence_group
    check (
      (fabric_render_path is null and fabric_render_hash is null and fabric_template_id is null and fabric_template_title is null)
      or
      (fabric_render_path is not null and fabric_render_hash is not null and fabric_template_id is not null and fabric_template_title is not null)
    );
exception when duplicate_object then null; end; $$;
do $$ begin
  alter table public.revision add constraint revision_evidence_hashes
    check (
      (reference_rescued_hash is null or reference_rescued_hash ~ '^[0-9a-f]{64}$')
      and (fabric_render_hash is null or fabric_render_hash ~ '^[0-9a-f]{64}$')
    );
exception when duplicate_object then null; end; $$;
do $$ begin
  alter table public.revision add constraint revision_fabric_template_lengths
    check (
      (fabric_template_id is null or char_length(fabric_template_id) between 1 and 512)
      and (fabric_template_title is null or char_length(fabric_template_title) between 1 and 160)
    );
exception when duplicate_object then null; end; $$;

create unique index if not exists revision_reference_rescued_path_unique
  on public.revision(reference_rescued_path) where reference_rescued_path is not null;
create unique index if not exists revision_fabric_render_path_unique
  on public.revision(fabric_render_path) where fabric_render_path is not null;

create table if not exists public.youcam_evidence_job (
  id uuid primary key default extensions.gen_random_uuid(),
  revision_id uuid not null references public.revision(id) on delete cascade,
  feature text not null check (feature in ('background_removal', 'fabric_vto', 'approved_motion')),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  template_id text check (template_id is null or char_length(template_id) between 1 and 512),
  template_title text check (template_title is null or char_length(template_title) between 1 and 160),
  task_id text,
  status text not null default 'reserved' check (status in ('reserved', 'running', 'success', 'error', 'timeout')),
  result_path text,
  result_hash text check (result_hash is null or result_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 1 check (attempt_count between 1 and 2),
  reservation_expires_at timestamptz not null default (clock_timestamp() + interval '90 seconds'),
  requested_by uuid not null references auth.users(id) on delete cascade,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (revision_id, feature, request_sha256),
  unique (feature, task_id),
  check ((result_path is null) = (result_hash is null)),
  check ((feature = 'fabric_vto') = (template_id is not null)),
  check (feature = 'fabric_vto' or template_title is null)
);

create index if not exists youcam_evidence_job_revision_idx
  on public.youcam_evidence_job(revision_id, created_at desc);

create table if not exists public.youcam_evidence_usage (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.youcam_evidence_job(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 2),
  requested_by uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('background_removal', 'fabric_vto', 'approved_motion')),
  units_consumed integer not null,
  consumed_at timestamptz not null default clock_timestamp(),
  unique (job_id, attempt_number),
  check (units_consumed = case feature
    when 'background_removal' then 1
    when 'fabric_vto' then 2
    when 'approved_motion' then 5
  end)
);

create index if not exists youcam_evidence_usage_owner_idx
  on public.youcam_evidence_usage(requested_by, consumed_at desc);

alter table public.youcam_evidence_job enable row level security;
alter table public.youcam_evidence_usage enable row level security;

drop policy if exists "owners read their YouCam evidence jobs" on public.youcam_evidence_job;
create policy "owners read their YouCam evidence jobs"
on public.youcam_evidence_job for select to authenticated
using (exists (
  select 1 from public.revision revision
  join public.brief brief on brief.id = revision.brief_id
  join public.shop shop on shop.id = brief.shop_id
  where revision.id = youcam_evidence_job.revision_id
    and shop.owner_id = (select auth.uid())
));

revoke all privileges on table public.youcam_evidence_job, public.youcam_evidence_usage
  from public, anon, authenticated, service_role;
grant select on table public.youcam_evidence_job to authenticated;
grant select on table public.youcam_evidence_job, public.youcam_evidence_usage to service_role;

drop function if exists public.reserve_youcam_evidence_job(uuid, text, text, text, text, uuid);
create function public.reserve_youcam_evidence_job(
  p_revision_id uuid,
  p_feature text,
  p_request_sha256 text,
  p_template_id text,
  p_template_title text,
  p_requested_by uuid
)
returns table(job_id uuid, attempt_number integer, job_status text, claimed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_record record;
  existing public.youcam_evidence_job%rowtype;
  next_attempt integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_feature not in ('background_removal', 'fabric_vto', 'approved_motion')
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_requested_by is null then
    raise exception 'Invalid evidence request' using errcode = '22023';
  end if;
  if (p_feature = 'fabric_vto') <> (p_template_id is not null and p_template_title is not null) then
    raise exception 'Fabric template metadata is required only for Fabric VTO' using errcode = '22023';
  end if;

  select revision.id, revision.locked_at, revision.render_path,
         revision.reference_rescued_path, revision.fabric_render_path,
         brief.status as brief_status
  into revision_record
  from public.revision revision
  join public.brief brief on brief.id = revision.brief_id
  join public.shop shop on shop.id = brief.shop_id
  where revision.id = p_revision_id and shop.owner_id = p_requested_by
  for update of revision;
  if not found then raise exception 'Owned revision not found' using errcode = '42501'; end if;

  if p_feature = 'background_removal' and (
    revision_record.locked_at is not null or revision_record.render_path is not null
    or revision_record.brief_status not in ('draft', 'awaiting_tailor')
    or exists (select 1 from public.feasibility feasibility join public.requirement requirement on requirement.id = feasibility.requirement_id where requirement.revision_id = p_revision_id)
    or exists (select 1 from public.annotation annotation where annotation.revision_id = p_revision_id)
  ) then raise exception 'Background rescue must happen before preview and human review' using errcode = '55000'; end if;

  if p_feature = 'fabric_vto' and (
    revision_record.locked_at is not null or revision_record.render_path is null
    or revision_record.brief_status not in ('draft', 'awaiting_tailor')
    or exists (select 1 from public.feasibility feasibility join public.requirement requirement on requirement.id = feasibility.requirement_id where requirement.revision_id = p_revision_id)
    or exists (select 1 from public.annotation annotation where annotation.revision_id = p_revision_id)
  ) then raise exception 'Fabric direction must happen after preview and before human review' using errcode = '55000'; end if;

  if p_feature = 'approved_motion' and (
    revision_record.locked_at is null or revision_record.brief_status <> 'approved'
    or not exists (select 1 from public.approval approval where approval.revision_id = p_revision_id and approval.locked)
  ) then raise exception 'Motion is available only after customer approval' using errcode = '55000'; end if;

  select evidence.* into existing
  from public.youcam_evidence_job evidence
  where evidence.revision_id = p_revision_id
    and evidence.feature = p_feature
    and evidence.request_sha256 = p_request_sha256
  for update;

  if found then
    if existing.status = 'success' then
      return query select existing.id, existing.attempt_count, existing.status, false;
      return;
    end if;
    if existing.status in ('reserved', 'running') and existing.reservation_expires_at > clock_timestamp() then
      return query select existing.id, existing.attempt_count, existing.status, false;
      return;
    end if;
    if existing.attempt_count >= 2 then
      raise exception 'Evidence retry ceiling reached' using errcode = 'P0001';
    end if;
    next_attempt := existing.attempt_count + 1;
    update public.youcam_evidence_job evidence set
      attempt_count = next_attempt, task_id = null, status = 'reserved',
      reservation_expires_at = clock_timestamp() + interval '90 seconds',
      last_error = null, updated_at = clock_timestamp()
    where evidence.id = existing.id;
    return query select existing.id, next_attempt, 'reserved'::text, true;
    return;
  end if;

  insert into public.youcam_evidence_job(
    revision_id, feature, request_sha256, template_id, template_title, requested_by
  ) values (
    p_revision_id, p_feature, p_request_sha256, p_template_id, p_template_title, p_requested_by
  ) returning id, attempt_count, status into job_id, attempt_number, job_status;
  claimed := true;
  return next;
end;
$$;

create or replace function public.consume_youcam_evidence_budget(
  p_job_id uuid,
  p_attempt_number integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.youcam_evidence_job%rowtype;
  unit_cost integer;
  inserted_id uuid;
  global_id text;
  recent_units integer;
  lifetime_units integer;
  guest_user boolean;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if exists (select 1 from public.youcam_evidence_usage usage where usage.job_id = p_job_id and usage.attempt_number = p_attempt_number) then return true; end if;

  select evidence.* into job from public.youcam_evidence_job evidence
  where evidence.id = p_job_id and evidence.status = 'reserved'
    and evidence.task_id is null and evidence.attempt_count = p_attempt_number
    and evidence.reservation_expires_at > clock_timestamp()
  for update;
  if not found then return exists (select 1 from public.youcam_evidence_usage usage where usage.job_id = p_job_id and usage.attempt_number = p_attempt_number); end if;

  unit_cost := case job.feature when 'background_removal' then 1 when 'fabric_vto' then 2 when 'approved_motion' then 5 end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(job.requested_by::text, 80804));

  select coalesce(sum(units), 0) into recent_units from (
    select usage.units_consumed as units from public.render_usage usage where usage.requested_by = job.requested_by and usage.consumed_at >= clock_timestamp() - interval '5 minutes'
    union all
    select usage.units_consumed from public.youcam_evidence_usage usage where usage.requested_by = job.requested_by and usage.consumed_at >= clock_timestamp() - interval '5 minutes'
  ) combined;
  if recent_units + unit_cost > 12 then raise exception 'durable owner evidence limit reached' using errcode = 'P0001'; end if;

  select coalesce(auth_user.is_anonymous, false) into guest_user from auth.users auth_user where auth_user.id = job.requested_by;
  if guest_user then
    select coalesce(sum(units), 0) into lifetime_units from (
      select usage.units_consumed as units from public.render_usage usage where usage.requested_by = job.requested_by
      union all
      select usage.units_consumed from public.youcam_evidence_usage usage where usage.requested_by = job.requested_by
    ) combined;
    if lifetime_units + unit_cost > 12 then raise exception 'guest YouCam evidence limit reached' using errcode = 'P0001'; end if;
  end if;

  perform 1 from public.render_budget budget where budget.id = 'youcam-cloth-v3' for update;
  if not found then raise exception 'global YouCam budget is unavailable' using errcode = '55000'; end if;

  insert into public.youcam_evidence_usage(job_id, attempt_number, requested_by, feature, units_consumed)
  values (job.id, p_attempt_number, job.requested_by, job.feature, unit_cost)
  on conflict (job_id, attempt_number) do nothing returning id into inserted_id;
  if inserted_id is null then return true; end if;

  update public.render_budget budget set consumed_units = budget.consumed_units + unit_cost, updated_at = clock_timestamp()
  where budget.id = 'youcam-cloth-v3' and budget.consumed_units + unit_cost <= budget.max_units
  returning budget.id into global_id;
  if global_id is null then raise exception 'global YouCam budget exhausted' using errcode = 'P0001'; end if;
  return true;
end;
$$;

create or replace function public.attach_youcam_evidence_task(
  p_job_id uuid, p_attempt_number integer, p_task_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_task_id is null or char_length(p_task_id) > 512 then raise exception 'Invalid task ID' using errcode = '22023'; end if;
  update public.youcam_evidence_job evidence set task_id = p_task_id, status = 'running', updated_at = clock_timestamp()
  where evidence.id = p_job_id and evidence.attempt_count = p_attempt_number
    and evidence.status = 'reserved' and evidence.task_id is null
    and exists (select 1 from public.youcam_evidence_usage usage where usage.job_id = p_job_id and usage.attempt_number = p_attempt_number);
  return found;
end; $$;

create or replace function public.abort_youcam_evidence_attempt(
  p_job_id uuid, p_attempt_number integer, p_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  update public.youcam_evidence_job evidence set status = 'error', last_error = left(coalesce(p_reason, 'Evidence request failed'), 500), updated_at = clock_timestamp()
  where evidence.id = p_job_id and evidence.attempt_count = p_attempt_number and evidence.status in ('reserved', 'running');
  return found;
end; $$;

create or replace function public.complete_youcam_evidence_job(
  p_job_id uuid, p_attempt_number integer, p_result_path text, p_result_hash text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.youcam_evidence_job%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_result_hash !~ '^[0-9a-f]{64}$' or p_result_path is null then raise exception 'Invalid evidence result' using errcode = '22023'; end if;
  select evidence.* into job from public.youcam_evidence_job evidence
  where evidence.id = p_job_id and evidence.attempt_count = p_attempt_number and evidence.status = 'running'
  for update;
  if not found then return exists (select 1 from public.youcam_evidence_job evidence where evidence.id = p_job_id and evidence.status = 'success' and evidence.result_path = p_result_path and evidence.result_hash = p_result_hash); end if;

  if job.feature = 'background_removal' then
    update public.revision revision set reference_rescued_path = p_result_path, reference_rescued_hash = p_result_hash
    where revision.id = job.revision_id and revision.locked_at is null and revision.render_path is null;
    if not found then raise exception 'Background rescue state changed before commit' using errcode = '55000'; end if;
  elsif job.feature = 'fabric_vto' then
    update public.revision revision set fabric_render_path = p_result_path, fabric_render_hash = p_result_hash,
      fabric_template_id = job.template_id, fabric_template_title = job.template_title
    where revision.id = job.revision_id and revision.locked_at is null and revision.render_path is not null;
    if not found then raise exception 'Fabric direction state changed before commit' using errcode = '55000'; end if;
  end if;

  update public.youcam_evidence_job evidence set status = 'success', result_path = p_result_path,
    result_hash = p_result_hash, reservation_expires_at = clock_timestamp(), updated_at = clock_timestamp()
  where evidence.id = job.id;
  return true;
end; $$;

create or replace function public.build_revision_snapshot(p_revision_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'schema_version', 'patternproof-review-v2',
    'shop', jsonb_build_object('id', s.id, 'name', s.name),
    'brief', jsonb_build_object('id', b.id, 'customer_label', b.customer_label),
    'revision', jsonb_build_object(
      'id', r.id, 'version', r.version,
      'reference_path', coalesce(r.reference_rescued_path, r.reference_path),
      'render_path', coalesce(r.fabric_render_path, r.render_path),
      'reference_sha256', coalesce(r.reference_rescued_hash, r.garment_spec #>> '{normalized_images,reference,sha256}'),
      'render_sha256', coalesce(r.fabric_render_hash, r.render_hash),
      'category', r.garment_spec ->> 'category', 'created_at', r.created_at,
      'evidence', jsonb_strip_nulls(jsonb_build_object(
        'background_rescued', case when r.reference_rescued_path is not null then true else null end,
        'fabric_template_id', r.fabric_template_id,
        'fabric_template_title', r.fabric_template_title
      ))
    ),
    'requirements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'label', q.label, 'note', q.note, 'created_at', q.created_at,
      'feasibility', case when f.id is null then null else jsonb_build_object('id', f.id, 'status', f.status, 'tailor_note', f.tailor_note, 'created_at', f.created_at) end
    ) order by q.created_at, q.id) from public.requirement q left join public.feasibility f on f.requirement_id = q.id where q.revision_id = r.id), '[]'::jsonb),
    'annotations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'requirement_id', a.requirement_id, 'author_role', a.author_role,
      'anchor_x', a.anchor_x, 'anchor_y', a.anchor_y, 'body', a.body, 'created_at', a.created_at
    ) order by a.created_at, a.id) from public.annotation a where a.revision_id = r.id), '[]'::jsonb),
    'consent', (select jsonb_build_object('scope', c.scope, 'rights_confirmed', c.rights_confirmed,
      'body_processing_confirmed', c.body_processing_confirmed, 'policy_version', c.policy_version, 'granted_at', c.granted_at)
      from public.consent c where c.brief_id = b.id order by c.granted_at desc, c.id desc limit 1)
  ) into result
  from public.revision r join public.brief b on b.id = r.brief_id join public.shop s on s.id = b.shop_id
  where r.id = p_revision_id;
  if result is null then raise exception 'Revision snapshot source was not found' using errcode = '22023'; end if;
  return result;
end; $$;

revoke all on function public.reserve_youcam_evidence_job(uuid, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.consume_youcam_evidence_budget(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.attach_youcam_evidence_task(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.abort_youcam_evidence_attempt(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_youcam_evidence_job(uuid, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_youcam_evidence_job(uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.consume_youcam_evidence_budget(uuid, integer) to service_role;
grant execute on function public.attach_youcam_evidence_task(uuid, integer, text) to service_role;
grant execute on function public.abort_youcam_evidence_attempt(uuid, integer, text) to service_role;
grant execute on function public.complete_youcam_evidence_job(uuid, integer, text, text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('brief-images', 'brief-images', false, 10485760, array['image/jpeg', 'image/png', 'video/mp4'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update public.patternproof_release set migration = 23, installed_at = clock_timestamp()
where singleton = true and migration = 22;
do $$ begin
  if not exists (select 1 from public.patternproof_release where singleton and migration = 23) then
    raise exception 'Migration 023 did not advance the release sentinel';
  end if;
end; $$;

commit;
