\set ON_ERROR_STOP on

-- PatternProof database release smoke test.
--
-- Run as the local database owner after applying every migration. The test is
-- repeatable: all fixtures, budget mutations, and RPC calls are rolled back.
-- It intentionally uses fixed synthetic UUIDs so role-switched assertions do
-- not need access to privileged temporary tables.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $release_contract$
declare
  release_migration integer;
  bucket_public boolean;
  bucket_limit bigint;
  bucket_mime_types text[];
  units_not_null boolean;
  units_default text;
begin
  select release.migration
  into release_migration
  from public.patternproof_release release
  where release.singleton = true;

  if release_migration is distinct from 20 then
    raise exception 'release sentinel mismatch: expected 20, found %',
      coalesce(release_migration::text, 'missing')
      using errcode = '55000';
  end if;

  select bucket.public, bucket.file_size_limit, bucket.allowed_mime_types
  into bucket_public, bucket_limit, bucket_mime_types
  from storage.buckets bucket
  where bucket.id = 'brief-images';

  if not found then
    raise exception 'private brief-images bucket is missing' using errcode = '55000';
  end if;
  if bucket_public is distinct from false then
    raise exception 'brief-images bucket must be private' using errcode = '55000';
  end if;
  if bucket_limit is distinct from 10485760 then
    raise exception 'brief-images bucket limit must be exactly 10 MiB, found %',
      coalesce(bucket_limit::text, 'null')
      using errcode = '55000';
  end if;
  if cardinality(bucket_mime_types) is distinct from 2
    or not bucket_mime_types @> array['image/jpeg', 'image/png']::text[]
    or not bucket_mime_types <@ array['image/jpeg', 'image/png']::text[] then
    raise exception 'brief-images MIME allowlist must be exactly JPEG and PNG, found %',
      coalesce(bucket_mime_types::text, 'null')
      using errcode = '55000';
  end if;

  select attribute.attnotnull, pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
  into units_not_null, units_default
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.render_usage'::regclass
    and attribute.attname = 'units_consumed'
    and not attribute.attisdropped;

  if not found then
    raise exception 'render_usage.units_consumed is missing' using errcode = '55000';
  end if;
  if units_not_null is distinct from true then
    raise exception 'render_usage.units_consumed must be NOT NULL' using errcode = '55000';
  end if;
  if units_default is distinct from '2' then
    raise exception 'render_usage.units_consumed default must be exactly 2, found %',
      coalesce(units_default, 'null')
      using errcode = '55000';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.render_usage'::regclass
      and constraint_row.conname = 'render_usage_units_consumed_exact_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) =
        'CHECK ((units_consumed = 2))'
  ) then
    raise exception 'validated exact-two render usage constraint is missing'
      using errcode = '55000';
  end if;

  if has_function_privilege(
      'anon',
      'public.consume_render_budget(uuid,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.consume_render_budget(uuid,integer)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.consume_render_budget(uuid,integer)',
      'EXECUTE'
    ) then
    raise exception 'consume_render_budget must be executable only by service_role'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid =
      'public.consume_render_budget(uuid,integer)'::regprocedure
      and procedure_row.prosecdef
  ) then
    raise exception 'consume_render_budget must remain SECURITY DEFINER'
      using errcode = '55000';
  end if;

  raise notice 'PASS release sentinel, private bucket, units column, and budget RPC grants';
end;
$release_contract$;

do $public_acl_contract$
declare
  app_tables constant text[] := array[
    'annotation',
    'approval',
    'body_photo_erasure',
    'brief',
    'consent',
    'customer_change_request',
    'feasibility',
    'intake_issuance',
    'patternproof_release',
    'render_budget',
    'render_cache',
    'render_job',
    'render_usage',
    'requirement',
    'review_revision_clone',
    'review_session',
    'revision',
    'shop'
  ];
  authenticated_select_tables constant text[] := array[
    'shop',
    'brief',
    'revision',
    'requirement',
    'feasibility',
    'annotation',
    'consent',
    'customer_change_request',
    'render_job',
    'review_session',
    'body_photo_erasure'
  ];
  service_select_tables constant text[] := array[
    'shop',
    'brief',
    'revision',
    'requirement',
    'feasibility',
    'annotation',
    'consent',
    'customer_change_request',
    'approval',
    'review_session',
    'render_job',
    'intake_issuance',
    'patternproof_release'
  ];
  service_execute_routines constant oid[] := array[
    'public.abort_reserved_render_attempt(uuid,integer)'::regprocedure,
    'public.abort_review_revision_clone(uuid,text)'::regprocedure,
    'public.activate_intake_issuance(uuid)'::regprocedure,
    'public.approve_shared_revision(text,uuid,text)'::regprocedure,
    'public.attach_reserved_render_task(uuid,integer,text)'::regprocedure,
    'public.build_revision_snapshot(uuid)'::regprocedure,
    'public.can_approve_revision(uuid)'::regprocedure,
    'public.claim_body_photo_erasure(uuid)'::regprocedure,
    'public.claim_body_photo_erasure_cleanup(integer)'::regprocedure,
    'public.claim_intake_cleanup(integer)'::regprocedure,
    'public.claim_intake_finalization(uuid,uuid,uuid)'::regprocedure,
    'public.claim_review_revision_clone_cleanup(integer)'::regprocedure,
    'public.commit_intake_finalization(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.commit_review_revision_clone(uuid,text,text)'::regprocedure,
    'public.complete_body_photo_erasure(uuid,uuid,boolean,text)'::regprocedure,
    'public.complete_intake_cleanup(uuid,uuid,boolean,text)'::regprocedure,
    'public.complete_review_revision_clone_cleanup(uuid,uuid,boolean,text)'::regprocedure,
    'public.consume_render_budget(uuid,integer)'::regprocedure,
    'public.create_intake_reservation(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz)'::regprocedure,
    'public.discard_incomplete_intake_draft(uuid,uuid)'::regprocedure,
    'public.reconcile_claimed_intake_cleanup(uuid,uuid)'::regprocedure,
    'public.release_intake_finalization(uuid,uuid,text,boolean)'::regprocedure,
    'public.reserve_render_job(uuid,text,text,text,uuid)'::regprocedure,
    'public.reserve_review_revision_clone(uuid,uuid,text)'::regprocedure,
    'public.request_shared_revision_change(text,uuid,text,text)'::regprocedure,
    'public.start_customer_review(uuid,uuid,text,timestamptz)'::regprocedure
  ];
  database_role text;
  table_name text;
  column_name text;
  privilege_name text;
  expected boolean;
  actual boolean;
  actual_tables text[];
  storage_read_roles name[];
  storage_read_command text;
  storage_read_qual text;
  procedure_row record;
begin
  select array_agg(tables.tablename order by tables.tablename)
  into actual_tables
  from pg_catalog.pg_tables tables
  where tables.schemaname = 'public';

  if actual_tables is distinct from app_tables then
    raise exception 'public application table allowlist drift: found %', actual_tables
      using errcode = '55000';
  end if;

  foreach table_name in array app_tables loop
    if (
      select relation.relowner
      from pg_catalog.pg_class relation
      where relation.oid = pg_catalog.to_regclass(
        pg_catalog.format('public.%I', table_name)
      )
    ) is distinct from 'postgres'::regrole then
      raise exception 'public.% must be owned by postgres migration owner', table_name
        using errcode = '55000';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', table_name)
        )
        and relation.relrowsecurity
    ) then
      raise exception 'RLS must be enabled on public.%', table_name
        using errcode = '55000';
    end if;

    foreach database_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN'
      ] loop
        expected := (
          privilege_name = 'SELECT' and (
            (
              database_role = 'authenticated'
              and table_name = any(authenticated_select_tables)
            )
            or (
              database_role = 'service_role'
              and table_name = any(service_select_tables)
            )
          )
        ) or (
          database_role = 'authenticated'
          and table_name = 'annotation'
          and privilege_name = 'DELETE'
        );
        actual := pg_catalog.has_table_privilege(
          database_role,
          pg_catalog.format('public.%I', table_name),
          privilege_name
        );

        if actual is distinct from expected then
          raise exception 'unexpected %.% table privilege for %: expected %, found %',
            table_name,
            privilege_name,
            database_role,
            expected,
            actual
            using errcode = '42501';
        end if;
      end loop;

      for column_name in
        select attribute.attname
        from pg_catalog.pg_attribute attribute
        where attribute.attrelid = pg_catalog.to_regclass(
            pg_catalog.format('public.%I', table_name)
          )
          and attribute.attnum > 0
          and not attribute.attisdropped
        order by attribute.attnum
      loop
        foreach privilege_name in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
          expected := false;

          if database_role = 'authenticated' then
            expected :=
              (
                privilege_name = 'INSERT'
                and (
                  (
                    table_name = 'requirement'
                    and column_name = any(array['revision_id', 'label', 'note'])
                  )
                  or (
                    table_name = 'feasibility'
                    and column_name = any(array['requirement_id', 'status', 'tailor_note'])
                  )
                  or (
                    table_name = 'annotation'
                    and column_name = any(array['revision_id', 'requirement_id', 'author_role', 'anchor_x', 'anchor_y', 'body'])
                  )
                )
              )
              or (
                privilege_name = 'UPDATE'
                and (
                  (
                    table_name = 'brief'
                    and column_name = 'customer_label'
                  )
                  or (
                    table_name = 'revision'
                    and column_name = 'coordination_version'
                  )
                  or (
                    table_name = 'feasibility'
                    and column_name = any(array['status', 'tailor_note'])
                  )
                )
              );
          elsif database_role = 'service_role' then
            expected :=
              (
                privilege_name = 'INSERT'
                and (
                  (
                    table_name = 'review_session'
                    and column_name = any(array[
                      'brief_id',
                      'revision_id',
                      'state',
                      'snapshot',
                      'snapshot_sha256',
                      'started_at'
                    ])
                  )
                  or (
                    table_name = 'approval'
                    and column_name = any(array[
                      'revision_id',
                      'approved_by_role',
                      'approved_at',
                      'locked',
                      'snapshot',
                      'snapshot_sha256'
                    ])
                  )
                )
              )
              or (
                privilege_name = 'UPDATE'
                and (
                  (
                    table_name = 'brief'
                    and column_name = any(array[
                      'status',
                      'share_token_hash',
                      'token_expires_at',
                      'approved_revision_id',
                      'shared_revision_id',
                      'shared_snapshot',
                      'shared_snapshot_sha256',
                      'review_started_at',
                      'share_token_consumed_at',
                      'share_token_revoked_at'
                    ])
                  )
                  or (
                    table_name = 'revision'
                    and column_name = any(array['render_path', 'render_hash', 'locked_at'])
                  )
                  or (
                    table_name = 'review_session'
                    and column_name = any(array['state', 'ended_at'])
                  )
                  or (
                    table_name = 'render_job'
                    and column_name = any(array['status', 'reservation_expires_at'])
                  )
                  or (
                    table_name = 'intake_issuance'
                    and column_name = any(array[
                      'raw_cleanup_state',
                      'cleanup_attempted_at',
                      'last_error',
                      'raw_removed_at'
                    ])
                  )
                )
              );
          end if;

          actual := pg_catalog.has_column_privilege(
            database_role,
            pg_catalog.format('public.%I', table_name),
            column_name,
            privilege_name
          );

          if actual is distinct from expected then
            raise exception 'unexpected %.%.% column privilege for %: expected %, found %',
              table_name,
              column_name,
              privilege_name,
              database_role,
              expected,
              actual
              using errcode = '42501';
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  for procedure_row in
    select procedure.oid, procedure.proowner, procedure.oid::regprocedure::text as identity
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
    order by procedure.oid::regprocedure::text
  loop
    if procedure_row.proowner is distinct from 'postgres'::regrole then
      raise exception 'public function % must be owned by postgres migration owner',
        procedure_row.identity
        using errcode = '55000';
    end if;

    if pg_catalog.has_function_privilege(
      'anon',
      procedure_row.oid,
      'EXECUTE'
    ) then
      raise exception 'anon can execute public function %', procedure_row.identity
        using errcode = '42501';
    end if;

    expected := procedure_row.oid in (
      'public.get_or_create_owned_shop(text)'::regprocedure,
      'public.assert_revision_editable(uuid)'::regprocedure
    );
    actual := pg_catalog.has_function_privilege(
      'authenticated',
      procedure_row.oid,
      'EXECUTE'
    );
    if actual is distinct from expected then
      raise exception 'authenticated EXECUTE drift on %: expected %, found %',
        procedure_row.identity,
        expected,
        actual
        using errcode = '42501';
    end if;

    expected := procedure_row.oid = any(service_execute_routines);
    actual := pg_catalog.has_function_privilege(
      'service_role',
      procedure_row.oid,
      'EXECUTE'
    );
    if actual is distinct from expected then
      raise exception 'service_role EXECUTE drift on %: expected %, found %',
        procedure_row.identity,
        expected,
        actual
        using errcode = '42501';
    end if;
  end loop;
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = 'storage.objects'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'RLS must remain enabled on storage.objects'
      using errcode = '55000';
  end if;

  select policy.roles, policy.cmd, policy.qual
  into storage_read_roles, storage_read_command, storage_read_qual
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'storage'
    and policy.tablename = 'objects'
    and policy.policyname = 'shop owners can read brief images';

  if not found
    or storage_read_roles is distinct from array['authenticated']::name[]
    or storage_read_command is distinct from 'SELECT'
    or storage_read_qual !~
      'storage\.foldername\((storage\.)?objects\.name\)'
    or storage_read_qual ~ 'storage\.foldername\([^)]*shop\.name\)' then
    raise exception 'brief-images read policy must qualify storage.objects.name'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and policy.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'browser mutation policy remains on storage.objects'
      using errcode = '42501';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.roles && array['public', 'anon', 'authenticated']::name[]
  ) <> 1 then
    raise exception 'browser must have exactly one storage.objects policy'
      using errcode = '42501';
  end if;

  raise notice 'PASS exact public ACLs/RPCs, RLS, and read-only browser storage policies';
end;
$public_acl_contract$;

-- Prove PatternProof's postgres migration-owner defaults do not silently grant
-- a future public object to an API role. This DDL rolls back with the test.
create table public.release_smoke_default_acl_probe (
  id bigint generated always as identity primary key
);

create function public.release_smoke_default_acl_probe_function()
returns integer
language sql
immutable
as $probe_function$
  select 1;
$probe_function$;

do $default_acl_contract$
declare
  database_role text;
  privilege_name text;
begin
  foreach database_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
      'MAINTAIN'
    ] loop
      if pg_catalog.has_table_privilege(
        database_role,
        'public.release_smoke_default_acl_probe',
        privilege_name
      ) then
        raise exception 'postgres default granted % on a future table to %',
          privilege_name,
          database_role
          using errcode = '42501';
      end if;
    end loop;

    foreach privilege_name in array array['SELECT', 'USAGE', 'UPDATE'] loop
      if pg_catalog.has_sequence_privilege(
        database_role,
        'public.release_smoke_default_acl_probe_id_seq',
        privilege_name
      ) then
        raise exception 'postgres default granted % on a future sequence to %',
          privilege_name,
          database_role
          using errcode = '42501';
      end if;
    end loop;

    if pg_catalog.has_function_privilege(
      database_role,
      'public.release_smoke_default_acl_probe_function()',
      'EXECUTE'
    ) then
      raise exception 'postgres default granted EXECUTE on a future function to %',
        database_role
        using errcode = '42501';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
      'postgres',
      'public.release_smoke_default_acl_probe_function()',
      'EXECUTE'
    )
    or public.release_smoke_default_acl_probe_function() is distinct from 1 then
    raise exception 'future function must remain executable by its postgres owner'
      using errcode = '42501';
  end if;

  raise notice 'PASS future public table, sequence, and function defaults are deny-by-default';
end;
$default_acl_contract$;

drop function public.release_smoke_default_acl_probe_function();
drop table public.release_smoke_default_acl_probe;

do $units_constraint_runtime$
declare
  rejected boolean := false;
begin
  insert into public.render_usage (
    job_id,
    attempt_number,
    requested_by
  ) values (
    'f0160000-0000-4000-8000-000000000201',
    1,
    'f0160000-0000-4000-8000-000000000002'
  );

  if (
    select usage.units_consumed
    from public.render_usage usage
    where usage.job_id = 'f0160000-0000-4000-8000-000000000201'
      and usage.attempt_number = 1
  ) is distinct from 2 then
    raise exception 'render_usage default did not store exactly two units'
      using errcode = '55000';
  end if;

  begin
    insert into public.render_usage (
      job_id,
      attempt_number,
      requested_by,
      units_consumed
    ) values (
      'f0160000-0000-4000-8000-000000000202',
      1,
      'f0160000-0000-4000-8000-000000000002',
      1
    );
  exception
    when check_violation then rejected := true;
  end;

  if not rejected then
    raise exception 'render_usage accepted a non-two unit value'
      using errcode = '55000';
  end if;

  raise notice 'PASS units default and exact-two constraint reject drift at runtime';
end;
$units_constraint_runtime$;

-- Insert only the minimum relational fixture graph. Foreign-key and business
-- triggers are disabled for these synthetic rows, then restored before any
-- production RPC is invoked. Constraint checks remain active.
set local session_replication_role = replica;

insert into public.shop (id, owner_id, name)
values
  (
    'f0160000-0000-4000-8000-000000000010',
    'f0160000-0000-4000-8000-000000000001',
    'PatternProof release smoke owner'
  ),
  (
    'f0160000-0000-4000-8000-000000000011',
    'f0160000-0000-4000-8000-000000000002',
    'PatternProof cross-tenant smoke owner'
  );

insert into public.brief (
  id,
  shop_id,
  customer_label,
  share_token_hash,
  token_expires_at
) values
  (
    'f0160000-0000-4000-8000-000000000020',
    'f0160000-0000-4000-8000-000000000010',
    'Rollback-only synthetic brief',
    'release-smoke-f0160000-never-published',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'f0160000-0000-4000-8000-000000000021',
    'f0160000-0000-4000-8000-000000000011',
    'Rollback-only cross-tenant brief',
    'release-smoke-cross-tenant-f0160000-never-published',
    clock_timestamp() + interval '1 hour'
  );

insert into public.revision (
  id,
  brief_id,
  version,
  reference_path,
  body_path
) values
  (
    'f0160000-0000-4000-8000-000000000030',
    'f0160000-0000-4000-8000-000000000020',
    1,
    'release-smoke/reference.jpg',
    'release-smoke/body.jpg'
  ),
  (
    'f0160000-0000-4000-8000-000000000031',
    'f0160000-0000-4000-8000-000000000021',
    1,
    'release-smoke-cross-tenant/reference.jpg',
    'release-smoke-cross-tenant/body.jpg'
  );

insert into public.render_job (
  id,
  task_id,
  revision_id,
  requested_by,
  status,
  attempt_count,
  reservation_expires_at
) values
  (
    'f0160000-0000-4000-8000-000000000101',
    null,
    'f0160000-0000-4000-8000-000000000030',
    'f0160000-0000-4000-8000-000000000001',
    'reserved',
    1,
    clock_timestamp() + interval '5 minutes'
  ),
  (
    'f0160000-0000-4000-8000-000000000102',
    null,
    'f0160000-0000-4000-8000-000000000030',
    'f0160000-0000-4000-8000-000000000001',
    'reserved',
    1,
    clock_timestamp() + interval '5 minutes'
  ),
  (
    'f0160000-0000-4000-8000-000000000103',
    null,
    'f0160000-0000-4000-8000-000000000030',
    'f0160000-0000-4000-8000-000000000001',
    'reserved',
    1,
    clock_timestamp() + interval '5 minutes'
  );

set local session_replication_role = origin;

do $fixture_safety$
begin
  if current_setting('session_replication_role') is distinct from 'origin' then
    raise exception 'fixture setup did not restore origin trigger behavior'
      using errcode = '55000';
  end if;
end;
$fixture_safety$;

update public.render_budget budget
set max_units = 10,
    consumed_units = 0,
    updated_at = clock_timestamp()
where budget.id = 'youcam-cloth-v3';

do $budget_fixture$
begin
  if not exists (
    select 1
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
      and budget.max_units = 10
      and budget.consumed_units = 0
  ) then
    raise exception 'YouCam render budget fixture row is missing'
      using errcode = '55000';
  end if;
end;
$budget_fixture$;

-- A browser role must not be able to invoke the budget function, whether the
-- denial comes from the function ACL or its service-role claim guard.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'f0160000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

do $authenticated_rls_contract$
declare
  owned_requirement_id uuid;
  owned_annotation_id uuid;
  cross_tenant_write_denied boolean := false;
  cross_tenant_annotation_denied boolean := false;
begin
  if (
    select count(*)
    from public.shop shop
    where shop.id in (
      'f0160000-0000-4000-8000-000000000010',
      'f0160000-0000-4000-8000-000000000011'
    )
  ) <> 1
    or not exists (
      select 1
      from public.shop shop
      where shop.id = 'f0160000-0000-4000-8000-000000000010'
    )
    or exists (
      select 1
      from public.shop shop
      where shop.id = 'f0160000-0000-4000-8000-000000000011'
    ) then
    raise exception 'shop RLS did not isolate the authenticated owner'
      using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.brief brief
    where brief.id in (
      'f0160000-0000-4000-8000-000000000020',
      'f0160000-0000-4000-8000-000000000021'
    )
  ) <> 1
    or not exists (
      select 1
      from public.revision revision
      where revision.id = 'f0160000-0000-4000-8000-000000000030'
    )
    or exists (
      select 1
      from public.revision revision
      where revision.id = 'f0160000-0000-4000-8000-000000000031'
    ) then
    raise exception 'brief/revision RLS did not isolate the authenticated owner'
      using errcode = '42501';
  end if;

  insert into public.requirement (revision_id, label, note)
  values (
    'f0160000-0000-4000-8000-000000000030',
    'Release smoke seam placement',
    'Rollback-only RLS write probe'
  )
  returning id into owned_requirement_id;

  insert into public.feasibility (requirement_id, status, tailor_note)
  values (owned_requirement_id, 'as_shown', 'Initial smoke decision')
  on conflict (requirement_id) do update
  set status = excluded.status,
      tailor_note = excluded.tailor_note;

  insert into public.feasibility (requirement_id, status, tailor_note)
  values (owned_requirement_id, 'with_adjustment', 'Updated smoke decision')
  on conflict (requirement_id) do update
  set status = excluded.status,
      tailor_note = excluded.tailor_note;

  if not exists (
    select 1
    from public.feasibility feasibility
    where feasibility.requirement_id = owned_requirement_id
      and feasibility.status = 'with_adjustment'
      and feasibility.tailor_note = 'Updated smoke decision'
  ) then
    raise exception 'authenticated requirement/feasibility write path failed'
      using errcode = '42501';
  end if;

  insert into public.annotation (revision_id, requirement_id, author_role, anchor_x, anchor_y, body)
  values (
    'f0160000-0000-4000-8000-000000000030',
    owned_requirement_id,
    'tailor',
    0.42,
    0.31,
    'Rollback-only spatial agreement note'
  ) returning id into owned_annotation_id;

  if not exists (
    select 1 from public.annotation annotation
    where annotation.id = owned_annotation_id
      and annotation.revision_id = 'f0160000-0000-4000-8000-000000000030'
      and annotation.requirement_id = owned_requirement_id
      and annotation.author_role = 'tailor'
      and annotation.anchor_x = 0.42
      and annotation.anchor_y = 0.31
  ) then
    raise exception 'authenticated spatial annotation write/read path failed'
      using errcode = '42501';
  end if;

  begin
    insert into public.annotation (revision_id, requirement_id, author_role, anchor_x, anchor_y, body)
    values (
      'f0160000-0000-4000-8000-000000000031',
      owned_requirement_id,
      'tailor',
      0.5,
      0.5,
      'Forbidden cross-tenant spatial note'
    );
  exception
    when insufficient_privilege then cross_tenant_annotation_denied := true;
    when sqlstate '55000' then
      cross_tenant_annotation_denied := sqlerrm = 'Customer-visible revision is frozen';
    when sqlstate '23514' then
      cross_tenant_annotation_denied := sqlerrm = 'Pinned requirement must belong to the same revision';
  end;

  if not cross_tenant_annotation_denied then
    raise exception 'annotation RLS allowed a cross-tenant insert'
      using errcode = '42501';
  end if;
  begin
    insert into public.requirement (revision_id, label, note)
    values (
      'f0160000-0000-4000-8000-000000000031',
      'Forbidden cross-tenant requirement',
      null
    );
  exception
    when insufficient_privilege then cross_tenant_write_denied := true;
    when sqlstate '55000' then
      cross_tenant_write_denied := sqlerrm = 'Customer-visible revision is frozen';
  end;

  if not cross_tenant_write_denied then
    raise exception 'requirement RLS allowed a cross-tenant insert'
      using errcode = '42501';
  end if;

  raise notice 'PASS authenticated own-tenant reads/writes and cross-tenant RLS denial';
end;
$authenticated_rls_contract$;

do $browser_budget_denied$
declare
  denied boolean := false;
begin
  begin
    perform public.consume_render_budget(
      'f0160000-0000-4000-8000-000000000101',
      1
    );
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied then
    raise exception 'authenticated browser role invoked consume_render_budget'
      using errcode = '42501';
  end if;
end;
$browser_budget_denied$;

reset role;

-- Customer change requests bind to the frozen snapshot, block approval, and
-- become accepted only when the service-managed revision transition begins.
set local session_replication_role = replica;
update public.brief brief
set status = 'awaiting_customer', share_token_hash = repeat('a', 64),
    token_expires_at = clock_timestamp() + interval '1 hour',
    shared_revision_id = 'f0160000-0000-4000-8000-000000000030', shared_snapshot = '{}'::jsonb,
    shared_snapshot_sha256 = encode(digest('{}'::jsonb::text, 'sha256'), 'hex'),
    review_started_at = clock_timestamp(), share_token_consumed_at = null, share_token_revoked_at = null
where brief.id = 'f0160000-0000-4000-8000-000000000020';
insert into public.review_session (brief_id, revision_id, state, snapshot, snapshot_sha256, started_at)
values ('f0160000-0000-4000-8000-000000000020', 'f0160000-0000-4000-8000-000000000030',
  'active', '{}'::jsonb, encode(digest('{}'::jsonb::text, 'sha256'), 'hex'), clock_timestamp());
set local session_replication_role = origin;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $customer_veto_contract$
declare receipt record; approval_denied boolean := false;
begin
  select * into receipt from public.request_shared_revision_change(
    repeat('a', 64), 'f0160000-0000-4000-8000-000000000030',
    encode(digest('{}'::jsonb::text, 'sha256'), 'hex'), 'Raise the neckline by two centimetres.');
  if receipt.revision_id is distinct from 'f0160000-0000-4000-8000-000000000030'
    or receipt.source_version is distinct from 1 or receipt.state is distinct from 'open' then
    raise exception 'customer veto receipt was not bound to the exact revision' using errcode = '55000';
  end if;
  begin
    insert into public.approval (revision_id, approved_by_role, snapshot, snapshot_sha256)
    values ('f0160000-0000-4000-8000-000000000030', 'customer', '{}'::jsonb,
      encode(digest('{}'::jsonb::text, 'sha256'), 'hex'));
  exception when sqlstate 'P0001' then approval_denied := sqlerrm = 'Customer requested a new revision'; end;
  if not approval_denied then raise exception 'an open customer veto did not block approval' using errcode = '55000'; end if;
end;
$customer_veto_contract$;
reset role;
set local session_replication_role = replica;
update public.review_session set state = 'withdrawn', ended_at = clock_timestamp(), reason = 'Customer requested revision'
where revision_id = 'f0160000-0000-4000-8000-000000000030';
set local session_replication_role = origin;
set local role service_role;
update public.brief set status = 'awaiting_tailor', shared_revision_id = null, shared_snapshot = null,
    shared_snapshot_sha256 = null, review_started_at = null, share_token_revoked_at = clock_timestamp()
where id = 'f0160000-0000-4000-8000-000000000020';
reset role;
do $customer_veto_acceptance$
begin
  if not exists (select 1 from public.customer_change_request where brief_id = 'f0160000-0000-4000-8000-000000000020'
    and state = 'accepted' and resolved_at is not null) then
    raise exception 'revision transition did not accept the customer veto' using errcode = '55000';
  end if;
  raise notice 'PASS exact customer veto blocks approval and is accepted by revision transition';
end;
$customer_veto_acceptance$;

-- First admitted attempt: exactly +2 and one exact provenance row.
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $first_budget_call$
begin
  if public.consume_render_budget(
      'f0160000-0000-4000-8000-000000000101',
      1
    ) is distinct from true then
    raise exception 'first admitted render attempt was not accepted'
      using errcode = '55000';
  end if;
end;
$first_budget_call$;

reset role;

do $first_budget_assertions$
begin
  if (
    select budget.consumed_units
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
  ) is distinct from 2 then
    raise exception 'first admitted render attempt did not cost exactly two units'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from public.render_usage usage
    where usage.job_id = 'f0160000-0000-4000-8000-000000000101'
      and usage.attempt_number = 1
      and usage.requested_by = 'f0160000-0000-4000-8000-000000000001'
      and usage.units_consumed = 2
  ) <> 1 then
    raise exception 'first admitted render attempt lacks one exact two-unit usage row'
      using errcode = '55000';
  end if;
end;
$first_budget_assertions$;

-- Exact replay: true again, with no second row and no second charge.
set local role service_role;

do $replayed_budget_call$
begin
  if public.consume_render_budget(
      'f0160000-0000-4000-8000-000000000101',
      1
    ) is distinct from true then
    raise exception 'exact render attempt replay was not accepted idempotently'
      using errcode = '55000';
  end if;
end;
$replayed_budget_call$;

reset role;

do $replay_assertions$
begin
  if (
    select budget.consumed_units
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
  ) is distinct from 2 then
    raise exception 'exact replay changed the durable budget'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from public.render_usage usage
    where usage.job_id = 'f0160000-0000-4000-8000-000000000101'
      and usage.attempt_number = 1
  ) <> 1 then
    raise exception 'exact replay changed the usage-row cardinality'
      using errcode = '55000';
  end if;

  raise notice 'PASS first +2 charge and exact replay idempotency';
end;
$replay_assertions$;

-- A distinct admitted job costs a second +2.
set local role service_role;

do $second_budget_call$
begin
  if public.consume_render_budget(
      'f0160000-0000-4000-8000-000000000102',
      1
    ) is distinct from true then
    raise exception 'second admitted render job was not accepted'
      using errcode = '55000';
  end if;
end;
$second_budget_call$;

reset role;

do $second_budget_assertions$
begin
  if (
    select budget.consumed_units
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
  ) is distinct from 4 then
    raise exception 'second admitted render job did not add exactly two units'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from public.render_usage usage
    where usage.job_id in (
      'f0160000-0000-4000-8000-000000000101',
      'f0160000-0000-4000-8000-000000000102'
    )
      and usage.attempt_number = 1
      and usage.units_consumed = 2
  ) <> 2 then
    raise exception 'two admitted jobs must have two exact two-unit usage rows'
      using errcode = '55000';
  end if;

  raise notice 'PASS distinct second job adds exactly two units';
end;
$second_budget_assertions$;

-- Put the circuit breaker exactly at its boundary. The third attempt must
-- raise P0001, and its insert/increment must both roll back.
update public.render_budget budget
set max_units = 4,
    updated_at = clock_timestamp()
where budget.id = 'youcam-cloth-v3'
  and budget.consumed_units = 4;

do $exact_boundary_fixture$
begin
  if not exists (
    select 1
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
      and budget.max_units = 4
      and budget.consumed_units = 4
  ) then
    raise exception 'could not place render budget at the exact exhaustion boundary'
      using errcode = '55000';
  end if;
end;
$exact_boundary_fixture$;

set local role service_role;

do $exhausted_budget_call$
declare
  exhausted boolean := false;
begin
  begin
    perform public.consume_render_budget(
      'f0160000-0000-4000-8000-000000000103',
      1
    );
  exception
    when sqlstate 'P0001' then
      exhausted := sqlerrm = 'global render budget exhausted';
  end;

  if not exhausted then
    raise exception 'exact-boundary attempt did not raise global budget P0001'
      using errcode = '55000';
  end if;
end;
$exhausted_budget_call$;

reset role;

do $exhaustion_assertions$
begin
  if (
    select budget.consumed_units
    from public.render_budget budget
    where budget.id = 'youcam-cloth-v3'
  ) is distinct from 4 then
    raise exception 'exhausted attempt changed the durable budget'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.render_usage usage
    where usage.job_id = 'f0160000-0000-4000-8000-000000000103'
      and usage.attempt_number = 1
  ) then
    raise exception 'exhausted attempt left an uncharged usage row'
      using errcode = '55000';
  end if;

  raise notice 'PASS exact-boundary exhaustion raises P0001 with no row or increment';
end;
$exhaustion_assertions$;

rollback;
