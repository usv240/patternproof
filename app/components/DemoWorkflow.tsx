"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

type Status = "as_shown" | "with_adjustment" | "not_feasible";
type Requirement = { id: number; label: string; status?: Status; note?: string };

const labels: Record<Status, string> = {
  as_shown: "Can make as shown",
  with_adjustment: "Can make with adjustment",
  not_feasible: "Not feasible",
};

export default function DemoWorkflow() {
  const [requirements, setRequirements] = useState<Requirement[]>([
    { id: 1, label: "High square neckline" },
    { id: 2, label: "Three-quarter sleeves" },
    { id: 3, label: "Relaxed waist" },
  ]);
  const [draft, setDraft] = useState("");
  const [locked, setLocked] = useState(false);

  const hasNotFeasible = requirements.some((item) => item.status === "not_feasible");
  const hasMissingDecision = requirements.some((item) => !item.status);
  const hasMissingAdjustmentNote = requirements.some(
    (item) => item.status === "with_adjustment" && !item.note?.trim(),
  );
  const complete =
    requirements.length > 0 &&
    !hasNotFeasible &&
    !hasMissingDecision &&
    !hasMissingAdjustmentNote;
  const summary = useMemo(
    () => requirements.filter((item) => item.status === "with_adjustment"),
    [requirements],
  );

  function addRequirement() {
    const label = draft.trim();
    if (!label || locked) return;
    setRequirements((items) => [...items, { id: Date.now(), label }]);
    setDraft("");
  }

  function setStatus(id: number, status: Status) {
    if (locked) return;
    setRequirements((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              note: status === "with_adjustment" ? item.note : undefined,
            }
          : item,
      ),
    );
  }

  function setNote(id: number, note: string) {
    if (locked) return;
    setRequirements((items) =>
      items.map((item) => (item.id === id ? { ...item, note } : item)),
    );
  }

  const reviewMessage = complete
    ? summary.length
      ? `${summary.length} item${summary.length > 1 ? "s have" : " has"} a documented, customer-visible adjustment.`
      : "Every requirement can be made as shown."
    : hasNotFeasible
      ? "Approval is blocked because at least one requirement is not feasible."
      : hasMissingAdjustmentNote
        ? "Explain every adjustment before customer approval can be enabled."
        : "Mark every requirement before customer approval can be enabled.";

  return (
    <section className="demo-workflow">
      <div className="demo-header">
        <div>
          <p className="eyebrow">Interactive example · visual intent workflow</p>
          <h1>{locked ? "The Cut Card is locked." : "Agree before the cut."}</h1>
          <p>
            {locked
              ? "This version cannot change. Any edit becomes a new revision."
              : "First name what matters. Then let the tailor confirm what is constructible."}
          </p>
        </div>
        <span className={locked ? "state locked" : "state"}>
          {locked ? "Approved v1" : "Draft v1"}
        </span>
      </div>

      <div className="demo-grid">
        <aside className="preview-tile">
          <Image
            className="demo-preview-image"
            src="/demo/render-olive.jpg"
            alt="Verified synthetic visual-intent render of an olive wrap dress"
            width={600}
            height={800}
            priority
          />
          <strong>Verified olive wrap dress</strong>
          <span>Rights-cleared synthetic visual-intent render</span>
          <small>Not a fit, construction, or fabric-drape guarantee.</small>
        </aside>

        <div className="requirements-panel">
          <h2>Customer non-negotiables</h2>
          <p className="helper">Each item needs a human feasibility decision.</p>

          <div className="scenario-callout">
            <strong>Conflict to resolve</strong>
            <p>
              The preview is wrap-style, but the customer asked for a high square neckline.
              Decide what the tailor can actually promise before approval.
            </p>
          </div>

          {requirements.map((item) => (
            <article className="workflow-item" key={item.id}>
              <strong>{item.label}</strong>
              <div className="status-buttons">
                {(Object.keys(labels) as Status[]).map((status) => (
                  <button
                    type="button"
                    disabled={locked}
                    aria-pressed={item.status === status}
                    className={item.status === status ? status : ""}
                    onClick={() => setStatus(item.id, status)}
                    key={status}
                  >
                    {labels[status]}
                  </button>
                ))}
              </div>

              {item.status === "with_adjustment" && (
                <label className="adjustment-note">
                  <span>
                    Describe the customer-visible adjustment <em>Required</em>
                  </span>
                  <textarea
                    disabled={locked}
                    value={item.note ?? ""}
                    onChange={(event) => setNote(item.id, event.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Example: neckline will be raised 2 cm for support."
                  />
                </label>
              )}

              {item.status === "not_feasible" && (
                <p className="feasibility-blocker" role="alert">
                  This requirement blocks approval. Revise the design or start a new revision
                  before asking the customer to approve.
                </p>
              )}
            </article>
          ))}

          {!locked && (
            <div className="add-row">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && addRequirement()}
                maxLength={120}
                placeholder="Add a requirement, e.g. ankle length"
              />
              <button type="button" onClick={addRequirement}>Add</button>
            </div>
          )}

          <div className="review-note" aria-live="polite">
            <strong>Tailor feasibility review</strong>
            <p>{reviewMessage}</p>
          </div>

          {!locked && (
            <button
              type="button"
              className="button primary lock-button"
              disabled={!complete}
              onClick={() => setLocked(true)}
            >
              {complete
                ? "Customer approves and locks Cut Card"
                : "Resolve feasibility review to approve"}
            </button>
          )}

          {locked && (
            <div className="locked-message">
              <strong>Customer approval recorded</strong>
              <p>Approved brief is immutable. Start a new revision to change any detail.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
