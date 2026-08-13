"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { evaluateCutReadiness } from "../../lib/cut-readiness";
import { isPublicDemoToken } from "../../lib/public-demo-token";
import { shortSnapshotProof } from "../../lib/review-snapshot";
import CutReadinessPassport from "./CutReadinessPassport";
import ShareActions from "./ShareActions";

type Feasibility = {
  status: "as_shown" | "with_adjustment" | "not_feasible";
  tailor_note: string | null;
};

type Requirement = {
  id: string;
  label: string;
  note: string | null;
  feasibility: Feasibility | Feasibility[] | null;
};

type Annotation = {
  id: string;
  requirement_id: string | null;
  author_role: string;
  anchor_x: number;
  anchor_y: number;
  body: string;
  created_at: string;
};

type Consent = {
  scope: string;
  rights_confirmed: true;
  body_processing_confirmed: true;
  policy_version: string;
  granted_at: string;
};

type SharedPayload = {
  mode?: "private_review" | "public_demo";
  immutable?: boolean;
  brief: {
    id: string;
    shop_name: string;
    customer_label: string;
    status: string;
    token_expires_at: string;
    approved_revision_id: string | null;
    snapshot_sha256: string;
  };
  revision: null | {
    id: string;
    version: number;
    category: string;
    created_at: string;
    reference_sha256: string;
    render_sha256: string;
    locked: boolean;
    referenceUrl: string | null;
    renderUrl: string | null;
    requirements: readonly Requirement[];
    annotations: readonly Annotation[];
  };
  consent: Consent;
  changeRequest?: null | {
    id: string;
    revisionId: string;
    sourceVersion: number;
    snapshotSha256: string;
    reason: string;
    state: "open";
    createdAt: string;
  };
};

const statusText: Record<Feasibility["status"], string> = {
  as_shown: "Can be made as shown",
  with_adjustment: "Can be made with adjustment",
  not_feasible: "Not feasible in this revision",
};

function feasibilityOf(requirement: Requirement): Feasibility | undefined {
  if (Array.isArray(requirement.feasibility)) return requirement.feasibility[0];
  return requirement.feasibility ?? undefined;
}

function humanize(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, " ");
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Not recorded";
}

function formatDate(value: string, includeTime = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(parsed);
}

function shortImageProof(digest: string): string {
  return digest.slice(0, 8) + "-" + digest.slice(8, 16);
}

function linkedRequirement(annotation: Annotation, requirements: readonly Requirement[]): Requirement | undefined {
  return requirements.find((requirement) => requirement.id === annotation.requirement_id);
}

function annotationStatus(annotation: Annotation, requirements: readonly Requirement[]): string {
  const requirement = linkedRequirement(annotation, requirements);
  return requirement ? feasibilityOf(requirement)?.status.replaceAll("_", "-") ?? "unlinked" : "unlinked";
}

function annotationLocation(annotation: Annotation): string {
  return (
    Math.round(annotation.anchor_x * 100) +
    "% from left, " +
    Math.round(annotation.anchor_y * 100) +
    "% from top"
  );
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Keep the customer-facing fallback generic.
  }
  return fallback;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMilliseconds = 20_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function CustomerReview({
  token,
  initialPayload,
}: {
  token: string;
  initialPayload?: SharedPayload;
}) {
  const requestedPublicDemo = isPublicDemoToken(token);
  const [payload, setPayload] = useState<SharedPayload | null>(initialPayload ?? null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(!initialPayload);
  const [confirm, setConfirm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [activePinId, setActivePinId] = useState<string>();
  const [currentShareUrl, setCurrentShareUrl] = useState<string>();
  const [changeReason, setChangeReason] = useState("");
  const [requestingChange, setRequestingChange] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetchWithTimeout("/api/share/" + encodeURIComponent(token), {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setError(
          await readError(
            response,
            requestedPublicDemo
              ? "We could not load the public example."
              : "We could not load this private Cut Card.",
          ),
        );
        setPayload(null);
      } else {
        setPayload((await response.json()) as SharedPayload);
      }
    } catch {
      setError(
        requestedPublicDemo
          ? "We could not reach the public example. Check your connection and try again."
          : "We could not reach the private review. Check your connection and try again.",
      );
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [requestedPublicDemo, token]);

  useEffect(() => {
    if (!initialPayload) void load();
  }, [initialPayload, load]);

  useEffect(() => {
    setCurrentShareUrl(window.location.href);
  }, []);

  const ready = useMemo(() => {
    const revision = payload?.revision;
    if (!revision?.renderUrl || revision.requirements.length === 0) return false;
    return revision.requirements.every((requirement) => {
      const feasibility = feasibilityOf(requirement);
      if (!feasibility || feasibility.status === "not_feasible") return false;
      return feasibility.status !== "with_adjustment" || Boolean(feasibility.tailor_note?.trim());
    });
  }, [payload]);

  const isPublicDemo = payload?.mode === "public_demo";
  const approved =
    !isPublicDemo && Boolean(payload?.revision?.locked || payload?.brief.status === "approved");

  const readiness = evaluateCutReadiness({
    rightsConfirmed: payload?.consent.rights_confirmed === true &&
      payload?.consent.body_processing_confirmed === true,
    previewReady: Boolean(payload?.revision?.renderUrl),
    requirements: (payload?.revision?.requirements ?? []).map((requirement) => ({
      status: feasibilityOf(requirement)?.status,
      tailorNote: feasibilityOf(requirement)?.tailor_note,
    })),
    snapshotFrozen: Boolean(payload?.brief.snapshot_sha256),
    customerApproved: approved,
    changeRequested: Boolean(payload?.changeRequest),
  });
  async function requestChange() {
    const revision = payload?.revision;
    const reason = changeReason.trim();
    if (isPublicDemo || approved || !payload || !revision || payload.changeRequest || requestingChange) return;
    if (reason.length < 5 || reason.length > 1_000) {
      setError("Describe the requested change in 5 to 1000 characters.");
      return;
    }
    setRequestingChange(true);
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        "/api/share/" + encodeURIComponent(token) + "/request-change",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revisionId: revision.id,
            snapshotSha256: payload.brief.snapshot_sha256,
            reason,
          }),
        },
      );
      if (!response.ok) {
        setError(await readError(response, "We could not record this change request."));
        return;
      }
      const result = (await response.json()) as {
        requested?: unknown;
        request?: SharedPayload["changeRequest"];
      };
      if (result.requested !== true || !result.request) {
        setError("We could not confirm the change request. Retrying is safe.");
        return;
      }
      setPayload((current) => current ? { ...current, changeRequest: result.request } : current);
      setConfirm(false);
      setChangeReason("");
    } catch {
      setError("We could not confirm the change request. Reconnect and retry; it is safe to repeat.");
    } finally {
      setRequestingChange(false);
    }
  }
  async function approve() {
    const revision = payload?.revision;
    if (isPublicDemo || !payload || !revision || !ready || !confirm || approving || payload.changeRequest) return;

    // This full server-provided digest is the approval precondition. The shortened
    // fingerprints shown in the interface are never sent in its place.
    const snapshotSha256 = payload.brief.snapshot_sha256;

    setApproving(true);
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        "/api/share/" + encodeURIComponent(token) + "/approve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revisionId: revision.id,
            snapshotSha256,
          }),
        },
      );
      if (!response.ok) {
        setError(await readError(response, "We could not approve this Cut Card."));
        return;
      }

      const result = (await response.json()) as {
        approved?: unknown;
        revisionId?: unknown;
        snapshotSha256?: unknown;
      };
      if (
        result.approved !== true ||
        result.revisionId !== revision.id ||
        result.snapshotSha256 !== snapshotSha256
      ) {
        setError("We could not confirm the approval receipt. Retrying this exact approval is safe.");
        return;
      }

      // The approval response is the commit receipt. Lock locally instead of making
      // the successful state depend on a second network request.
      setPayload((current) => {
        if (
          !current?.revision ||
          current.revision.id !== revision.id ||
          current.brief.snapshot_sha256 !== snapshotSha256
        ) {
          return current;
        }
        return {
          ...current,
          brief: { ...current.brief, status: "approved" },
          revision: { ...current.revision, locked: true },
        };
      });
      setConfirm(false);
    } catch {
      setError(
        "We could not confirm whether approval completed. Reconnect and retry; the operation is safe to repeat.",
      );
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <section className="shared-loading" aria-live="polite">
        {requestedPublicDemo ? "Opening public demo..." : "Opening private review..."}
      </section>
    );
  }

  if (error && !payload) {
    return (
      <section className="shared-error" role="alert">
        <p className="eyebrow">Private link unavailable</p>
        <h1>This Cut Card cannot be opened.</h1>
        <p>{error}</p>
        <button type="button" className="button secondary" onClick={() => void load()}>
          Try this private link again
        </button>
        <small>
          If it remains unavailable, ask the tailoring studio for a fresh link. PatternProof does
          not reveal whether an expired brief exists.
        </small>
      </section>
    );
  }

  const revision = payload?.revision;
  if (!payload || !revision) {
    return (
      <section className="shared-error">
        <p className="eyebrow">Private Cut Card</p>
        <h1>The studio is still preparing this revision.</h1>
        <p>Return after the tailor has added the visual preview and feasibility review.</p>
      </section>
    );
  }

  const snapshotProof = shortSnapshotProof(payload.brief.snapshot_sha256);

  return (
    <section className="customer-review">
      <header className="customer-review-header">
        <div>
          <p className="eyebrow">
            {isPublicDemo ? "Public demo - read-only" : "Private review"} -{" "}
            {payload.brief.shop_name}
          </p>
          <h1>{isPublicDemo ? "Explore a frozen Cut Card." : "Agree before the cut."}</h1>
          <p className="review-byline">
            <strong>{payload.brief.customer_label}</strong>
            <span aria-hidden="true"> / </span>
            {humanize(revision.category)} - revision {revision.version} -{" "}
            {formatDate(revision.created_at)}
          </p>
          <div
            className="snapshot-proof"
            aria-label={"Frozen agreement proof " + payload.brief.snapshot_sha256}
          >
            <span>{isPublicDemo ? "Deterministic demo proof" : "Frozen agreement proof"}</span>
            <code>{snapshotProof}</code>
          </div>
        </div>
        <span
          className={approved || isPublicDemo ? "state locked" : "state"}
          role="status"
          aria-live="polite"
        >
          {isPublicDemo
            ? "Public demo - immutable"
            : approved
              ? "Approved and locked"
              : "Awaiting your approval"}
        </span>
      </header>

      <div className="customer-review-grid">
        <div className="review-visuals">
          <figure>
            <figcaption>Garment reference</figcaption>
            {revision.referenceUrl ? (
              <Image
                src={revision.referenceUrl}
                alt="Garment reference supplied for this brief"
                width={600}
                height={800}
                unoptimized
              />
            ) : (
              <div className="image-missing">Reference unavailable</div>
            )}
            <small className="image-proof">
              Reference proof{" "}
              <code title={revision.reference_sha256}>
                {shortImageProof(revision.reference_sha256)}
              </code>
            </small>
          </figure>

          <figure className="primary-preview">
            <figcaption>Visual-intent preview</figcaption>
            {revision.renderUrl ? (
              <div className="annotation-canvas agreement-map" aria-label="Requirement-linked agreement map">
                <Image
                  src={revision.renderUrl}
                  alt="AI-generated visual-intent preview with requirement-linked agreement pins"
                  width={600}
                  height={800}
                  unoptimized
                />
                {revision.annotations.map((annotation, index) => (
                  <button
                    type="button"
                    className={`design-pin interactive ${annotationStatus(annotation, revision.requirements)}${activePinId === annotation.id ? " active" : ""}`}
                    key={annotation.id}
                    style={{ left: `${annotation.anchor_x * 100}%`, top: `${annotation.anchor_y * 100}%` }}
                    title={`${linkedRequirement(annotation, revision.requirements)?.label ?? "Pinned detail"}: ${annotation.body}`}
                    aria-label={`Show pinned decision ${index + 1}`}
                    aria-pressed={activePinId === annotation.id}
                    onClick={() => setActivePinId(activePinId === annotation.id ? undefined : annotation.id)}
                  >
                    {index + 1}
                  </button>
                ))}
                {revision.annotations.map((annotation) => {
                  if (activePinId !== annotation.id) return null;
                  const requirement = linkedRequirement(annotation, revision.requirements);
                  const feasibility = requirement ? feasibilityOf(requirement) : undefined;
                  return (
                    <aside className="agreement-popover" key={`detail-${annotation.id}`} role="status">
                      <span>{feasibility ? statusText[feasibility.status] : "Pinned design detail"}</span>
                      <strong>{requirement?.label ?? "Unlinked detail"}</strong>
                      <p>{annotation.body}</p>
                      {feasibility?.tailor_note && <small>Tailor note: {feasibility.tailor_note}</small>}
                    </aside>
                  );
                })}
              </div>
            ) : (
              <div className="image-missing">Preview still rendering</div>
            )}
            <small className="image-proof">
              Preview proof{" "}
              <code title={revision.render_sha256}>{shortImageProof(revision.render_sha256)}</code>
            </small>
          </figure>

          <p className="preview-disclaimer">
            This AI preview communicates visual intent. It is not a guarantee of exact fit,
            measurements, construction, fabric behavior, or final appearance.
          </p>

          <section className="review-annotations" aria-labelledby="annotation-heading">
            <div className="review-section-heading">
              <div><p className="eyebrow">Agreement map</p><h2 id="annotation-heading">Pinned decisions</h2></div>
              <span>{revision.annotations.length}</span>
            </div>
            {revision.annotations.length === 0 ? (
              <p className="empty-review-notes">
                No image annotations are attached to this revision.
              </p>
            ) : (
              <ol>
                {revision.annotations.map((annotation) => (
                  <li key={annotation.id}>
                    <p><strong>{linkedRequirement(annotation, revision.requirements)?.label ?? "Unlinked detail"}</strong><br />{annotation.body}</p>
                    <small>
                      {humanize(annotation.author_role)} - {annotationLocation(annotation)} -{" "}
                      {formatDate(annotation.created_at, true)}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="customer-requirements">
          <CutReadinessPassport readiness={readiness} proof={snapshotProof} compact />
          <section className="review-consent" aria-labelledby="consent-heading">
            <p className="eyebrow">
              {isPublicDemo ? "Synthetic public sample" : "Included in this frozen record"}
            </p>
            <h2 id="consent-heading">
              {isPublicDemo ? "Synthetic asset rights" : "Consent and image rights"}
            </h2>
            <dl>
              <div>
                <dt>Scope</dt>
                <dd>{payload.consent.scope}</dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>{payload.consent.policy_version}</dd>
              </div>
              <div>
                <dt>Granted</dt>
                <dd>{formatDate(payload.consent.granted_at, true)}</dd>
              </div>
            </dl>
            <ul aria-label="Consent confirmations">
              <li>{isPublicDemo ? "Synthetic body image" : "Body-photo processing confirmed"}</li>
              <li>
                {isPublicDemo ? "Synthetic reference image" : "Reference-image rights confirmed"}
              </li>
            </ul>
          </section>

          <div className="review-section-heading requirements-heading">
            <div>
              <p className="eyebrow">Construction agreement</p>
              <h2>Your non-negotiables</h2>
            </div>
            <span>{revision.requirements.length}</span>
          </div>
          <p className="helper">Read the tailor decision and every adjustment before approving.</p>

          {revision.requirements.map((requirement) => {
            const feasibility = feasibilityOf(requirement);
            return (
              <article className="customer-requirement" key={requirement.id}>
                <strong>{requirement.label}</strong>
                {requirement.note && <p>{requirement.note}</p>}
                {feasibility ? (
                  <span className={"feasibility-pill " + feasibility.status}>
                    {statusText[feasibility.status]}
                  </span>
                ) : (
                  <span className="feasibility-pill pending">Tailor decision pending</span>
                )}
                {feasibility?.tailor_note && (
                  <div className="tailor-adjustment">
                    <b>Tailor note</b>
                    <p>{feasibility.tailor_note}</p>
                  </div>
                )}
              </article>
            );
          })}

          {isPublicDemo ? (
            <div className="locked-message public-demo-lock" role="status">
              <strong>Read-only public demonstration</strong>
              <p>
                This deterministic sample contains no customer record. It cannot be approved or
                changed, and no action on this page writes to PatternProof or Supabase.
              </p>
            </div>
          ) : approved ? (
            <>
              <div className="locked-message" role="status">
                <strong>Approved Cut Card revision {revision.version} is immutable</strong>
                <p>
                  Frozen proof <code>{snapshotProof}</code>. This revision cannot be edited; create a
                  separate brief for any later change.
                </p>
              </div>
              {currentShareUrl && (
                <ShareActions
                  url={currentShareUrl}
                  label={`${payload.brief.customer_label}'s approved Cut Card`}
                  proof={snapshotProof}
                  printable
                />
              )}
            </>
          ) : (
            <div className="customer-approval">
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                  disabled={!ready || approving || Boolean(payload.changeRequest)}
                />
                <span>
                  I reviewed the preview, requirements, and tailor adjustments, and I approve this
                  exact revision and frozen proof <code>{snapshotProof}</code> as the Cut Card.
                </span>
              </label>
              <button
                type="button"
                className="button primary"
                disabled={!ready || !confirm || approving || Boolean(payload.changeRequest)}
                onClick={approve}
              >
                {approving ? "Locking approved revision..." : "Approve and lock this Cut Card"}
              </button>
              {payload.changeRequest ? (
                <div className="change-request-receipt" role="status">
                  <strong>Change requested — cutting is blocked</strong>
                  <p>{payload.changeRequest.reason}</p>
                  <small>
                    Bound to frozen proof <code>{snapshotProof}</code>. The studio must create a
                    new revision before approval can continue.
                  </small>
                </div>
              ) : (
                <div className="customer-change-request">
                  <label htmlFor="customer-change-reason"><strong>Something must change?</strong></label>
                  <textarea
                    id="customer-change-reason"
                    rows={3}
                    maxLength={1000}
                    value={changeReason}
                    placeholder="Describe one concrete change for the next revision."
                    onChange={(event) => setChangeReason(event.target.value)}
                    disabled={requestingChange || approving}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    onClick={requestChange}
                    disabled={changeReason.trim().length < 5 || requestingChange || approving}
                  >
                    {requestingChange ? "Recording change request..." : "Request a new revision"}
                  </button>
                </div>
              )}
              {!ready && (
                <p className="approval-blocked">
                  Approval activates only after the preview and complete, feasible tailor review
                  are ready.
                </p>
              )}
              {error && (
                <p className="approval-blocked" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
