"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { evaluateCutReadiness } from "../../lib/cut-readiness";
import CutReadinessPassport from "./CutReadinessPassport";

const journey = [
  ["01", "Private intent"],
  ["02", "YouCam evidence"],
  ["03", "Human veto"],
  ["04", "Revision replay"],
  ["05", "Consent to cut"],
  ["06", "Privacy exit"],
] as const;
const proof = "b53062e7-e436dbd9";

export default function JudgeMode() {
  const [step, setStep] = useState(0);
  const previewReady = step >= 1;
  const veto = step === 2;
  const changeRequested = step === 3;
  const approved = step >= 4;
  const erased = step >= 5;
  const requirements = useMemo(() => {
    if (step < 2) return [{ status: null }] as const;
    if (veto) return [{ status: "not_feasible" }] as const;
    return [
      { status: "with_adjustment", tailorNote: "Raise neckline 2 cm; preserve the square edge." },
      { status: "as_shown" },
      { status: "as_shown" },
    ] as const;
  }, [step, veto]);
  const readiness = evaluateCutReadiness({
    rightsConfirmed: true,
    previewReady,
    requirements,
    snapshotFrozen: step >= 3,
    customerApproved: approved,
    changeRequested,
  });
  const headings = [
    "Consent precedes computation.",
    "The API is essential, but not the final authority.",
    "The safest answer can be no.",
    "Disagreement becomes product state.",
    "Approval is a six-condition protocol.",
    "Privacy is a lifecycle, not a paragraph.",
  ];
  const explanations = [
    "PatternProof records body-processing consent and reference-image rights before accepting a private intake.",
    "In three predeclared stress conditions, the recorded YouCam call transferred the garment. Repeated inputs also produced byte-identical output in our observation.",
    "A tailor's not-feasible decision disables sharing. AI never converts visual plausibility into a construction promise.",
    "The customer can veto the frozen proof. That database-bound request blocks approval, revokes the old link when accepted, and creates V2.",
    "Rights, preview, human decisions, feasibility, frozen snapshot, and customer approval must all agree before CUT READY appears.",
    "After approval, the original body photo can be securely queued for erasure while the garment reference, preview, decisions, and proof remain.",
  ];
  return (
    <section className="judge-mode">
      <header className="judge-hero">
        <div>
          <p className="eyebrow">Judge Mode · 45-second guided proof</p>
          <h1>From inspiration to permission to cut.</h1>
          <p>This is a synthetic, no-write walkthrough of the real production workflow. Use Next to inspect the safeguards that make PatternProof more than a VTO wrapper.</p>
        </div>
        <span className="state">Step {step + 1} of {journey.length}</span>
      </header>
      <ol className="judge-rail" aria-label="Guided product journey">
        {journey.map(([number, title], index) => (
          <li className={index === step ? "active" : index < step ? "complete" : ""} key={number}>
            <button type="button" onClick={() => setStep(index)} aria-current={index === step ? "step" : undefined}><span>{number}</span>{title}</button>
          </li>
        ))}
      </ol>
      <div className="judge-stage">
        <section className="judge-visual" aria-label="Visual evidence">
          <header>
            <div><p className="eyebrow">Recorded YouCam Clothes VTO V3 result</p><h2>{erased ? "Agreement remains. Body input is gone." : "The visual becomes shared evidence."}</h2></div>
            {previewReady && <code title="Full SHA-256 is documented in D1-RESULTS.md">SHA {proof}</code>}
          </header>
          <div className="judge-image-pair">
            <figure><figcaption>Garment reference</figcaption><Image src="/demo/reference-olive.jpg" alt="Synthetic olive wrap-dress garment reference" width={600} height={800} priority /></figure>
            <figure className="judge-output">
              <figcaption>{erased ? "Retained visual-intent proof" : "YouCam visual-intent preview"}</figcaption>
              {previewReady ? <div className="judge-output-frame"><Image src="/demo/render-olive.jpg" alt="Recorded synthetic YouCam visual-intent preview" width={600} height={800} priority />{step >= 2 && <span className="judge-pin">1</span>}</div> : <div className="judge-private-input"><strong>Private body input</strong><span>Rights and processing consent recorded before upload.</span></div>}
            </figure>
          </div>
          <p className="comparison-disclaimer">Visual intent only — not a fit, construction, measurement, fabric, or final-appearance guarantee.</p>
        </section>
        <aside className="judge-explainer" aria-live="polite">
          <p className="eyebrow">{journey[step][1]}</p><h2>{headings[step]}</h2><p>{explanations[step]}</p>
          {step === 2 && <div className="judge-veto"><strong>Cutting blocked</strong><span>High square neckline: not feasible in V1.</span></div>}
          {step === 3 && <div className="judge-replay"><span>V1</span><strong>Customer: “Raise the neckline.”</strong><i aria-hidden="true">→</i><span>V2</span><strong>Tailor adjustment recorded</strong></div>}
          {step === 1 && <dl className="judge-proof-facts"><div><dt>Stress set</dt><dd>3/3 observed transfers</dd></div><div><dt>Repeat</dt><dd>Byte-identical SHA-256</dd></div><div><dt>Cost</dt><dd>2 units per admitted attempt</dd></div></dl>}
          {step >= 2 && <CutReadinessPassport readiness={readiness} proof={step >= 3 ? "41b874-aeff97" : undefined} compact />}
          {step === 5 && <div className="judge-erasure"><strong>Customer photo hidden</strong><span>Secure erasure is queued; the approved Cut Card remains auditable.</span></div>}
          <div className="judge-controls">
            <button type="button" className="button secondary" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
            {step < journey.length - 1 ? <button type="button" className="button primary" onClick={() => setStep((value) => Math.min(journey.length - 1, value + 1))}>Next: {journey[step + 1][1]}</button> : <Link className="button primary" href="/s/demo-olive">Inspect immutable public record</Link>}
          </div>
          <div className="judge-links"><Link href="/proof">Open evidence ledger</Link><Link href="/demo">Try feasibility decisions</Link></div>
        </aside>
      </div>
      <footer className="judge-research-strip"><strong>Why this workflow exists</strong><span>108 de-identified 1–2-star tailoring complaints · 41 businesses · 3 Indian cities</span><span>32/108 concerned expectation mismatch or delay — a bounded negative-sample finding, not prevalence.</span><Link href="/proof">Audit the evidence →</Link></footer>
    </section>
  );
}