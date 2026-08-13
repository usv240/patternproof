# Supabase deployment order

Apply this release only to a new, empty Supabase project. The three bootstrap files together are migration 001. Run every later file once in ascending order; they are additive and are not alternatives to the bootstrap.

The canonical, deployable history is `supabase/migrations/`. Apply every timestamped file once in filename order. The first three files form release migration 001; all later files are additive. `20260813000100_customer_change_requests.sql` is the final sentinel migration.

Do not skip 012 or 014: both are part of the ordered release history even though later migrations advance the readiness sentinel. Do not reorder, partially rerun, or paste these files into an unknown legacy schema. Migrations 015 through 020 are each safe to rerun at their own completed sentinel; 015's legacy-budget correction is fenced to sentinel 14 and therefore runs exactly once. PostgreSQL rollback is not automatic; restore a tested backup or ship a reviewed forward migration. When upgrading an active deployment, pause render admissions and workers until 015 commits so an already-open transaction cannot resume the retired one-unit function body; this does not apply to a fresh empty project. Apply 016 through 020 as complete transactions before deploying code that expects sentinel 20, and keep traffic disabled until the live Auth/RLS/Storage verification passes.

## Project configuration

- Keep the `brief-images` bucket private. `migrations/20260812000300_storage.sql` sets a 10 MB object limit and allows only `image/jpeg` and `image/png`.
- Set Supabase Auth Site URL to the exact production `APP_URL`.
- Add `APP_URL/auth/callback` to the Auth redirect allowlist.
- Enable email magic links, restrict pilot onboarding, and configure provider email/rate limits.
- Keep the service-role key server-only. Never place it in a `NEXT_PUBLIC_` variable or use it to simulate a browser RLS test.

## Readiness sentinel

After all files commit, this must return exactly one row with migration `20`:

```sql
select migration, installed_at
from public.patternproof_release
where singleton = true;
```

`GET /api/health` checks this row through the service role and also checks the private bucket. A missing/outdated sentinel must keep traffic in a not-ready state.

The default budget is 900 units and Clothes VTO V3 consumes two units per admitted attempt, so the database hard ceiling is 450 vendor POSTs. Every `render_usage.units_consumed` value must be exactly `2`; an exact replay of the same job attempt is idempotent and consumes nothing further.

After 013b, the unsafe legacy withdrawal path must be unavailable:

```sql
select has_function_privilege(
  'service_role',
  'public.withdraw_customer_review(uuid,text)',
  'execute'
) as legacy_withdraw_must_be_false;
```

## Mandatory live verification

Use two real Auth users plus a separate unauthenticated client. Record the project, migration timestamp, operator, and evidence for every result.

- User A cannot select or mutate user B's shop, brief, revision, requirement, feasibility, annotation, consent, job, usage, review, intake, clone, erasure, approval, or object rows.
- A cross-tenant or cross-revision object path cannot produce a signed URL.
- Anon/authenticated roles cannot execute service-only review, approval, render-budget, intake finalization/cleanup, clone, maintenance, or erasure functions.
- Service role can execute all five fenced clone RPCs, while anon/authenticated cannot execute any of them; the legacy `withdraw_customer_review(uuid,text)` result above is `false`.
- A reviewed revision rejects row, child-row, consent, render, and object mutation.
- A token cannot approve a different revision, changed snapshot, expired/withdrawn review, or second approval.
- Simultaneous approval requests produce one approval and one immutable approved pointer.
- Simultaneous render requests produce one budget usage row with `units_consumed = 2`, increment the singleton budget by exactly two units, and create at most one vendor POST reservation.
- Simultaneous intake finalization requests preserve one ready brief and delete both temporary originals.
- An interrupted intake cleanup retains its exact object manifest and succeeds on retry.
- Review withdrawal creates only a fenced version+1 clone, preserves the prior review session, and never exposes a half-copied revision.
- An interrupted review clone is claimed from its manifest and its exact orphan target objects are removed on retry.
- Body-photo erasure removes the exact canonical body object, records completion, prevents new body URLs, and preserves frozen agreement evidence.
- The `extensions.pgcrypto` functions used by review digests resolve in the deployed project.

The repository's unit and SQL-parser tests cannot substitute for live PostgreSQL concurrency, RLS, Auth, and Storage checks. Keep production traffic disabled until this suite and the application acceptance checklist in the root README pass.

## Local rollback smoke

After applying every migration to a disposable local Supabase database, copy `tests/release-smoke.sql` into that database container and execute it with `psql -X -v ON_ERROR_STOP=1`. A passing run prints all eight `PASS` notices and ends with `ROLLBACK`; it must leave the release sentinel, render budget, fixtures, and probe objects unchanged. Run it twice to exercise exact rerun and cleanup behavior. This local gate is destructive only inside its transaction and does not replace the mandatory hosted verification above.
