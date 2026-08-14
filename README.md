# PatternProof

PatternProof turns garment inspiration into a tailor-feasibility-checked, customer-approved Cut Card before fabric is cut. Its public `/proof` ledger makes bounded integration evidence visible, while approved records support local QR printing and WhatsApp handoff.

The central product promise is narrow: the shop and customer approve the same frozen visual and construction decisions before an irreversible cut. The AI preview is supporting evidence, never a fit or construction guarantee.

## Release status

The repository contains the complete private intake, normalization, rendering, feasibility, frozen review, approval, and audited body-photo-erasure paths. The production deployment is [patternproof-nu.vercel.app](https://patternproof-nu.vercel.app). The final hosted acceptance evidence is recorded in [RELEASE-ACCEPTANCE.md](RELEASE-ACCEPTANCE.md).

Current evidence: YouCam T0 and T2 passed; T3 passed 3/3; the application-side T4 quality gate rejects poor live input before provider spend; T5 confirms two units per successful Clothes VTO V3 result; live signed-URL T6 passed; controlled repeated-input T7 produced byte-identical output; the exposed credential was rotated; and the zero-account production journey passed from consent-bound intake through private V3 generation, human feasibility, frozen customer review, approval, immutable owner readback, and explicit draft cleanup on August 14, 2026. This is production acceptance evidence, not a claim of measured customer outcomes; prospective impact validation remains governed by [VALIDATION-PROTOCOL.md](VALIDATION-PROTOCOL.md).

Formative problem evidence is documented in [RESEARCH.md](RESEARCH.md): 108 manually screened 1.0–2.0 public tailoring complaints across 41 de-identified businesses and three city samples. It is a purposive negative-review study—not a prevalence estimate, user validation, or proof of product impact—and it explicitly reports the failure categories PatternProof does not solve.

## Product flow

1. A visitor opens an isolated Supabase anonymous session with one click. No email or password is required; an optional magic link can still identify a returning pilot owner.
2. The browser receives single-purpose private upload grants. The server validates each JPG/PNG, limits pixels and bytes, rotates orientation, converts to sRGB JPEG, strips embedded metadata, and records SHA-256 digests.
3. A server-only YouCam request uses short-lived signed input URLs. The returned image is allowlisted, downloaded, validated, normalized, and stored in the private bucket.
4. The tailor records each non-negotiable and an explicit feasibility decision. `not_feasible` blocks customer review; an adjustment requires a customer-visible note.
5. Starting review freezes the exact customer-visible snapshot and its digest. A 256-bit bearer link is bound to that snapshot and expires after 14 days.
6. If the tailor withdraws review, a fenced saga copies the exact private inputs to a new version, verifies their stored hashes, and atomically publishes the editable revision. Crashed/late copies stay on a retryable deletion manifest.
7. Approval is one atomic database operation. It verifies the token and digest, locks the revision, records approval evidence, and consumes the token.
8. After approval or archival, the shop can trigger audited body-photo erasure. The agreement snapshot and digest remain as integrity evidence.

## Architecture and trust boundaries

- Next.js 15 App Router and React 19 provide the application and server routes.
- Supabase provides isolated anonymous sessions, optional magic-link authentication, PostgreSQL, row-level security, RPC transactions, and the private `brief-images` bucket.
- Perfect Corp YouCam Clothes VTO creates the visual-intent preview.
- Vercel hosts the reference deployment and invokes one authenticated daily maintenance job.
- Browsers are untrusted. They never receive the YouCam key or Supabase service-role key.
- Customer-review URLs are unguessable, expiring bearer links rather than public galleries; anyone possessing one can review it. Only SHA-256 token hashes are stored.

See [SECURITY.md](SECURITY.md) for the integrity model and incident response.

## Local development

Requirements: Node.js 22 and npm 10 or later.

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Visit `http://localhost:3000`. Because the parent workspace path contains `&`, use the npm scripts or direct Node command rather than wrapping the path in an unquoted shell string.

The unified Cut Card entry is at `/create`: visitors immediately explore a rights-cleared, no-write sample, then can create a separate private Cut Card with their own consent-bound photos in an isolated guest workspace. The deterministic immutable record is at `/s/demo-olive`. Legacy `/judge` and `/demo` links redirect into the sample workspace. Live intake requires Supabase configuration, including anonymous sign-ins.

Judges can follow the bounded zero-login and hosted paths in [JUDGING.md](JUDGING.md). The pre-results usability and prospective-order protocol is in [VALIDATION-PROTOCOL.md](VALIDATION-PROTOCOL.md); `npm run pilot:report -- <de-identified-pilot.json>` validates and summarizes pilot records without accepting personal-data fields.

### Quality commands

```powershell
npm run check
npm run build
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
```

`npm run check` runs TypeScript, unit tests, and ESLint. A successful local build is necessary, but it does not replace the live RLS, Storage, provider, or browser acceptance suite.

## Environment contract

Copy [.env.example](.env.example) for names only. Keep real values in `.env.local` and the deployment platform.

| Variable | Exposure | Requirement |
| --- | --- | --- |
| `APP_URL` | Server | Exact canonical origin. HTTPS is mandatory in production; no path, query, or trailing route. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe | Supabase anon key; authorization still depends on RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret, server-only | Used only after route-level authorization and by maintenance workers. |
| `YOUCAM_API_KEY` | Secret, server-only | Fresh YouCam API key. Rotate every value ever shown in chat, screenshots, logs, or recordings. |
| `YOUCAM_RESULT_HOSTS` | Server | Comma-separated exact hostnames, or deliberate leading-wildcard subdomains, observed in verified T3/T4 results. The verified US default is `yce-us.s3-accelerate.amazonaws.com`. Required in production. Never use a bare `*`. |
| `CRON_SECRET` | Secret, server-only | At least 32 random bytes. Vercel sends it as `Authorization: Bearer ...` to the cron route. |
| `PRIVACY_CONTACT_EMAIL` | Server-rendered public contact | Monitored operator address. Required by production readiness and displayed at `/privacy`. |

Only the two variables explicitly prefixed `NEXT_PUBLIC_` may reach browser bundles. Set `NEXT_PUBLIC_` values for the Vercel build environment as well as runtime.

## Supabase bootstrap and migrations

Use a new, empty Supabase project for the pilot. Apply each file once in the SQL editor in this exact order. The three bootstrap files together are release migration 001; numeric migrations are additive, not alternatives.

| Version | File | Purpose |
| --- | --- | --- |
| 001a | `supabase/migrations/20260812000100_schema.sql` | Core tables, types, indexes, and approval primitives. |
| 001b | `supabase/migrations/20260812000200_policies.sql` | Initial row-level security and owner-scoped policies. |
| 001c | `supabase/migrations/20260812000300_storage.sql` | Private `brief-images` bucket, 10 MB limit, JPG/PNG allowlist. |
| 002 | `supabase/migrations/20260812000400_security_hardening.sql` | Render jobs, token checks, locked-row and approval hardening. |
| 003 | `supabase/migrations/20260812000500_consent_and_approval.sql` | Explicit processing consent and approved-revision pointer. |
| 004 | `supabase/migrations/20260812000600_storage_and_shop_integrity.sql` | Canonical storage paths and one-shop-per-owner integrity. |
| 005 | `supabase/migrations/20260812000700_render_idempotency.sql` | Pre-vendor reservations, leases, idempotency, and render usage. |
| 006 | `supabase/migrations/20260812000800_review_freeze_and_integrity.sql` | Frozen review snapshots, digest-bound approval, and token lifecycle. |
| 007 | `supabase/migrations/20260812000900_intake_ledger.sql` | Durable intake grants, quota, expiry, and cleanup ledger. |
| 008 | `supabase/migrations/20260812001000_render_budget.sql` | Durable global and per-owner vendor budget enforcement. |
| 009 | `supabase/migrations/20260812001100_body_photo_erasure.sql` | Audited, retryable approved body-photo erasure. |
| 010 | `supabase/migrations/20260812001200_browser_write_lockdown.sql` | Browser DML removal and server-only provenance gates. |
| 011 | `supabase/migrations/20260812001300_intake_atomicity.sql` | Atomic intake creation/finalization and fenced cleanup reconciliation. |
| 012 | `supabase/migrations/20260812001400_release_readiness.sql` | Historical readiness checkpoint at migration 12. |
| 013a | `supabase/migrations/20260812001500_review_clone_saga.sql` | Fenced review withdrawal and version+1 image-clone saga; render-path uniqueness. |
| 013b | `supabase/migrations/20260812001600_review_clone_saga_lockdown.sql` | Distinct source/target invariant; unsafe legacy withdrawal RPC revoked. |
| 013c | `supabase/migrations/20260812001700_review_clone_saga_reconciliation.sql` | Storage-absence proof and retryable reconciliation for late clone writes. |
| 014 | `supabase/migrations/20260812001800_release_readiness_14.sql` | Historical readiness checkpoint before corrected provider-unit accounting. |
| 015 | `supabase/migrations/20260812001900_render_unit_accounting.sql` | Two-unit Clothes VTO V3 usage ledger, one-time legacy-budget correction, and health sentinel 15. |
| 016 | `supabase/migrations/20260812002000_access_privileges.sql` | Explicit least-privilege API grants, inherited privilege removal, and corrected private-object reads. |
| 017 | `supabase/migrations/20260812002100_body_photo_erasure_claim_fix.sql` | Forward fix for the unambiguous, retryable body-photo erasure claim. |
| 018 | `supabase/migrations/20260812002200_spatial_agreement_notes.sql` | Tenant-scoped spatial notes that freeze into customer approval. |
| 019 | `supabase/migrations/20260812003000_requirement_linked_agreement_map.sql` | Requirement-linked, decision-colored Agreement Map; health sentinel 19. |
| 020 | `supabase/migrations/20260813000100_customer_change_requests.sql` | Snapshot-bound customer veto, approval race guard, and traceable revision replay; health sentinel 20. |
| 021 | `supabase/migrations/20260813000200_guest_render_ceiling.sql` | Zero-login isolated workspaces, exact retry idempotency, and a two-attempt lifetime YouCam ceiling for anonymous users. |
| 022 | `supabase/migrations/20260814000100_draft_discard_consent_cascade.sql` | Forward fix for safe consent cascade and deterministic cleanup-manifest return during incomplete-draft discard. |

After applying SQL:

1. Confirm `brief-images` is private, limited to 10 MB, and accepts only `image/jpeg` and `image/png`. Do not switch it public.
2. In Supabase Auth URL Configuration, set Site URL to `APP_URL` and add `APP_URL/auth/callback` to the redirect allowlist.
3. Enable anonymous sign-ins for zero-login judging. Keep Supabase Auth attack protection, deployment monitoring, and provider abuse controls enabled; anonymous users are additionally fenced to two lifetime YouCam attempts in PostgreSQL. Add CAPTCHA only when the client supplies and verifies the provider token end to end. Configure email magic links only if returning pilot owners need durable cross-device access.
4. Run the two-user isolation and service-function tests listed in [supabase/README.md](supabase/README.md). Never treat the service-role key as an RLS test client.
5. Verify this query returns migration `22` before deployment:

```sql
select migration, installed_at
from public.patternproof_release
where singleton = true;
```

Do not reorder, partially rerun, or apply these files to an unknown legacy schema. Database rollback is not automatic; restore from a tested backup or apply a reviewed forward migration. On an upgrade with live render traffic, pause render admissions and workers until migration 015 commits so no transaction can resume the retired one-unit function body; a fresh empty deployment is unaffected. Apply 016 through 022 as complete transactions before deploying code that expects sentinel 22, and keep traffic disabled until the post-migration Auth/RLS/Storage checks pass.

## YouCam release configuration

1. Revoke the API credential and any paired console key previously shown in chat or screenshots. Generate fresh credentials immediately before public deployment.
2. Complete T3-T7 in [D1-RESULTS.md](D1-RESULTS.md). Record inputs, rights, timestamps, latency, unit cost, error behavior, signed-URL behavior, and resulting hostnames without recording temporary signed URLs or secrets.
3. Keep the verified US result host `yce-us.s3-accelerate.amazonaws.com` in `YOUCAM_RESULT_HOSTS`. Add another exact official regional host only after observing it in a live result. Every HTTPS redirect is checked again; private/reserved IP addresses and unexpected ports are rejected.
4. Put the fresh API key in `.env.local` and Vercel only. The current app uses bearer API-key authentication; it does not need a browser-visible secret.
5. Reconcile the provider console balance after validation and before launch. Clothes VTO V3 costs two units per successful result, while the database conservatively reserves two units for every admitted vendor attempt. Its default 900-unit ceiling permits at most 450 vendor POSTs, but validation calls occurred outside this ledger: lower `render_budget.max_units` as needed so the current provider balance, not the original grant, retains the desired judging reserve.

## Vercel deployment

1. Import this directory as the Vercel project root and use the locked npm install/build defaults.
2. Add every variable in [Environment contract](#environment-contract) to Production. Add preview-specific values only if preview auth and provider traffic are intended.
3. Set `APP_URL` to the final custom HTTPS origin, update the Supabase Site URL/redirect allowlist, and redeploy.
4. Deploy [vercel.json](vercel.json). It schedules `GET /api/maintenance/intake-cleanup` at `0 3 * * *` (once daily at approximately 03:00 UTC). This is compatible with Vercel Hobby's daily cron restriction.
5. Vercel automatically sends `CRON_SECRET` as the bearer authorization header. Confirm the cron appears under Project Settings > Cron Jobs and inspect its first invocation log.
6. Request `GET /api/health`. A ready release returns HTTP 200 with `{"status":"ok"}`. Missing configuration, the private bucket, or migration 022 returns HTTP 503.

Official references: [Vercel cron security and Hobby scheduling](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [Supabase private bucket behavior](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Operations runbook

### Daily maintenance

The authenticated maintenance route reconciles expired/failed intake grants, removes private temporary objects, safely removes eligible abandoned drafts, reconciles orphaned review-clone targets, and retries body-photo erasure. Each call gives intake at most 100 claims or 35 seconds, then processes at most 10 clone-cleanup claims and 10 body-erasure claims inside the 60-second function budget. It returns aggregate counters only.

A manual run is allowed for an operator without putting the secret in a URL:

```powershell
$patternProofOrigin = "https://your-production-origin.example"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Uri "$patternProofOrigin/api/maintenance/intake-cleanup" -Headers $headers
```

Treat a non-2xx response, repeatedly nonzero `cleanupRequired`, or nonzero `reviewCloneCleanup.retryRequired` / `invalidManifests` as an incident. Inspect server logs and database ledger state; do not claim deletion until completion is recorded. Never log raw authorization headers, signed URLs, review tokens, body images, or service-role credentials.

### Readiness and monitoring

- Monitor `/api/health` from outside Vercel. Alert on consecutive 503 responses.
- Review cron logs daily during the pilot and after any Vercel rollback. Vercel rollbacks do not automatically roll back cron configuration.
- Monitor Supabase database/storage quotas and YouCam balance before each demo window.
- Keep provider request IDs and opaque job IDs in incident notes, but exclude customer images and bearer URLs.
- Test restore procedures before real customer use. PostgreSQL backup and object-storage recovery are separate concerns.

### Incident response

- Credential exposure: revoke at the provider first, replace local/Vercel values, redeploy, verify the old value fails, then review logs.
- Shared-link exposure: withdraw the review or rotate the link; verify the old link fails in a private browser.
- Stuck cleanup/erasure: preserve the ledger row, run maintenance, and investigate retries. Do not delete only the database metadata for a Storage object.
- Approval-integrity concern: stop new approvals, preserve the frozen snapshot/digest and audit evidence, and investigate before resuming.
- Provider outage or ambiguous vendor POST: do not blindly replay. Let the reservation/reconciliation workflow decide when a new attempt is safe.

## Live release acceptance

Record evidence, time, environment, and operator for every item. Do not mark the app production-ready from unit tests alone.

### Database and isolation

- Two real users prove user A cannot read or mutate user B's shop, brief, revision, requirements, consent, jobs, review sessions, erasure rows, or objects.
- Anon/authenticated roles cannot execute service-only review, approval, render budget, maintenance, intake finalization, or erasure functions.
- Cross-tenant object paths cannot produce signed URLs.
- Simultaneous intake finalization yields one ready brief, exact canonical objects, and deleted temporary originals.
- Simultaneous render requests create one usage row, reserve exactly two units, and create at most one vendor POST reservation.
- Simultaneous approval requests produce one approval and one immutable approved pointer.
- A changed, expired, withdrawn, consumed, or different-revision token cannot approve.

### End-to-end product

- Magic-link login succeeds at the final HTTPS origin and rejects an unlisted redirect/origin.
- A rights-cleared JPG and PNG pass intake; oversize, malformed, decompression-bomb, and metadata-heavy files fail safely.
- T3-T7 are complete and the result-host allowlist matches real provider redirects.
- Tailor feasibility blocks incomplete, adjusted-without-note, and not-feasible reviews.
- The customer sees the exact frozen images, hashes, requirements, decisions, notes, consent summary, shop, and revision.
- Approval remains readable after token consumption and creates a print-usable Cut Card.
- Body-photo erasure removes the object, stops new signed body URLs, records completion, and preserves frozen agreement evidence.
- Expired abandoned intake is removed by a real scheduled maintenance invocation.

### Browser and presentation

- Test owner and customer paths in separate incognito sessions on current Chrome, Safari, and one mobile browser.
- Test keyboard-only navigation, visible focus, form labels/errors, 200% zoom, touch targets, and screen-reader landmarks.
- Print the approved Cut Card to PDF and inspect every page.
- Verify demo/readme images have documented rights in [ASSETS.md](ASSETS.md), include an honest not-feasible scenario, and contain no credentials or customer data.
- Record the final judging path once from a cold session and once after cache warmup.

### Release security gate

Run immediately before the public push:

```powershell
npm ci
npm run check
npm run build
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
$credentialPattern = 'sk-o-' + '8-[A-Za-z0-9_-]{12,}'
rg -n $credentialPattern . -g "!node_modules/**" -g "!.next/**" -g "!.env.local"
```

The final `rg` command must return no matches. Also inspect `git status`, `git ls-files`, screenshots, screen recordings, terminal history shown in videos, and Vercel/Supabase dashboard frames. No `.env*` file except `.env.example` may be tracked. Rotate the displayed YouCam credentials even if every grep is clean; chat history and screenshots already count as exposure.

The checked-in GitHub Actions workflow repeats dependency installation, secret fingerprints, typecheck/tests/lint, production build, and dependency audits on every push and pull request.

## Privacy

The user-facing notice is at `/privacy` and is linked from every page. It describes the implemented processor flow and explicitly distinguishes body-photo erasure from retention of frozen approval evidence. Before launch, verify the configured operator contact is monitored and have the notice reviewed for the pilot's actual operator, jurisdiction, customer age policy, provider terms, and retention obligations.

## Repository map

- `app/` — pages, components, server routes, health, and maintenance
- `lib/` — image normalization, security boundaries, Supabase, intake, review, and YouCam services
- `supabase/` — ordered schema, RLS, Storage, and integrity migrations
- `tests/` — deterministic unit and contract tests
- `public/demo/` — byte-pinned, rights-cleared public-demo assets documented in [ASSETS.md](ASSETS.md)
- `JUDGING.md` — exact zero-login and full hosted judge paths
- `VALIDATION-PROTOCOL.md` — predeclared usability and prospective impact measurement
- `D1-RESULTS.md` — live YouCam validation record
- `SECURITY.md` — security invariants and incident response
- `ASSETS.md` — asset provenance record
