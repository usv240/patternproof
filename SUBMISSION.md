# PatternProof — submission

> Most AI try-on helps one person decide what to buy. PatternProof helps two people agree on what to make — before fabric becomes irreversible.

## Short description

PatternProof is a three-key production interlock for made-to-order clothing. YouCam supplies body-specific visual evidence, the tailor supplies the construction promise, and the customer supplies consent. PatternProof binds all three to one frozen SHA-256 Expectation Checksum before fabric is cut.

## Entry details

- Hackathon topic: **Apparel VTO**
- Platform: **Web**
- Project provenance: **New project built during the 2026 hackathon submission period.**

## The problem

Made-to-order clothing can begin with an imprecise conversation: a customer shows a garment photo and describes what they want, while a tailor interprets it. Fabric may be cut before both people have confirmed the same intended outcome. A tape measure cannot resolve a disagreement about silhouette, coverage, ease, or design preference.

This matters at meaningful scale. India has about 12 million custom tailors—more than one in six manufacturing workers—and the cited labour analysis reports that 99% work informally and 72% are women. Peer-reviewed apparel research also shows that people detect small fit differences and differ in what they consider acceptable.

To test the problem framing—not estimate prevalence—we manually coded 108 eligible 1.0–2.0 public tailoring complaints concerning 41 de-identified businesses across Mumbai, Bengaluru, and Delhi. Expectation mismatch was the primary code for 24/108; eight more allegations concerned damaged customer fabric. That grouping, specified before coding, is 32/108 (29.6%), but this purposive, one-coder negative-review sample is neither product validation nor a claim that PatternProof could have prevented those events. Fit, delay, workmanship, service, and price account for the other 76/108 and remain outside the product promise. The complete method and limitations are in [RESEARCH.md](RESEARCH.md).

PatternProof does not claim to predict physical fit or eliminate remakes. It creates a verifiable communication checkpoint before an irreversible production step. A pre-results field protocol now fixes the usability tasks, outcome definitions, denominators, privacy limits, and descriptive analysis before any participant data is collected; see [VALIDATION-PROTOCOL.md](VALIDATION-PROTOCOL.md).

## What it does

1. A visitor creates an isolated private guest workspace with one click; no email or password is required.
2. The customer body photo and rights-cleared garment reference are normalized, metadata-stripped, hashed, and stored privately.
3. Category-specific capture checks reject images that are too small, dark, or poorly framed before a billable API call.
4. YouCam Clothes Virtual Try-On V3 generates the core body-specific visual-intent preview. When a reference needs rescue, YouCam Background Removal may run first. After the core preview and before human review, the tailor may choose one YouCam-defined Fabric VTO direction; it is explicitly not an uploaded swatch or drape simulation.
5. After approval, YouCam Image-to-Video V2 can create a fixed five-second 480p presentation proof. Motion is excluded from the frozen construction checksum and cannot change an approved Cut Card.
6. The tailor marks every non-negotiable as “Can make as shown,” “Can make with adjustment,” or “Not feasible.” Adjustments require a customer-visible note; a not-feasible item blocks approval.
7. The tailor turns the YouCam result into an Agreement Map: every coordinate-specific pin is linked to one non-negotiable and inherits its green, amber, or blocked decision state.
8. A shared Cut Readiness Passport exposes six conditions—rights, preview, human decisions, feasibility, frozen snapshot, and customer approval—so “ready to cut” is an explicit protocol rather than a visual impression.
9. Starting customer review freezes the exact preview, reference proof, requirements, decisions, spatial annotations, consent evidence, shop, and revision digest into an Expectation Checksum.
10. The customer must acknowledge each customer-visible tailor adjustment before approval. The server independently derives the required adjustment IDs from the frozen snapshot and demands an exact match; a blind or bypassed checkbox cannot turn the customer key.
11. The customer can instead submit a snapshot-bound veto. That request races safely with approval, blocks cutting at the database boundary, and becomes a verified version+1 in Revision Replay rather than silently editing history.
12. After approval, the original body photo can be erased while the agreement evidence remains. The review link can be handed off through WhatsApp, reflecting the real conversational channel without exposing the credential to an external sharing service.

## Why YouCam is essential

YouCam Clothes Virtual Try-On V3 is the indispensable visual engine: it turns another garment reference into the body-specific evidence around which the customer and tailor make explicit production decisions. Three apparel-relevant YouCam capabilities reinforce distinct lifecycle boundaries instead of inflating a feature count: Background Removal rescues a noisy reference before preview; Fabric VTO offers an optional provider-defined visual direction before human feasibility; and Image-to-Video V2 communicates an approved look after the agreement is locked. PatternProof adds the workflow the models cannot provide by themselves: input quality control, consent, private storage, exact-cost idempotency, human feasibility, frozen review evidence, versioning, approval, and erasure.

Live validation used project-authorized synthetic fixtures:

- a garment worn by another person;
- an angled/cropped garment reference;
- a low-light garment reference.

In our visual review of these three synthetic cases, all three produced recognizable transfers. The controlled five-call median was 22.215 seconds, and an identical repeat returned byte-identical output. A deliberately poor body photo exposed an unusable provider success, so PatternProof now rejects that input locally before provider spend.

## Technical implementation

- Next.js 15 App Router, React 19, TypeScript, and Sharp.
- Supabase Auth, PostgreSQL, row-level security, private Storage, and transactional RPCs.
- Server-only YouCam bearer credential and exact result-host allowlist.
- Canonical image normalization, EXIF removal, pixel/byte limits, SHA-256 evidence, and ownership-bound storage paths.
- Durable provider-task reservations, leases, per-owner throttling, exact costs of 1/2/2/5 units for Background Removal/Clothes/Fabric/Motion, a 12-unit guest ceiling, and one global circuit breaker.
- Digest-bound 256-bit customer links with 14-day expiry, revocation, and single-revision approval.
- Fenced cleanup workers for abandoned intake, revision-clone recovery, and body-photo erasure.
- No YouCam or Supabase service credential enters browser code. A public evidence ledger makes the bounded transfer tests, private signed-URL path, and observed byte-identical repeat visible without exposing customer or operational data.

## What is genuinely different

Production proofing already exists in printing and embroidery. PatternProof applies that proven pattern to body-specific made-to-order clothing, where generative VTO makes the proof possible. The non-obvious combination is:

- the customer's own body;
- an arbitrary rights-cleared garment inspiration reference;
- a requirement-linked Agreement Map with human constructability decisions;
- a six-condition evidence passport beneath a three-key production interlock;
- an Expectation Checksum binding YouCam evidence, tailor judgment, and customer consent to one frozen revision;
- server-enforced acknowledgement of every customer-visible adjustment;
- a customer veto that becomes a traceable revision rather than an ambiguous message;
- a frozen, versioned approval before an individual garment is cut.

This is not a fitting room, measurement system, tailor POS, marketplace, or fit guarantee. It is the visual approval layer between conversation and cutting: no green checksum, no cut.

## Privacy and limitations

- The preview communicates visual intent only. It is not a guarantee of measurements, physical fit, construction, fabric drape, or final appearance.
- Fabric VTO uses only current provider-defined visual directions. PatternProof makes no uploaded-swatch, physical fabric, colorimetry, or drape claim.
- Post-approval motion is presentation-only and excluded from the frozen construction checksum.
- Customer reviews use unguessable, expiring bearer links rather than public galleries; possession of a link grants review access.
- The demo fixtures are synthetic and contain no real customer data.
- No real-tailor outcome study has been completed; impact outcomes remain pilot hypotheses.
- The repository includes a predeclared independent-tailor workflow test and a strict, privacy-minimized prospective pilot reporter. Targets are not presented as results.

## Source evidence

- [Data For India, “The Rise of Custom Tailoring”](https://www.dataforindia.com/custom-tailoring/) — analysis based on PLFS July 2023–June 2024 and Census projections.
- [Ashdown & DeLong, Perception testing of apparel ease variation](https://pubmed.ncbi.nlm.nih.gov/15677000/) — Applied Ergonomics, 1995.
- [Dik et al., psychographic orientation and apparel fit satisfaction](https://pmc.ncbi.nlm.nih.gov/articles/PMC10362334/) — Heliyon, 2023.
- [Perfect Corp. AI Clothes Virtual Try-On documentation](https://docs.perfectcorp.com/reference/ai_clothes/section/overview).
- [PatternProof formative negative-review study](RESEARCH.md) — manual problem discovery; purposive sample, not prevalence or product validation.

## Judge access

- Live URL: [https://patternproof-nu.vercel.app](https://patternproof-nu.vercel.app)
- Unified Cut Card path: `/create` (rights-cleared sample or consent-bound private intake)
- Public immutable example: `/s/demo-olive`
- Exact judge path: [JUDGING.md](JUDGING.md)
- Access instructions: no account or credentials required; choose **Create with my photos** for an isolated private workspace.
- Source repository: [https://github.com/usv240/patternproof](https://github.com/usv240/patternproof)
- Demo video: `[ADD PUBLIC VIDEO URL]`

## Required screenshot set

1. Landing page with the one-line value proposition.
2. Private intake with body/reference quality guidance and consent.
3. Tailor workspace showing the real YouCam preview and an honest blocked/not-feasible state.
4. Customer frozen-review page showing image and agreement proofs.
5. Approved, print-ready Cut Card with immutable status.
