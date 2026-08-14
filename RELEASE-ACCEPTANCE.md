# Production release acceptance

**Release:** PatternProof sentinel 22
**Production origin:** https://patternproof-nu.vercel.app
**Executed:** August 14, 2026 (EDT)
**Scope:** synthetic, rights-cleared QA data only

This is a public-safe evidence record. It intentionally excludes cookies, user and brief identifiers, task IDs, raw share tokens, signed URLs, credentials, and private object paths. It records application-boundary acceptance, not customer outcome validation or a provider cache-policy claim.

## Final acceptance matrix

| Boundary | Production exercise | Result | Public-safe evidence |
|---|---|---:|---|
| Dependencies | Clean locked install; complete and production-only audits at low threshold | PASS | 0 known vulnerabilities |
| Code quality | TypeScript, 140 Node tests, ESLint | PASS | 140/140 |
| Production build | Next.js optimized build using locked dependencies | PASS | 17/17 static pages generated; all server routes compiled |
| Readiness | GET /api/health after migration 022 and matching deploy | PASS | HTTP 200, {status: ok} |
| Public judge path | Landing, unified /create, evidence ledger, privacy page, immutable sample | PASS | HTTP 200 over HTTPS; no credentials required |
| Demo isolation | Exact demo API token, lookalike token, demo approval mutation | PASS | exact token 200; lookalike 404; mutation 403 |
| Guest isolation | Two fresh anonymous workspaces; cross-tenant brief read and requirement write | PASS | both cross-tenant attempts returned 404 |
| Private intake | Consent-bound reservation, signed private uploads, normalization/finalization | PASS | every stage returned 2xx |
| YouCam Clothes VTO V3 | Admitted two-unit attempt, polling, result validation and private re-hosting | PASS | provider admission 202; completion 200 |
| Human veto | One disclosed adjustment plus two as-shown decisions | PASS | all three decisions saved; adjustment note preserved |
| Frozen handoff | Snapshot creation, token readback, exact digest/images/rights/decisions | PASS | frozen review 200; proof prefix 7e34a0b003b31bb9 |
| Customer consent | Snapshot-bound acknowledgement and approval | PASS | approval 200; replay-safe immutable state |
| Owner readback | Approved Cut Card after token consumption | PASS | immutable owner readback 200 |
| Draft lifecycle | Create and explicitly discard a fresh empty guest draft | PASS | 201 then 204 after migration 022 |
| Maintenance | Authenticated bounded reconciliation endpoint | PASS | 200 with aggregate-only counters |
| Data minimization | Approved body-photo erasure queues securely while agreement proof remains | PASS | UI and ledger transition verified; no body object exposed publicly |

## YouCam evidence gates

- T3 messy-reference transfer: 3/3 synthetic cases passed visual review.
- T4 input quality: poor body input rejected before provider spend.
- T5 cost: Clothes VTO V3 reports two units per successful result; PatternProof conservatively reserves two units per admitted attempt.
- T6 privacy path: short-lived signed inputs, vendor result validation, immediate private re-hosting, and signed private retrieval passed.
- T7 repeat: attempts 1 and 5 produced byte-identical SHA-256 b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9 (141,631 bytes). This is observed determinism for the controlled inputs, not a claim about the provider's cache policy.

Full protocol and bounded interpretation: [D1-RESULTS.md](D1-RESULTS.md). Asset provenance: [ASSETS.md](ASSETS.md).

## Remaining submission artifact

The application and repository gates are complete. The public 1-3 minute demo-video URL remains a submission artifact and is deliberately not fabricated here.
