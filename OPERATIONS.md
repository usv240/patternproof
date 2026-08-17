# Operations

Deployment, migration, and incident procedures. Judges do not need this file; see
[README.md](README.md) to evaluate the project and [SECURITY.md](SECURITY.md) for the
integrity model.

## Environment contract

Copy [.env.example](.env.example) for names only. Keep real values in `.env.local` and the
deployment platform. Only the two variables prefixed `NEXT_PUBLIC_` may reach browser bundles.

| Variable | Exposure | Requirement |
| --- | --- | --- |
| `APP_URL` | Server | Exact canonical origin. HTTPS mandatory in production; no path, query, or trailing route. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe | Supabase anon key; authorization still depends on RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret, server-only | Used only after route-level authorization and by maintenance workers. |
| `YOUCAM_API_KEY` | Secret, server-only | Rotate every value ever shown in chat, screenshots, logs, or recordings. |
| `YOUCAM_RESULT_HOSTS` | Server | Comma-separated exact hostnames observed in verified results. Verified US default is `yce-us.s3-accelerate.amazonaws.com`. Required in production. Never a bare `*`. |
| `CRON_SECRET` | Secret, server-only | At least 32 random bytes. Vercel sends it as `Authorization: Bearer ...`. |
| `PRIVACY_CONTACT_EMAIL` | Server-rendered public contact | Monitored operator address, displayed at `/privacy`. |

Set `NEXT_PUBLIC_` values for the Vercel build environment as well as runtime.

## Supabase bootstrap and migrations

Use a new, empty Supabase project. Apply each file once in the SQL editor in this exact order.
The three bootstrap files together are release migration 001; numeric migrations are additive,
not alternatives.

| Version | File | Purpose |
| --- | --- | --- |
| 001a | `20260812000100_schema.sql` | Core tables, types, indexes, approval primitives. |
| 001b | `20260812000200_policies.sql` | Initial row-level security and owner-scoped policies. |
| 001c | `20260812000300_storage.sql` | Private `brief-images` bucket, 10 MB limit, JPG/PNG allowlist. |
| 002 | `20260812000400_security_hardening.sql` | Render jobs, token checks, locked-row and approval hardening. |
| 003 | `20260812000500_consent_and_approval.sql` | Explicit processing consent and approved-revision pointer. |
| 004 | `20260812000600_storage_and_shop_integrity.sql` | Canonical storage paths, one shop per owner. |
| 005 | `20260812000700_render_idempotency.sql` | Pre-vendor reservations, leases, idempotency, render usage. |
| 006 | `20260812000800_review_freeze_and_integrity.sql` | Frozen review snapshots, digest-bound approval, token lifecycle. |
| 007 | `20260812000900_intake_ledger.sql` | Durable intake grants, quota, expiry, cleanup ledger. |
| 008 | `20260812001000_render_budget.sql` | Durable global and per-owner vendor budget enforcement. |
| 009 | `20260812001100_body_photo_erasure.sql` | Audited, retryable approved body-photo erasure. |
| 010 | `20260812001200_browser_write_lockdown.sql` | Browser DML removal, server-only provenance gates. |
| 011 | `20260812001300_intake_atomicity.sql` | Atomic intake creation/finalization, fenced cleanup reconciliation. |
| 012 | `20260812001400_release_readiness.sql` | Historical readiness checkpoint. |
| 013a | `20260812001500_review_clone_saga.sql` | Fenced review withdrawal, version+1 image-clone saga. |
| 013b | `20260812001600_review_clone_saga_lockdown.sql` | Distinct source/target invariant; unsafe legacy RPC revoked. |
| 013c | `20260812001700_review_clone_saga_reconciliation.sql` | Storage-absence proof, retryable reconciliation. |
| 014 | `20260812001800_release_readiness_14.sql` | Historical readiness checkpoint. |
| 015 | `20260812001900_render_unit_accounting.sql` | Two-unit Clothes VTO V3 ledger, legacy-budget correction. |
| 016 | `20260812002000_access_privileges.sql` | Least-privilege API grants, inherited privilege removal. |
| 017 | `20260812002100_body_photo_erasure_claim_fix.sql` | Retryable body-photo erasure claim fix. |
| 018 | `20260812002200_spatial_agreement_notes.sql` | Tenant-scoped spatial notes frozen into approval. |
| 019 | `20260812003000_requirement_linked_agreement_map.sql` | Requirement-linked, decision-colored Agreement Map. |
| 020 | `20260813000100_customer_change_requests.sql` | Snapshot-bound customer veto, approval race guard, revision replay. |
| 021 | `20260813000200_guest_render_ceiling.sql` | Zero-login isolated workspaces, exact retry idempotency, guest ceiling. |
| 022 | `20260814000100_draft_discard_consent_cascade.sql` | Safe consent cascade during incomplete-draft discard. |
| 023 | `20260814000200_youcam_evidence_chain.sql` | Background Removal, Fabric VTO direction, approved motion proof accounting. |
| 024 | `20260814000300_effective_reference_render_key.sql` | Binds Clothes VTO idempotency key to verified rescue hash. |

After applying SQL:

1. Confirm `brief-images` is private, limited to 10 MB, and accepts only `image/jpeg`,
   `image/png`, and `video/mp4`. Do not switch it public.
2. In Supabase Auth URL Configuration, set Site URL to `APP_URL` and add `APP_URL/auth/callback`
   to the redirect allowlist.
3. Enable anonymous sign-ins for zero-login judging. Keep Supabase Auth attack protection and
   provider abuse controls enabled; anonymous users are additionally fenced in PostgreSQL.
4. Run the two-user isolation and service-function tests in [supabase/README.md](supabase/README.md).
   Never treat the service-role key as an RLS test client.
5. Verify this returns migration `24` before deployment:

```sql
select migration, installed_at
from public.patternproof_release
where singleton = true;
```

Do not reorder, partially rerun, or apply these files to an unknown legacy schema. Database
rollback is not automatic; restore from a tested backup or apply a reviewed forward migration.
On an upgrade with live render traffic, pause render admissions until migration 015 commits.
Apply 016 through 024 as complete transactions before deploying code that expects sentinel 24.

## YouCam release configuration

1. Revoke any credential previously shown in chat or screenshots. Generate fresh credentials
   immediately before public deployment.
2. Complete T0 through T7 in [D1-RESULTS.md](D1-RESULTS.md). Record inputs, rights, timestamps,
   latency, unit cost, error behavior, and resulting hostnames. Never record temporary signed
   URLs or secrets.
3. Keep the verified US result host in `YOUCAM_RESULT_HOSTS`. Add another official regional host
   only after observing it in a live result. Redirects are re-checked; private or reserved IP
   addresses and unexpected ports are rejected.
4. Put the fresh API key in `.env.local` and Vercel only. The app uses bearer API-key
   authentication and needs no browser-visible secret.
5. Reconcile the provider console balance before launch. Verified unit costs are Background
   Removal 1, Clothes VTO V3 2, Fabric VTO 2, and the fixed five-second motion proof 5. A full
   four-feature chain is 10 units. Anonymous workspaces have a separate lifetime ceiling.

## Vercel deployment

1. Import this directory as the Vercel project root; use the locked npm install/build defaults.
2. Add every variable in the environment contract to Production.
3. Set `APP_URL` to the final HTTPS origin, update the Supabase Site URL and redirect allowlist,
   then redeploy.
4. Deploy [vercel.json](vercel.json). It schedules `GET /api/maintenance/intake-cleanup` at
   `0 3 * * *`, compatible with Vercel Hobby's daily cron restriction.
5. Vercel sends `CRON_SECRET` as the bearer authorization header. Confirm the cron appears under
   Project Settings > Cron Jobs and inspect its first invocation log.
6. Request `GET /api/health`. A ready release returns HTTP 200 with `{"status":"ok"}`. Missing
   configuration, the private bucket, or migration 024 returns HTTP 503.

References: [Vercel cron security and Hobby scheduling](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Supabase private bucket behavior](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Runbook

### Daily maintenance

The authenticated maintenance route reconciles expired or failed intake grants, removes private
temporary objects, removes eligible abandoned drafts, reconciles orphaned review-clone targets,
and retries body-photo erasure. Each call gives intake at most 100 claims or 35 seconds, then
processes at most 10 clone-cleanup and 10 body-erasure claims inside the 60-second budget. It
returns aggregate counters only.

Manual run without putting the secret in a URL:

```powershell
$patternProofOrigin = "https://your-production-origin.example"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Uri "$patternProofOrigin/api/maintenance/intake-cleanup" -Headers $headers
```

Treat a non-2xx response, repeatedly nonzero `cleanupRequired`, or nonzero
`reviewCloneCleanup.retryRequired` / `invalidManifests` as an incident. Never log raw
authorization headers, signed URLs, review tokens, body images, or service-role credentials.

### Monitoring

- Monitor `/api/health` from outside Vercel. Alert on consecutive 503 responses.
- Review cron logs daily. Vercel rollbacks do not roll back cron configuration.
- Monitor Supabase quotas and YouCam balance before each demo window.
- Keep provider request IDs and opaque job IDs in incident notes; exclude customer images and
  bearer URLs.
- Test restore procedures before real customer use. PostgreSQL backup and object-storage
  recovery are separate concerns.

### Incident response

- **Credential exposure:** revoke at the provider first, replace local and Vercel values,
  redeploy, verify the old value fails, then review logs.
- **Shared-link exposure:** withdraw the review or rotate the link; verify the old link fails in
  a private browser.
- **Stuck cleanup or erasure:** preserve the ledger row, run maintenance, investigate retries.
  Do not delete only the database metadata for a Storage object.
- **Approval-integrity concern:** stop new approvals, preserve the frozen snapshot, digest, and
  audit evidence, investigate before resuming.
- **Provider outage or ambiguous vendor POST:** do not blindly replay. Let the reservation and
  reconciliation workflow decide when a new attempt is safe.

## Release acceptance

Record evidence, time, environment, and operator for every item. Do not mark the app
production-ready from unit tests alone. Completed results are in
[RELEASE-ACCEPTANCE.md](RELEASE-ACCEPTANCE.md).

### Database and isolation

- Two real users prove user A cannot read or mutate user B's shop, brief, revision,
  requirements, consent, jobs, review sessions, erasure rows, or objects.
- Anon and authenticated roles cannot execute service-only review, approval, render budget,
  maintenance, intake finalization, or erasure functions.
- Cross-tenant object paths cannot produce signed URLs.
- Simultaneous intake finalization yields one ready brief and deletes temporary originals.
- Simultaneous render requests create one usage row, charge the exact cost once, and create at
  most one vendor POST reservation.
- Simultaneous approval requests produce one approval and one immutable approved pointer.
- A changed, expired, withdrawn, consumed, or different-revision token cannot approve.

### End-to-end product

- Magic-link login succeeds at the final HTTPS origin and rejects an unlisted redirect.
- A rights-cleared JPG and PNG pass intake; oversize, malformed, decompression-bomb, and
  metadata-heavy files fail safely.
- T3 through T7 are complete and the result-host allowlist matches real provider redirects.
- Background rescue is available only before preview; a Fabric VTO direction only after the
  Clothes result and before human review; motion proof only after approval and outside the
  checksum.
- Tailor feasibility blocks incomplete, adjusted-without-note, and not-feasible reviews.
- The customer sees the exact frozen images, hashes, requirements, decisions, notes, consent
  summary, shop, and revision.
- Approval remains readable after token consumption and creates a print-usable Cut Card.
- Body-photo erasure removes the object, stops new signed body URLs, records completion, and
  preserves frozen agreement evidence.
- Expired abandoned intake is removed by a real scheduled maintenance invocation.

### Browser and presentation

- Test owner and customer paths in separate incognito sessions on current Chrome, Safari, and
  one mobile browser.
- Test keyboard-only navigation, visible focus, form labels and errors, 200% zoom, touch
  targets, and screen-reader landmarks.
- Print the approved Cut Card to PDF and inspect every page.
- Verify demo images have documented rights in [ASSETS.md](ASSETS.md), include an honest
  not-feasible scenario, and contain no credentials or customer data.

### Release security gate

Run immediately before any public push:

```powershell
npm ci
npm run check
npm run build
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
$credentialPattern = 'sk-o-' + '8-[A-Za-z0-9_-]{12,}'
rg -n $credentialPattern . -g "!node_modules/**" -g "!.next/**" -g "!.env.local"
```

The final `rg` must return no matches. Also inspect `git status`, `git ls-files`, screenshots,
screen recordings, terminal history shown in videos, and dashboard frames. No `.env*` file
except `.env.example` may be tracked. Rotate displayed credentials even if every grep is clean.

The checked-in GitHub Actions workflow repeats dependency installation, secret fingerprints,
typecheck, tests, lint, production build, and dependency audits on every push and pull request.
