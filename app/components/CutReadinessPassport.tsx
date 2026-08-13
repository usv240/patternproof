import type { CutReadiness } from "../../lib/cut-readiness";

export default function CutReadinessPassport({
  readiness,
  proof,
  compact = false,
}: {
  readiness: CutReadiness;
  proof?: string | null;
  compact?: boolean;
}) {
  const cutReady = readiness.state === "cut_ready";
  return (
    <section
      className={`readiness-passport ${cutReady ? "cut-ready" : "not-ready"}${compact ? " compact" : ""}`}
      aria-labelledby="cut-readiness-heading"
    >
      <header>
        <div>
          <p className="eyebrow">Consent-to-Cut Protocol</p>
          <h2 id="cut-readiness-heading">Cut Readiness</h2>
        </div>
        <span aria-label={`${readiness.completed} of ${readiness.total} conditions complete`}>
          {readiness.completed}/{readiness.total}
        </span>
      </header>
      <ol>
        {readiness.checks.map((check) => (
          <li className={check.complete ? "complete" : "incomplete"} key={check.id}>
            <span aria-hidden="true">{check.complete ? "[x]" : "[ ]"}</span>
            {check.label}
          </li>
        ))}
      </ol>
      <footer>
        <strong>{cutReady ? "CUT READY" : readiness.state === "change_requested" ? "CHANGE REQUESTED - CUTTING BLOCKED" : readiness.state === "awaiting_customer" ? "AWAITING CUSTOMER" : "NOT READY TO CUT"}</strong>
        {proof && <code>Proof {proof}</code>}
      </footer>
    </section>
  );
}
