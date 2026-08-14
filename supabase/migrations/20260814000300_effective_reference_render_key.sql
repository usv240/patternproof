-- Keep the Clothes VTO idempotency key bound to the effective reference.
-- Migration 023 introduced a verified Background Removal rescue artifact, but
-- the older reservation function still recomputed its expected key from the
-- original normalized reference. This migration changes that single invariant
-- without weakening the existing ownership, locking, retry, or budget fences.

begin;

do $$
begin
  if not exists (
    select 1 from public.patternproof_release
    where singleton = true and migration in (23, 24)
  ) then
    raise exception 'Migration 024 requires release sentinel 23';
  end if;
end;
$$;

do $$
declare
  function_definition text;
  original_expression constant text :=
    'r.garment_spec #>> ''{normalized_images,reference,sha256}''';
  effective_expression constant text :=
    'coalesce(r.reference_rescued_hash, r.garment_spec #>> ''{normalized_images,reference,sha256}'')';
begin
  select pg_get_functiondef(
    'public.reserve_render_job(uuid,text,text,text,uuid)'::regprocedure
  ) into function_definition;

  if function_definition is null then
    raise exception 'reserve_render_job definition is missing';
  end if;

  if position(effective_expression in function_definition) > 0 then
    return;
  end if;

  if position(original_expression in function_definition) = 0 then
    raise exception 'reserve_render_job reference-hash invariant changed unexpectedly';
  end if;

  if length(function_definition) - length(replace(function_definition, original_expression, ''))
      <> length(original_expression) then
    raise exception 'reserve_render_job reference-hash invariant is not unique';
  end if;

  function_definition := replace(
    function_definition,
    original_expression,
    effective_expression
  );
  execute function_definition;
end;
$$;

comment on function public.reserve_render_job(uuid, text, text, text, uuid) is
  'Atomically reserves Clothes VTO using the verified body hash and effective (rescued when present) reference hash.';

revoke all on function public.reserve_render_job(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_render_job(uuid, text, text, text, uuid)
  to service_role;

update public.patternproof_release
set migration = 24, installed_at = clock_timestamp()
where singleton = true and migration = 23;

do $$
begin
  if not exists (
    select 1 from public.patternproof_release
    where singleton = true and migration = 24
  ) then
    raise exception 'Migration 024 did not advance the release sentinel';
  end if;
end;
$$;

commit;
