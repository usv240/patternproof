# Day 1 - YouCam validation results

Status: **Core validation complete - T0, T2, T3, application-side T4, T5, T6, and T7 passed. Optional out-of-scope T1 remains untested.**
Updated: 2026-08-12

This is an evidence record, not a marketing claim. Temporary signed URLs, task IDs, API credentials, and customer data are deliberately excluded.

## Environment safety

- [x] .env.local is ignored and secret values are absent from tracked source.
- [x] Credential previously displayed in chat/screenshots was rotated before the public deployment.
- [x] All repository QA inputs are project-authorized synthetic fixtures documented in ASSETS.md.
- [x] Live result files and the redacted machine report remain ignored under test-results/.

## T0 - authentication and complete round trip

- Auth: bearer API-key authentication confirmed on 2026-08-02; the V2 task request returned HTTP/API status 200.
- File flow: POST /s2s/v2.0/file/cloth-v3 issues a signed upload request; its file_id can be used by the task endpoint.
- Task flow: POST /s2s/v2.0/task/cloth-v3, then GET /s2s/v2.0/task/cloth-v3/{task_id} until a terminal state.
- Supported test inputs: JPEG/PNG, under 10 MB, with at least 512 by 384 pixels per the official Clothes VTO documentation.
- Result: **PASS.** The application smoke returned 202, polling reached success, and the provider key stayed server-side.

## T1 - arbitrary fabric-swatch upload

- Result: **Pending.**
- Decision: PatternProof makes no fabric-swatch or fabric-drape claim. A failed T1 does not change the garment-reference product path.

## T2 - clean Clothes VTO baseline

- Input: documented clean sample body and catalogue-style garment.
- Result: successful, recognizable output in 12.8 seconds.
- Decision: **PASS.** The project kill gate did not trigger.

## T3 - messy-reference gate

All inputs were rights-clean synthetic fixtures created for this repository. Visual review compared the resulting garment silhouette, olive color, cream piping, cream waist buttons, tied waist, sleeves, and skirt treatment against the references.

| Reference | Provider outcome | Duration | Recognizably transferred? | Review note |
|---|---|---:|---|---|
| Garment worn by another person | Success | 22.665 s | Yes | Strong transfer of the distinctive olive wrap dress, cream trim, buttons, and overall construction cues. |
| Angled / cropped garment | Success | 13.188 s | Yes | Recognizable design transfer despite oblique framing and crop. |
| Low-light garment | Success | 22.215 s | Yes | Recognizable transfer; some fine cream-trim detail was softened. |

Decision: **PASS, 3 of 3.** The required threshold was at least 2 of 3, so arbitrary rights-cleared garment-reference upload remains in scope.

## T4 - poor body-photo handling

- Live provider observation: the deliberately dark, partial-body fixture returned technical success after 31.516 seconds, but the resulting image was visibly partial/dim and not acceptable to show a customer.
- Production response: the app now inspects the normalized body image before canonical storage finalization or any billable provider call.
- Current gate: reject an edge below 512/384 pixels, grayscale mean below 70, or insufficient portrait framing. Full-look categories require height/width at least 1.2; tops require at least 0.9.
- User response: the intake screen gives category-specific resolution, lighting, and framing guidance.
- Evidence: focused clean/bad fixture tests plus the full automated gate.
- Decision: **PASS at the application boundary.** The provider itself did not fail cleanly, so pre-provider rejection is mandatory.

## T5 - unit cost

| Endpoint | Official feature-cost result | Billing unit | Product use |
|---|---:|---|---|
| Clothes VTO V3 | 2 units | One successful result image | Used |
| Clothes VTO V2 | 2 units | One successful result image | Not used |
| Background Removal | Not queried | - | Not used |
| Fabric VTO | Not queried | - | Not used |

> Historical scope note: this table records the Day 1 Clothes-VTO kill-gate decision. On August 14, the production evidence-chain extension queried the official authenticated feature-cost catalog and bounded three additional apparel-relevant operations: Background Removal at 1 unit per result, Fabric VTO at 2 units per result, and Image-to-Video 480p at 1 unit per second. PatternProof fixes motion at five seconds, so that operation is charged 5 internal units. These additions do not change the Day 1 Clothes result; their hosted acceptance is recorded separately rather than backfilled into the original experiment.

Evidence: on 2026-08-03, the authenticated read-only GET /s2s/v2.0/credit/feature-cost endpoint was paged to the Clothes entries. It returned amount 2, proc_unit 1, unit result_image for both V2 and V3. The official description states that failed engine tasks do not consume units.

Decision: **PASS.** The provider reports 2 units per successful V3 result. PatternProof conservatively reserves 2 internal units per admitted attempt. Its 900-unit default is a circuit-breaker ceiling, not a balance guarantee: validation calls occurred outside the ledger, so release requires reconciling the live provider balance and lowering `render_budget.max_units` enough to preserve the desired judging reserve.

## T6 - signed-URL compatibility

- Perfect Corp File API: **PASS.** Metadata request, provider-issued HTTPS PUT, file IDs, task creation, polling, and result download all succeeded with the local QA fixtures.
- Observed result host: yce-us.s3-accelerate.amazonaws.com.
- Supabase expiring signed input URL: **PASS.** The hosted private bucket issued expiring body/reference URLs accepted by the live V3 task; the completed result was validated, normalized, and re-hosted privately.
- Public input URL: not required for the tested File API path.
- Architecture: canonical inputs remain private, YouCam receives time-limited signed access, and the completed output is immediately validated and re-hosted in private storage. No signed URL, task ID, or credential is recorded here.

## T7 - latency and repeat behavior

| Attempt | Scenario | Duration | Outcome |
|---|---|---:|---|
| 1 | Worn reference | 22.665 s | Success |
| 2 | Angled / cropped reference | 13.188 s | Success |
| 3 | Low-light reference | 22.215 s | Success |
| 4 | Poor body input | 31.516 s | Provider success; app now rejects before provider |
| 5 | Identical worn-reference repeat | 13.485 s | Success; output SHA-256 exactly matched attempt 1 |

- Median across the five controlled calls: **22.215 seconds**.
- Median target (<30 seconds): **PASS**.
- Repeated identical input: **PASS.** The repeated call returned byte-identical output. This demonstrates observed determinism, not proof of the provider's internal cache policy.
- Exact repeat evidence: both attempt 1 and attempt 5 produced SHA-256 `b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9` (141,631 bytes).
- Cache/idempotency: mandatory and implemented with a canonical input-pair digest, database reservation, lease, usage budget, and private persisted result. Normal product use reuses the stored result instead of issuing a second billable provider task.

## Final Day-1 decision

- [x] Continue: T0 and T2 passed.
- [x] Build with arbitrary rights-cleared garment references: T3 passed 3/3.
- [x] Reject bad body inputs before provider spend: application T4 gate implemented and tested.
- [x] Exact Clothes VTO V3 cost is 2 units per successful result image from the official feature-cost API.
- [x] Hosted Supabase signed inputs, live V3 generation, private result re-hosting, and signed result retrieval passed end to end.
- [x] Controlled identical-input repeat returned the same output digest; product cache still prevents duplicate spend.
- [x] Exposed provider credential rotated before public deployment; the replacement exists only in deployment/local secret stores.