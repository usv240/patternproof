type ChangeRequest = {
  id: string;
  sourceVersion: number;
  reason: string;
  state: "open" | "accepted";
  createdAt: string;
  resolvedAt: string | null;
};

function date(value: string | null): string {
  if (!value) return "Now";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

export default function RevisionReplay({
  currentVersion,
  currentState,
  changes,
}: {
  currentVersion: number;
  currentState: string;
  changes: readonly ChangeRequest[];
}) {
  if (changes.length === 0 && currentVersion <= 1) return null;
  const chronological = [...changes].reverse();
  return (
    <section className="revision-replay" aria-labelledby="revision-replay-heading">
      <header>
        <div><p className="eyebrow">Expectation gap resolved over time</p><h2 id="revision-replay-heading">Revision Replay</h2></div>
        <span>V{currentVersion}</span>
      </header>
      <ol>
        {chronological.map((change) => (
          <li key={change.id}>
            <span className="revision-node">V{change.sourceVersion}</span>
            <div>
              <strong>Customer requested change</strong>
              <p>“{change.reason}”</p>
              <small>{date(change.createdAt)} · {change.state === "accepted" ? "Accepted into next revision" : "Cutting blocked"}</small>
            </div>
          </li>
        ))}
        <li className="current">
          <span className="revision-node">V{currentVersion}</span>
          <div><strong>{currentState}</strong><p>The latest product state and proof are shown above.</p></div>
        </li>
      </ol>
    </section>
  );
}
