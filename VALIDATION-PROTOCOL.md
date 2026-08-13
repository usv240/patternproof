# PatternProof field-validation protocol

Status: **pre-results protocol**. Do not convert any target below into a claim until the named evidence exists.

## Why this exists

The formative review study in [RESEARCH.md](RESEARCH.md) supports problem discovery only. This protocol separates two questions: can independent users complete and understand the workflow, and do real orders surface changes earlier than the studio's existing process? The first can be tested before submission with synthetic fixtures. The second requires a prospective pilot and cannot be manufactured from a demo.

## A. Independent workflow test

Recruit at least three tailoring professionals who did not build PatternProof. Record role and years of experience only in aggregate; do not collect names in the repository. Use the rights-cleared synthetic fixtures in [ASSETS.md](ASSETS.md), the deployed product, and a fresh browser profile.

Give each participant the same scenario without explaining the interface:

> A customer wants the olive garment shown in the reference. The square neckline is essential. Three-quarter sleeves are acceptable as shown. The waist may need a visible adjustment. Prepare an approval-ready Cut Card, demonstrate what happens when one request is not feasible, then return to an approvable state.

Observe these tasks in order:

1. Start a private brief and correctly interpret the consent prompts.
2. Identify why the deliberately poor body image is rejected.
3. Generate or inspect the recorded YouCam Clothes VTO V3 preview.
4. Mark one requirement as shown, one with a documented adjustment, and one not feasible.
5. Explain why review is blocked; resolve the blocker without facilitator action.
6. Create the private review, open it in a separate customer context, and approve it.
7. Explain what the preview does **not** guarantee and what becomes immutable.

Predeclared usability targets:

- at least 80% of all tasks completed without facilitator action;
- every participant identifies the not-feasible approval block;
- every participant states that the AI image is visual intent, not a fit/drape/construction guarantee;
- no participant exposes a secret, raw customer token, or personal image during the session;
- median end-to-end task time at or below 12 minutes, excluding YouCam processing time.

Report the participant count, recruitment method, completed-task numerator and denominator, median time, critical errors, and every target miss. Paraphrase short anonymous comments only with consent. Do not select only favorable comments.

## B. Prospective order pilot

Use consecutive eligible made-to-order cases rather than hand-picking successes. For each studio, observe its current process first (`baseline`) and PatternProof second (`patternproof`). Keep names, contact details, images, garment descriptions, dates, and free text out of the metrics file.

| Field | Definition |
| --- | --- |
| `recordId`, `studioCode` | Random study codes only; 3–40 uppercase letters, digits, `_`, or `-`. |
| `phase` | `baseline` or `patternproof`. |
| `completed` | The parties reached a recorded pre-cut agreement. |
| `clarificationCycles` | Distinct back-and-forth clarification rounds before agreement or abandonment. |
| `agreementMinutes` | Active minutes to agreement; `null` when incomplete. |
| `preCutChange` | A requested design change was surfaced before cutting. |
| `postApprovalChange` | A requested design change arose after recorded agreement. |
| `expectationRelatedRework` | Later rework was attributed to a difference between requested and understood visual/design intent. |
| confidence fields | Optional 1–5 answer to: “How confident are you that both parties agree on the garment to be made?” |

Run the deterministic reporter with a local, untracked JSON array:

```powershell
npm run pilot:report -- pilot-data.local.json
```

The parser rejects unknown fields to stop names or contact details drifting into the study file. The report is descriptive: it gives denominators, phase summaries, and arithmetic differences but never a p-value, causal label, or “prevented remake” count.

## Claim ladder

- **Before an independent session:** say the workflow is implemented and outcomes are hypotheses.
- **After the workflow test:** report exact task numerators, denominators, and comprehension results; call this usability evidence, not impact.
- **After a prospective pilot:** report every eligible record, phase denominators, descriptive results, and adverse outcomes. Do not claim causality without an appropriate controlled design and adequate sample.
- **Never:** claim PatternProof predicts fit, construction, fabric behavior, or final appearance.
