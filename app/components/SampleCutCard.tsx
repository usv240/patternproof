"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { evaluateCutReadiness } from "../../lib/cut-readiness";
import { evaluateExpectationChecksum } from "../../lib/expectation-checksum";
import CutReadinessPassport from "./CutReadinessPassport";
import GuestWorkspaceButton from "./GuestWorkspaceButton";
import ExpectationChecksum from "./ExpectationChecksum";

const journey = [
  ["01", "Private intent"],
  ["02", "YouCam evidence"],
  ["03", "Human veto"],
  ["04", "Revision replay"],
  ["05", "Consent to cut"],
  ["06", "Privacy exit"],
] as const;
const proof = "b53062e7-e436dbd9";

export default function SampleCutCard() {
  const [step, setStep] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const selectStep = (nextStep: number) => {
    setStep(nextStep);
    window.requestAnimationFrame(() => {
      stageRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };
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
  const expectationChecksum = evaluateExpectationChecksum({
    visualEvidence: previewReady,
    craftDecision: step >= 3,
    customerConsent: approved,
  });
  const headings = [
    "Consent precedes computation.",
    "The API is essential, but not the final authority.",
    "The safest answer can be no.",
    "Disagreement becomes product state.",
    "Three independent keys release the cut.",
    "Privacy is a lifecycle, not a paragraph.",
  ];
  const explanations = [
    "PatternProof records body-processing consent and reference-image rights before accepting a private intake.",
    "In three predeclared stress conditions, the recorded YouCam call transferred the garment. Repeated inputs also produced byte-identical output in our observation.",
    "A tailor's not-feasible decision disables sharing. AI never converts visual plausibility into a construction promise.",
    "The customer can veto the frozen proof. That database-bound request blocks approval, revokes the old link when accepted, and creates V2.",
    "YouCam evidence, the tailor's construction promise, and customer consent are bound to one SHA-256 Expectation Checksum. No green, no cut.",
    "After approval, the original body photo can be securely queued for erasure while the garment reference, preview, decisions, and proof remain.",
  ];
  return (
    <section className="sample-cut-card">
      <header className="sample-header">
        <div>
          <p className="eyebrow">Sample Cut Card</p>
          <h1>Olive wrap dress</h1>
          <p>Rights-cleared example &middot; Recorded YouCam result &middot; Nothing uploaded or saved</p>
        </div>
        <div className="sample-header-actions">
          <span className="state">Step {step + 1} of {journey.length}</span>

        </div>
      </header>
      <aside className="private-creation-banner" aria-label="Create a private Cut Card">
        <div>
          <strong>Ready to create your own Cut Card?</strong>
          <span>Upload your photos in an isolated private workspace. No account needed.</span>
        </div>
        <GuestWorkspaceButton>Create with my photos</GuestWorkspaceButton>
      </aside>
      <ol className="judge-rail" aria-label="Sample Cut Card journey">
        {journey.map(([number, title], index) => (
          <li className={index === step ? "active" : index < step ? "complete" : ""} key={number}>
            <button type="button" onClick={() => selectStep(index)} aria-current={index === step ? "step" : undefined}><span>{number}</span>{title}</button>
          </li>
        ))}
      </ol>
      <div className="judge-mobile-controls" aria-label="Sample step controls">
        <button type="button" className="button secondary" disabled={step === 0} onClick={() => selectStep(Math.max(0, step - 1))}>Back</button>
        {step < journey.length - 1 ? <button type="button" className="button primary" onClick={() => selectStep(Math.min(journey.length - 1, step + 1))}>Next: {journey[step + 1][1]}</button> : <Link className="button primary" href="/s/demo-olive">Inspect immutable public record</Link>}
      </div>
      <div className="judge-stage" ref={stageRef} tabIndex={-1}>
        <section className="judge-visual" aria-label="Visual evidence">
          <header>
            <div><p className="eyebrow">{previewReady ? "Recorded YouCam Clothes VTO V3 result" : "Private intake prepared"}</p><h2>{erased ? "Agreement remains. Body input is gone." : previewReady ? "The visual becomes shared evidence." : "Consent comes before computation."}</h2></div>
            {previewReady && <code title="Full SHA-256 is documented in D1-RESULTS.md">SHA {proof}</code>}
          </header>
          <div className="judge-image-pair">
            <figure><figcaption>Garment reference</figcaption><Image src="/demo/reference-olive.jpg" alt="Synthetic olive wrap-dress garment reference" width={600} height={800} priority /></figure>
            <figure className="judge-output">
              <figcaption>{erased ? "Retained visual-intent proof" : "YouCam visual-intent preview"}</figcaption>
              {previewReady ? <div className="judge-output-frame"><Image src="/demo/render-olive.jpg" alt="Recorded synthetic YouCam visual-intent preview" width={600} height={800} priority />{step >= 2 && <span className="judge-pin">1</span>}</div> : <div className="judge-private-input"><strong>Private body input</strong><span>Rights and processing consent recorded before upload.</span></div>}
            </figure>
          </div>
          <p className="comparison-disclaimer">Visual intent only &mdash; not a fit, construction, measurement, fabric, or final-appearance guarantee.</p>
        </section>
        <aside className="judge-explainer" aria-live="polite">
          <p className="eyebrow">{journey[step][1]}</p><h2>{headings[step]}</h2><p>{explanations[step]}</p>
          {step === 2 && <div className="judge-veto"><strong>Cutting blocked</strong><span>High square neckline: not feasible in V1.</span></div>}
          {step === 3 && <div className="judge-replay"><span>V1</span><strong>Customer: &ldquo;Raise the neckline.&rdquo;</strong><i aria-hidden="true">&rarr;</i><span>V2</span><strong>Tailor adjustment recorded</strong></div>}
          {step === 1 && <dl className="judge-proof-facts"><div><dt>Stress set</dt><dd>3/3 observed transfers</dd></div><div><dt>Repeat</dt><dd>Byte-identical SHA-256</dd></div><div><dt>Cost</dt><dd>2 units per admitted attempt</dd></div></dl>}
          {step >= 1 && step <= 4 && <ExpectationChecksum checksum={expectationChecksum} proof={step >= 3 ? "41b874-aeff97" : undefined} compact />}
          {step >= 2 && step <= 4 && <CutReadinessPassport readiness={readiness} proof={step >= 3 ? "41b874-aeff97" : undefined} compact />}
          {step === 5 && <div className="judge-erasure"><strong>Customer photo hidden</strong><span>Secure erasure is queued; the approved Cut Card remains auditable.</span></div>}
          <div className="judge-controls">
            <button type="button" className="button secondary" disabled={step === 0} onClick={() => selectStep(Math.max(0, step - 1))}>Back</button>
            {step < journey.length - 1 ? <button type="button" className="button primary" onClick={() => selectStep(Math.min(journey.length - 1, step + 1))}>Next: {journey[step + 1][1]}</button> : <Link className="button primary" href="/s/demo-olive">Inspect immutable public record</Link>}
          </div>
          <div className="judge-links"><Link href="/proof">Open evidence ledger</Link></div>
        </aside>
      </div>
      <footer className="judge-research-strip"><strong>Why this workflow exists</strong><span>108 de-identified 1&ndash;2-star tailoring complaints &middot; 41 businesses &middot; 3 Indian cities</span><span>24/108 were coded expectation mismatch; 8 more alleged fabric damage &mdash; a bounded negative-sample finding, not prevalence.</span><Link href="/proof">Audit the evidence &rarr;</Link></footer>
    </section>
  );
}
