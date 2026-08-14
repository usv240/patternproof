# PatternProof security model

PatternProof handles customer body images and approval evidence. Treat the app as a privacy-sensitive workflow, not a public image generator.

## Trust boundaries

- Browser clients are untrusted. They never receive the Supabase service-role key or the YouCam key.
- Tailor writes use an authenticated Supabase session plus row-level security.
- Customer links are 256-bit bearer tokens. Only SHA-256 hashes are stored.
- Service-role access is limited to server routes that first prove either owner access or a valid, unexpired customer token.
- YouCam receives short-lived signed input URLs. Image results are downloaded, decoded, normalized, and re-hosted privately; post-approval MP4 proof is strictly content-typed, byte-bounded, hashed, and re-hosted privately.

## Cut Card invariants

- A revision cannot be shared without persisted consent, a private render, at least one requirement, and a feasible decision for every requirement.
- `not_feasible` blocks sharing and approval.
- `with_adjustment` requires a nonblank customer-visible tailor note.
- A customer token is bound to one exact revision and review snapshot.
- A revision under customer review is frozen. Changes require a new revision and link.
- Approval is a single atomic database operation: verify token and snapshot, create evidence, lock the revision, set the approved pointer, and consume the token.
- Approved rows and their image objects are immutable outside the audited erasure workflow.

## Image handling

- Raw JPG/PNG files upload directly to a private temporary object using a one-path signed grant.
- The server decodes with Sharp, enforces pixel/byte limits, rotates orientation, converts to sRGB JPEG, and removes EXIF/XMP/IPTC metadata.
- Normalized inputs and image evidence carry SHA-256 digests. Approved motion proof also carries a SHA-256 digest but is deliberately excluded from the immutable construction checksum.
- Every server-signed object path is checked against `{shop}/{brief}/{revision}/{canonical filename}` before signing.
- Temporary-object deletion state is persisted so failed cleanup can be retried by maintenance rather than silently forgotten.

## Abuse and cost controls

- Magic-link requests are throttled without retaining raw email/IP values in process memory.
- Intake issuance is recorded in a durable ledger, so deleting a draft cannot reset quota.
- Every Clothes, Background Removal, Fabric VTO, and Image-to-Video task is reserved atomically before the external API call. Identical concurrent requests reuse one opaque job ID; only the transaction that claims the reservation may create the provider task.
- Vendor POSTs are never automatically retried. Safe polling GETs have bounded retry/backoff.
- Clothes attempts have per-owner limits, leases, cooldowns, and a three-attempt maximum. Optional evidence jobs have a two-attempt ceiling. All features share one global circuit breaker and exact costs: Background Removal 1 unit, Clothes VTO V3 2, Fabric VTO 2, and fixed five-second 480p motion 5. An anonymous workspace cannot consume more than 12 YouCam units in its lifetime.

## Deployment requirements

1. Apply bootstrap 001 and every SQL migration through 024 in the exact order in `supabase/README.md`; 024 is the final readiness sentinel.
2. Configure `APP_URL` as the exact HTTPS production origin.
3. Store all secrets only in the deployment platform and `.env.local`; never use `NEXT_PUBLIC_` for secrets.
4. Configure the maintenance secret, result-host allowlist, monitored privacy contact, and scheduled cleanup route.
5. Enable Supabase email/provider rate limits and restrict pilot onboarding.
6. Rotate the previously displayed YouCam credentials before any public deployment.
7. Run the automated and live release gates in `README.md`, including the credential/screenshot scan and cross-tenant/RLS suite.

## Incident response

- Suspected key exposure: revoke the key at the provider first, replace deployment values, redeploy, then review render/auth logs.
- Suspected customer-link exposure: rotate the brief link; old hashes become invalid immediately.
- Failed temporary cleanup: do not claim deletion; leave the ledger in `cleanup_required` and run the maintenance worker.
- Approval-integrity alert: stop new approvals, preserve the approval snapshot/digest and audit records, and investigate before resuming.
