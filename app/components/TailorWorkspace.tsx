"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { evaluateCutReadiness } from "../../lib/cut-readiness";
import { evaluateExpectationChecksum } from "../../lib/expectation-checksum";
import { shortSnapshotProof } from "../../lib/review-snapshot";
import CutReadinessPassport from "./CutReadinessPassport";
import ExpectationChecksum from "./ExpectationChecksum";
import RevisionReplay from "./RevisionReplay";
import ShareActions from "./ShareActions";
import YouCamEvidenceLab from "./YouCamEvidenceLab";

type Status = "as_shown" | "with_adjustment" | "not_feasible";
type Requirement = {
  id: string;
  label: string;
  note?: string | null;
  status?: Status;
  tailorNote?: string | null;
};
type WorkspacePayload = {
  brief: {
    id: string;
    customerLabel: string;
    status: string;
    sharedRevisionId: string | null;
    snapshotSha256: string | null;
    rightsConfirmed: boolean;
  };
  revision: null | {
    id: string;
    version: number;
    lockedAt: string | null;
    garmentSpec: Record<string, unknown>;
    bodyUrl: string | null;
    bodyErasureStatus: string | null;
    bodyErasedAt: string | null;
    referenceUrl: string | null;
    originalReferenceUrl: string | null;
    referenceRescued: boolean;
    baseRenderUrl: string | null;
    renderUrl: string | null;
    fabricDirection: { templateId: string; templateTitle: string } | null;
    motionUrl: string | null;
    annotations: Annotation[];
    requirements: Requirement[];
    changeRequests: Array<{
      id: string;
      revisionId: string;
      sourceVersion: number;
      snapshotSha256: string;
      reason: string;
      state: "open" | "accepted";
      createdAt: string;
      resolvedAt: string | null;
    }>;
  };
};
type Annotation = {
  id: string;
  requirementId: string | null;
  anchorX: number;
  anchorY: number;
  body: string;
  createdAt: string;
};
type Decision = { status: Status | ""; tailorNote: string };

const decisionLabels: Record<Status, string> = {
  as_shown: "Can make as shown",
  with_adjustment: "Can make with adjustment",
  not_feasible: "Not feasible - revise design",
};

async function apiError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === "string") return data.error;
  } catch {
    // Use the safe fallback below.
  }
  return "The workspace request could not be completed.";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some browsers expose the API but reject it outside a trusted gesture.
    }
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.readOnly = true;
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  try {
    fallback.focus();
    fallback.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy was rejected.");
  } finally {
    fallback.remove();
  }
}

function youCamCategory(spec: Record<string, unknown>): "full_body" | "upper_body" | "lower_body" {
  if (spec.category === "tops") return "upper_body";
  if (spec.category === "bottoms") return "lower_body";
  return "full_body";
}

export default function TailorWorkspace({ briefId }: { briefId: string }) {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [newRequirement, setNewRequirement] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [shareUrl, setShareUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number }>();
  const [pinnedRequirementId, setPinnedRequirementId] = useState("");
  const [pinnedNote, setPinnedNote] = useState("");
  const [loading, setLoading] = useState(true);
  const copiedTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (preserveExisting = true) => {
    setLoading(true);
    if (!preserveExisting) {
      setWorkspace(null);
      setError(undefined);
    }
    try {
      const response = await fetchWithTimeout(`/api/brief/${encodeURIComponent(briefId)}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setError(await apiError(response));
        return false;
      }
      const payload = (await response.json()) as WorkspacePayload;
      setWorkspace(payload);
      setDecisions(
        Object.fromEntries(
          (payload.revision?.requirements ?? []).map((requirement) => [
            requirement.id,
            { status: requirement.status ?? "", tailorNote: requirement.tailorNote ?? "" },
          ]),
        ),
      );
      setError(undefined);
      return true;
    } catch {
      setError("The workspace could not be refreshed. Check your connection and try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [briefId]);

  useEffect(() => {
    setShareUrl(undefined);
    setCopied(false);
    void load(false);
  }, [load]);

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
  }, []);

  const canShare = useMemo(() => {
    const revision = workspace?.revision;
    if (!revision?.renderUrl || revision.requirements.length === 0 || revision.lockedAt) return false;
    return revision.requirements.every((requirement) => {
      if (!requirement.status || requirement.status === "not_feasible") return false;
      return requirement.status !== "with_adjustment" || Boolean(requirement.tailorNote?.trim());
    });
  }, [workspace]);

  async function addRequirement() {
    const label = newRequirement.trim();
    if (!label || busy) return;
    setBusy("requirement");
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        `/api/brief/${encodeURIComponent(briefId)}/requirements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        },
      );
      if (!response.ok) setError(await apiError(response));
      else {
        setNewRequirement("");
        await load();
      }
    } catch {
      setError("Connection lost. Refresh before adding it again; the requirement may already be saved.");
    } finally {
      setBusy(undefined);
    }
  }

  async function saveDecision(requirementId: string) {
    const decision = decisions[requirementId];
    if (!decision?.status || busy) return;
    if (decision.status === "with_adjustment" && !decision.tailorNote.trim()) {
      setError("Describe the customer-visible adjustment before saving this decision.");
      return;
    }
    setBusy(requirementId);
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        `/api/brief/${encodeURIComponent(briefId)}/requirements/${encodeURIComponent(requirementId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: decision.status,
            ...(decision.status === "with_adjustment"
              ? { tailorNote: decision.tailorNote }
              : {}),
          }),
        },
      );
      if (!response.ok) setError(await apiError(response));
      else await load();
    } catch {
      setError("The tailor decision could not be saved. Check your connection and try again.");
    } finally {
      setBusy(undefined);
    }
  }

  async function renderPreview() {
    const revision = workspace?.revision;
    if (!revision || busy) return;
    setBusy("render");
    setError(undefined);
    try {
      const response = await fetchWithTimeout("/api/youcam/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revisionId: revision.id,
          garmentCategory: youCamCategory(revision.garmentSpec),
        }),
      });
      if (!response.ok) {
        setError(await apiError(response));
        return;
      }
      const result = (await response.json()) as { jobId?: unknown };
      if (typeof result.jobId !== "string" || !result.jobId) {
        setError("YouCam returned an invalid preview job. Try again.");
        return;
      }

      for (let attempt = 0; attempt < 45; attempt += 1) {
        await delay(2_000);
        const statusResponse = await fetchWithTimeout(
          `/api/youcam/status/${encodeURIComponent(result.jobId)}`,
          { cache: "no-store", headers: { Accept: "application/json" } },
        );
        if (!statusResponse.ok) {
          setError(await apiError(statusResponse));
          return;
        }
        const status = (await statusResponse.json()) as { status?: unknown };
        if (status.status === "success") {
          await load();
          return;
        }
        if (status.status === "retry") {
          setError(
            "The render worker released this attempt safely. Generate the preview again.",
          );
          return;
        }
        if (status.status === "error" || status.status === "timeout") {
          setError("YouCam could not create this preview. Check the two images and try again.");
          return;
        }
      }
      setError("The preview is still processing. Refresh this workspace in a moment.");
    } catch {
      setError("The preview request lost its connection. Refresh before trying again; the job may still finish.");
    } finally {
      setBusy(undefined);
    }
  }

  function selectPin(event: ReactMouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPendingPin({
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    });
  }

  async function addPinnedNote() {
    const body = pinnedNote.trim();
    if (!pendingPin || !pinnedRequirementId || !body || busy) return;
    setBusy("annotation");
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        `/api/brief/${encodeURIComponent(briefId)}/annotations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirementId: pinnedRequirementId, anchorX: pendingPin.x, anchorY: pendingPin.y, body }),
        },
      );
      if (!response.ok) setError(await apiError(response));
      else {
        setPendingPin(undefined);
        setPinnedRequirementId("");
        setPinnedNote("");
        await load();
      }
    } catch {
      setError("The pinned note could not be saved. Check your connection and try again.");
    } finally {
      setBusy(undefined);
    }
  }

  async function removePinnedNote(annotationId: string) {
    if (busy) return;
    setBusy(`annotation-${annotationId}`);
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        `/api/brief/${encodeURIComponent(briefId)}/annotations/${encodeURIComponent(annotationId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) setError(await apiError(response));
      else await load();
    } catch {
      setError("The pinned note could not be removed. Check your connection and try again.");
    } finally {
      setBusy(undefined);
    }
  }
  async function createCustomerLink() {
    if (!canShare || busy) return;
    setBusy("share");
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        `/api/brief/${encodeURIComponent(briefId)}/share-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) {
        setError(await apiError(response));
        return;
      }
      const result = (await response.json()) as { sharePath?: unknown };
      if (typeof result.sharePath !== "string" || !result.sharePath) {
        setError("The server returned an invalid customer link. Refresh and try again.");
        return;
      }
      const returnedShareUrl = new URL(result.sharePath, window.location.origin);
      if (returnedShareUrl.origin !== window.location.origin) {
        setError("The server returned an invalid customer link. Refresh and try again.");
        return;
      }

      // Preserve the only raw token-bearing URL before refreshing the frozen workspace.
      setShareUrl(returnedShareUrl.toString());
      setCopied(false);
      await load();
    } catch {
      setError("The link result could not be confirmed. Refresh, then create a fresh private link.");
    } finally {
      setBusy(undefined);
    }
  }

  async function copyLink() {
    if (!shareUrl || busy) return;
    setBusy("copy");
    try {
      await writeClipboard(shareUrl);
      setCopied(true);
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimer.current = undefined;
      }, 2_000);
    } catch {
      setCopied(false);
      setError("Automatic copy was blocked. Select the private link and copy it manually.");
    } finally {
      setBusy(undefined);
    }
  }

  async function eraseCustomerPhoto() {
    if (!workspace || busy) return;
    setBusy("erase-photo");
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        "/api/brief/" + encodeURIComponent(briefId) + "/customer-photo",
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await apiError(response));
        return;
      }
      await load();
    } catch {
      setError("Photo erasure could not be confirmed. Refresh before retrying; cleanup may still be queued.");
    } finally {
      setBusy(undefined);
    }
  }

  async function reviseCustomerReview() {
    const reason = (openChangeRequest?.reason ?? withdrawReason).trim();
    if (!workspace || busy || reason.length < 5 || reason.length > 1_000) return;
    setBusy("revise-review");
    setError(undefined);
    try {
      const response = await fetchWithTimeout(
        "/api/brief/" + encodeURIComponent(briefId) + "/withdraw-review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        setError(await apiError(response));
        return;
      }
      const result = (await response.json()) as { revised?: unknown };
      if (result.revised !== true) {
        setError("The new revision could not be confirmed. Refresh before retrying.");
        return;
      }
      setWithdrawReason("");
      setShareUrl(undefined);
      setCopied(false);
      await load(false);
    } catch {
      setError("The new revision could not be confirmed. Refresh before retrying; it may already exist.");
    } finally {
      setBusy(undefined);
    }
  }

  if (!workspace) {
    return (
      <section className="workspace-loading">
        <p className="eyebrow">Tailor workspace</p>
        <h1>{loading ? "Loading private brief..." : "This brief cannot be opened."}</h1>
        {error && (
          <div role="alert">
            <p>{error} <Link href="/create">Restart the secure workspace</Link></p>
            <button
              type="button"
              className="button secondary"
              onClick={() => void load(false)}
              disabled={loading}
            >
              {loading ? "Trying again..." : "Try again"}
            </button>
          </div>
        )}
      </section>
    );
  }

  const revision = workspace.revision;
  if (!revision) {
    return <section className="workspace-loading"><h1>No revision exists for this brief.</h1></section>;
  }
  const approved = Boolean(revision.lockedAt || workspace.brief.status === "approved");
  const inCustomerReview = workspace.brief.status === "awaiting_customer";
  const readOnly = approved || inCustomerReview;
  const openChangeRequest = revision.changeRequests.find((request) => request.state === "open");
  const humanReviewStarted = revision.annotations.length > 0 ||
    revision.requirements.some((requirement) => Boolean(requirement.status));
  const readiness = evaluateCutReadiness({
    rightsConfirmed: workspace.brief.rightsConfirmed,
    previewReady: Boolean(revision.renderUrl),
    requirements: revision.requirements,
    snapshotFrozen: Boolean(workspace.brief.snapshotSha256),
    customerApproved: approved,
    changeRequested: Boolean(openChangeRequest),
  });
  const snapshotProof = workspace.brief.snapshotSha256
    ? shortSnapshotProof(workspace.brief.snapshotSha256)
    : undefined;
  const expectationChecksum = evaluateExpectationChecksum({
    visualEvidence: Boolean(revision.renderUrl && workspace.brief.snapshotSha256),
    craftDecision: readiness.checks.find((check) => check.id === "feasible")?.complete === true,
    customerConsent: approved,
  });

  return (
    <section className="tailor-workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">{workspace.brief.customerLabel} - revision {revision.version}</p>
          <h1>{approved ? "Approved Cut Card" : inCustomerReview ? "Customer review in progress" : "Prepare the agreement."}</h1>
          <p>Use AI for the visual, then use human judgment for every construction promise.</p>
          {workspace.brief.snapshotSha256 && (
            <small>Snapshot proof {shortSnapshotProof(workspace.brief.snapshotSha256)}</small>
          )}
        </div>
        <span className={readOnly ? "state locked" : "state"}>
          {approved ? "Approved and locked" : inCustomerReview ? "Frozen for customer" : workspace.brief.status.replaceAll("_", " ")}
        </span>
      </header>

      <div className="workspace-grid">
        <div className="workspace-visual-panel">
          <div className="workspace-visual-heading">
            <div>
              <p className="eyebrow">Visual agreement</p>
              <h2>Compare the intent.</h2>
            </div>
            <p>One customer, one reference, one shared visual before any fabric is cut.</p>
          </div>
          <YouCamEvidenceLab
            revisionId={revision.id}
            backgroundReady={revision.referenceRescued}
            canRescueBackground={!readOnly && !revision.baseRenderUrl}
            fabricDirection={revision.fabricDirection}
            canApplyFabric={!readOnly && Boolean(revision.baseRenderUrl) && !revision.fabricDirection && !humanReviewStarted}
            motionUrl={revision.motionUrl}
            canCreateMotion={approved && !revision.motionUrl}
            onComplete={() => load()}
          />
          <div className="workspace-comparison">
            <figure className="comparison-card customer-input">
              <figcaption><span>1</span> Customer input</figcaption>
              {revision.bodyUrl ? (
                <Image src={revision.bodyUrl} alt="Customer photo for virtual try-on" width={600} height={800} unoptimized />
              ) : revision.bodyErasureStatus ? (
                <div className="render-placeholder" role="status">
                  {revision.bodyErasedAt
                    ? "Customer photo erased"
                    : "Customer photo hidden; secure erasure is queued"}
                </div>
              ) : null}
            </figure>
            <figure className="comparison-card garment-input">
              <figcaption><span>2</span> Garment intent</figcaption>
              {revision.referenceUrl && <Image src={revision.referenceUrl} alt="Garment reference" width={600} height={800} unoptimized />}
            </figure>
            <figure className="comparison-card youcam-output">
              <figcaption><span>3</span> YouCam result</figcaption>
              {revision.renderUrl ? (
                readOnly ? (
                  <div className="annotation-canvas">
                    <Image src={revision.renderUrl} alt="YouCam visual-intent preview" width={800} height={1000} unoptimized />
                    {revision.annotations.map((annotation, index) => (
                      <span
                        className={`design-pin ${revision.requirements.find((requirement) => requirement.id === annotation.requirementId)?.status?.replaceAll("_", "-") ?? "unlinked"}`}
                        key={annotation.id}
                        style={{ left: `${annotation.anchorX * 100}%`, top: `${annotation.anchorY * 100}%` }}
                        title={annotation.body}
                      >
                        {index + 1}
                      </span>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="annotation-canvas annotation-target"
                    onClick={selectPin}
                    aria-label="Choose a point on the YouCam result for a pinned design note"
                    disabled={Boolean(busy)}
                  >
                    <Image src={revision.renderUrl} alt="YouCam visual-intent preview" width={800} height={1000} unoptimized />
                    {revision.annotations.map((annotation, index) => (
                      <span
                        className={`design-pin ${revision.requirements.find((requirement) => requirement.id === annotation.requirementId)?.status?.replaceAll("_", "-") ?? "unlinked"}`}
                        key={annotation.id}
                        style={{ left: `${annotation.anchorX * 100}%`, top: `${annotation.anchorY * 100}%` }}
                        title={annotation.body}
                      >
                        {index + 1}
                      </span>
                    ))}
                    {pendingPin && (
                      <span
                        className="design-pin pending"
                        style={{ left: `${pendingPin.x * 100}%`, top: `${pendingPin.y * 100}%` }}
                      >
                        +
                      </span>
                    )}
                  </button>
                )
              ) : (
                <div className="render-placeholder">No preview yet</div>
              )}
              {!readOnly && !revision.renderUrl && (
                <button type="button" className="button secondary" onClick={renderPreview} disabled={Boolean(busy)}>
                  {busy === "render" ? "Creating preview..." : "Generate YouCam preview"}
                </button>
              )}
            </figure>
          </div>
          {revision.renderUrl && (
            <section className="workspace-annotations" aria-labelledby="workspace-annotations-heading">
              <div className="workspace-annotations-heading">
                <div>
                  <p className="eyebrow">Spatial agreement</p>
                  <h3 id="workspace-annotations-heading">Pin the construction detail.</h3>
                </div>
                <span>{revision.annotations.length}</span>
              </div>
              {!readOnly && (
                <p className="annotation-instruction">
                  Click the YouCam result exactly where the customer and tailor need a shared note.
                </p>
              )}
              {pendingPin && !readOnly && (
                <div className="annotation-editor">
                  <label>
                    Non-negotiable this pin explains
                    <select value={pinnedRequirementId} onChange={(event) => setPinnedRequirementId(event.target.value)} disabled={Boolean(busy)}>
                      <option value="">Choose a non-negotiable...</option>
                      {revision.requirements.map((requirement) => (
                        <option key={requirement.id} value={requirement.id}>{requirement.label}</option>
                      ))}
                    </select>
                  </label>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    autoFocus
                    value={pinnedNote}
                    placeholder="e.g. Keep the cream piping flat around this curve."
                    onChange={(event) => setPinnedNote(event.target.value)}
                    disabled={Boolean(busy)}
                  />
                  <div>
                    <button type="button" onClick={addPinnedNote} disabled={!pinnedRequirementId || !pinnedNote.trim() || Boolean(busy)}>
                      {busy === "annotation" ? "Pinning..." : "Pin note"}
                    </button>
                    <button type="button" className="text-button" onClick={() => { setPendingPin(undefined); setPinnedRequirementId(""); setPinnedNote(""); }} disabled={Boolean(busy)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {revision.annotations.length > 0 && (
                <ol className="workspace-annotation-list">
                  {revision.annotations.map((annotation, index) => (
                    <li key={annotation.id}>
                      <span>{index + 1}</span>
                      <p><strong>{revision.requirements.find((requirement) => requirement.id === annotation.requirementId)?.label ?? "Unlinked detail"}</strong><br />{annotation.body}</p>
                      {!readOnly && (
                        <button type="button" className="text-button" onClick={() => removePinnedNote(annotation.id)} disabled={Boolean(busy)}>
                          {busy === `annotation-${annotation.id}` ? "Removing..." : "Remove"}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          <p className="comparison-disclaimer">
            The YouCam output communicates visual intent. It is not a guarantee of exact fit, measurements,
            construction, fabric behavior, or final appearance.
          </p>
        </div>

        <div className="workspace-requirements">
          <details className="workspace-gate-details" open={approved}>
            <summary>
              <span>
                <small>Release gate</small>
                <strong>{approved ? "Cut released" : openChangeRequest ? "Revision blocked" : inCustomerReview ? "Awaiting customer" : "Not ready yet"}</strong>
              </span>
              <b>{readiness.completed}/{readiness.total} checks</b>
            </summary>
            <div className="workspace-gate-details-body">
              <ExpectationChecksum checksum={expectationChecksum} proof={snapshotProof} compact />
              <CutReadinessPassport readiness={readiness} proof={snapshotProof} compact />
            </div>
          </details>
          <h2>Customer non-negotiables</h2>
          <p className="helper">A not-feasible decision deliberately blocks sharing and approval.</p>

          {revision.requirements.map((requirement) => {
            const decision = decisions[requirement.id] ?? { status: "", tailorNote: "" };
            return (
              <article className="tailor-requirement" key={requirement.id}>
                <strong>{requirement.label}</strong>
                {requirement.note && <p>{requirement.note}</p>}
                <select
                  value={decision.status}
                  disabled={readOnly || Boolean(busy)}
                  onChange={(event) => setDecisions((current) => ({
                    ...current,
                    [requirement.id]: {
                      ...decision,
                      status: event.target.value as Decision["status"],
                      tailorNote: event.target.value === "with_adjustment" ? decision.tailorNote : "",
                    },
                  }))}
                >
                  <option value="">Choose feasibility...</option>
                  {(Object.keys(decisionLabels) as Status[]).map((status) => (
                    <option value={status} key={status}>{decisionLabels[status]}</option>
                  ))}
                </select>
                {decision.status === "with_adjustment" && (
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={decision.tailorNote}
                    disabled={readOnly || Boolean(busy)}
                    placeholder="State the exact, customer-visible adjustment."
                    onChange={(event) => setDecisions((current) => ({
                      ...current,
                      [requirement.id]: { ...decision, tailorNote: event.target.value },
                    }))}
                  />
                )}
                {!readOnly && (
                  <button type="button" onClick={() => saveDecision(requirement.id)} disabled={!decision.status || Boolean(busy)}>
                    {busy === requirement.id ? "Saving..." : "Save decision"}
                  </button>
                )}
              </article>
            );
          })}

          {!readOnly && (
            <div className="workspace-add-requirement">
              <input
                value={newRequirement}
                maxLength={120}
                placeholder="e.g. neckline must sit above bra line"
                onChange={(event) => setNewRequirement(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && addRequirement()}
                disabled={Boolean(busy)}
              />
              <button type="button" onClick={addRequirement} disabled={!newRequirement.trim() || Boolean(busy)}>
                {busy === "requirement" ? "Adding..." : "Add"}
              </button>
            </div>
          )}

          {error && <div className="workspace-error" role="alert">{error}</div>}

          <div className="workspace-share">
            <strong>Customer approval link</strong>
            <p>{canShare ? "The preview and feasibility review satisfy the Cut Card gate." : "Complete a feasible review and preview before sharing."}</p>
            {!approved && !shareUrl && (
              <button type="button" className="button primary" disabled={!canShare || Boolean(busy)} onClick={createCustomerLink}>
                {busy === "share" ? "Creating private link..." : inCustomerReview ? "Replace with fresh 14-day link" : "Create 14-day approval link"}
              </button>
            )}
            {shareUrl && (
              <>
                <div className="share-link-result">
                  <input readOnly value={shareUrl} aria-label="Private customer approval link" />
                  <button type="button" onClick={copyLink} disabled={Boolean(busy)}>
                    {busy === "copy" ? "Copying..." : copied ? "Copied" : "Copy"}
                  </button>
                  <a href={shareUrl} target="_blank" rel="noreferrer">Open</a>
                </div>
                <ShareActions
                  url={shareUrl}
                  label={`${workspace.brief.customerLabel}'s Cut Card`}
                  proof={workspace.brief.snapshotSha256 ? shortSnapshotProof(workspace.brief.snapshotSha256) : undefined}
                />
              </>
            )}
          </div>

          {inCustomerReview && (
            <div className={`workspace-share revision-action${openChangeRequest ? " customer-veto" : ""}`}>
              <strong>{openChangeRequest ? "Customer requested a new revision" : "Need to change the customer review?"}</strong>
              <p>
                This revokes the current customer link and preserves its frozen audit record.
                A new editable revision copies the verified private inputs and requirements,
                then resets the preview and feasibility decisions for a fresh review.
              </p>
              {openChangeRequest && <blockquote>“{openChangeRequest.reason}”</blockquote>}
              <label htmlFor="review-revision-reason">
                {openChangeRequest ? "Customer request (locked)" : "Reason for the new revision"}
              </label>
              <textarea
                id="review-revision-reason"
                rows={3}
                minLength={5}
                maxLength={1000}
                value={openChangeRequest?.reason ?? withdrawReason}
                placeholder="Describe exactly what changed (at least 5 characters)."
                disabled={Boolean(busy) || Boolean(openChangeRequest)}
                onChange={(event) => setWithdrawReason(event.target.value)}
              />
              <small>{(openChangeRequest?.reason ?? withdrawReason).trim().length}/1000 characters</small>
              <button
                type="button"
                className="button secondary"
                disabled={(openChangeRequest?.reason ?? withdrawReason).trim().length < 5 || (openChangeRequest?.reason ?? withdrawReason).trim().length > 1000 || Boolean(busy)}
                onClick={reviseCustomerReview}
              >
                {busy === "revise-review" ? "Creating verified revision..." : openChangeRequest ? "Accept request and create revision" : "Revoke link and create revision"}
              </button>
            </div>
          )}

          <RevisionReplay
            currentVersion={revision.version}
            currentState={approved ? "Approved and locked" : inCustomerReview ? "Awaiting customer decision" : "New revision in progress"}
            changes={revision.changeRequests}
          />
          {approved && (
            <div className="workspace-share privacy-action">
              <strong>Customer-photo privacy</strong>
              <p>
                The approved Cut Card, garment reference, preview, and proof remain.
                The original customer body photo can be permanently erased.
              </p>
              {revision.bodyErasureStatus ? (
                <span className="state locked" role="status">
                  {revision.bodyErasedAt ? "Photo erased" : "Erasure queued"}
                </span>
              ) : (
                <button
                  type="button"
                  className="button secondary"
                  disabled={Boolean(busy)}
                  onClick={eraseCustomerPhoto}
                >
                  {busy === "erase-photo" ? "Erasing securely..." : "Erase customer photo"}
                </button>
              )}
              <Link className="text-link" href="/brief/new">Start a new Cut Card</Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
