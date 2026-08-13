import type { ExpectationChecksum as ChecksumState } from "../../lib/expectation-checksum";

export default function ExpectationChecksum({
  checksum,
  proof,
  compact = false,
}: {
  checksum: ChecksumState;
  proof?: string | null;
  compact?: boolean;
}) {
  return (
    <section
      className={`expectation-checksum ${checksum.released ? "released" : "blocked"}${compact ? " compact" : ""}`}
      aria-labelledby="expectation-checksum-heading"
    >
      <header>
        <div>
          <p className="eyebrow">Three-key production interlock</p>
          <h2 id="expectation-checksum-heading">Expectation Checksum</h2>
        </div>
        <span>{checksum.completed}/{checksum.total}</span>
      </header>
      <p className="checksum-explainer">
        AI evidence, craft judgment, and customer consent must point to the same frozen Cut Card.
      </p>
      <ol>
        {checksum.keys.map((key, index) => (
          <li className={key.complete ? "complete" : "incomplete"} key={key.id}>
            <span className="checksum-key" aria-hidden="true">{index + 1}</span>
            <div><small>{key.holder}</small><strong>{key.label}</strong></div>
            <b aria-label={key.complete ? "confirmed" : "waiting"}>{key.complete ? "KEYED" : "WAIT"}</b>
          </li>
        ))}
      </ol>
      <footer>
        <div><span aria-hidden="true">{checksum.released ? "✓" : "!"}</span><strong>{checksum.released ? "CUT RELEASED" : "DO NOT CUT"}</strong></div>
        {proof && <code>SHA-256 {proof}</code>}
      </footer>
    </section>
  );
}
