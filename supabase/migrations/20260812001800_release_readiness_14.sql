-- Historical readiness checkpoint after 013. Continue through 015 and 016.

create table if not exists public.patternproof_release (
  singleton boolean primary key default true check (singleton),
  migration integer not null check (migration > 0),
  installed_at timestamptz not null default now()
);

insert into public.patternproof_release (singleton, migration, installed_at)
values (true, 14, clock_timestamp())
on conflict (singleton) do update
set migration = excluded.migration,
    installed_at = excluded.installed_at;

alter table public.patternproof_release enable row level security;
revoke all on public.patternproof_release from public, anon, authenticated, service_role;
grant select on public.patternproof_release to service_role;
