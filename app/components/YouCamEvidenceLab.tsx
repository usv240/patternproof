"use client";

import { useEffect, useState } from "react";

type Feature = "background_removal" | "fabric_vto" | "approved_motion";
type Template = {
  id: string;
  thumb: string;
  title: string;
  categoryName: string;
};

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Safe fallback below.
  }
  return "The YouCam evidence step could not be completed.";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function YouCamEvidenceLab({
  revisionId,
  backgroundReady,
  canRescueBackground,
  fabricDirection,
  canApplyFabric,
  motionUrl,
  canCreateMotion,
  onComplete,
}: {
  revisionId: string;
  backgroundReady: boolean;
  canRescueBackground: boolean;
  fabricDirection: { templateId: string; templateTitle: string } | null;
  canApplyFabric: boolean;
  motionUrl: string | null;
  canCreateMotion: boolean;
  onComplete: () => Promise<unknown>;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string>();
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [busy, setBusy] = useState<Feature>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!canApplyFabric) return;
    let active = true;
    setLoadingTemplates(true);
    setTemplateError(undefined);
    setTemplates([]);
    setSelectedTemplate("");
    fetch("/api/youcam/fabric/templates", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return response.json() as Promise<{ templates?: Template[] }>;
      })
      .then((result) => {
        if (!active) return;
        const catalog = Array.isArray(result.templates) ? result.templates : [];
        if (catalog.length === 0) {
          throw new Error("No predefined Fabric VTO directions are available right now.");
        }
        setTemplates(catalog);
        setSelectedTemplate(catalog[0].id);
      })
      .catch((caught) => active && setTemplateError(
        caught instanceof Error ? caught.message : "Fabric directions are unavailable.",
      ))
      .finally(() => active && setLoadingTemplates(false));
    return () => { active = false; };
  }, [canApplyFabric, revisionId, catalogRetry]);

  async function run(feature: Feature) {
    if (busy) return;
    if (feature === "fabric_vto" && !selectedTemplate) {
      setError("Choose a predefined fabric direction first.");
      return;
    }
    setBusy(feature);
    setError(undefined);
    try {
      const response = await fetch("/api/youcam/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revisionId,
          feature,
          ...(feature === "fabric_vto" ? { templateId: selectedTemplate } : {}),
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const created = (await response.json()) as { jobId?: unknown };
      if (typeof created.jobId !== "string") throw new Error("YouCam returned an invalid evidence job.");

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await wait(2_000);
        const statusResponse = await fetch(
          `/api/youcam/evidence/${encodeURIComponent(created.jobId)}`,
          { cache: "no-store" },
        );
        if (!statusResponse.ok) throw new Error(await errorMessage(statusResponse));
        const status = (await statusResponse.json()) as { status?: unknown };
        if (status.status === "success") {
          await onComplete();
          return;
        }
        if (status.status === "error" || status.status === "timeout") {
          throw new Error("YouCam could not complete this optional evidence step.");
        }
      }
      throw new Error("This evidence is still processing. Refresh the workspace in a moment.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The evidence step failed.");
    } finally {
      setBusy(undefined);
    }
  }

  if (
    !canRescueBackground && !backgroundReady &&
    !canApplyFabric && !fabricDirection &&
    !canCreateMotion && !motionUrl
  ) return null;

  const activeFeature: Feature | undefined = canRescueBackground
    ? "background_removal"
    : canApplyFabric
      ? "fabric_vto"
      : canCreateMotion
        ? "approved_motion"
        : undefined;
  const heading = activeFeature === "background_removal"
    ? "First, clean the reference."
    : activeFeature === "fabric_vto"
      ? "Preview ready. Choose a fabric direction."
      : activeFeature === "approved_motion"
        ? "Approved. Add presentation motion."
        : !fabricDirection
          ? "Next, generate the YouCam preview."
          : "Visual evidence is ready.";

  return (
    <section className="youcam-evidence-lab" aria-labelledby="youcam-evidence-heading">
      <header>
        <div>
          <p className="eyebrow">YouCam visual tools</p>
          <h3 id="youcam-evidence-heading">{heading}</h3>
        </div>
        <span>{activeFeature ? "Current action" : "Server-bounded"}</span>
      </header>
      <ol className="evidence-progress" aria-label="YouCam evidence sequence">
        <li className={backgroundReady ? "complete" : activeFeature === "background_removal" ? "current" : "locked"}>
          <b>01</b><span><strong>Reference</strong><small>{backgroundReady ? "Done" : activeFeature === "background_removal" ? "Current" : "Optional"}</small></span>
        </li>
        <li className={fabricDirection ? "complete" : activeFeature === "fabric_vto" ? "current" : "locked"}>
          <b>02</b><span><strong>Fabric</strong><small>{fabricDirection ? "Done" : activeFeature === "fabric_vto" ? "Current" : "After preview"}</small></span>
        </li>
        <li className={motionUrl ? "complete" : activeFeature === "approved_motion" ? "current" : "locked"}>
          <b>03</b><span><strong>Motion</strong><small>{motionUrl ? "Done" : activeFeature === "approved_motion" ? "Current" : "After approval"}</small></span>
        </li>
      </ol>

      {activeFeature === "background_removal" && (
        <article className="evidence-current-action">
          <div><h4>Reference rescue</h4><p>Remove a distracting background before the core Clothes VTO request.</p></div>
          <button type="button" onClick={() => void run("background_removal")} disabled={Boolean(busy)}>
            {busy === "background_removal" ? "Rescuing..." : "Rescue this reference"}
          </button>
        </article>
      )}

      {activeFeature === "fabric_vto" && (
        <article className="evidence-current-action fabric-action">
          <div><h4>Fabric direction</h4><p>Choose one predefined Perfect Corp direction before craft review.</p></div>
          {loadingTemplates ? (
            <p className="evidence-step-status" role="status">Loading predefined directions...</p>
          ) : templateError ? (
            <div className="evidence-step-error" role="alert">
              <p>{templateError}</p>
              <button type="button" onClick={() => setCatalogRetry((current) => current + 1)} disabled={Boolean(busy)}>
                Retry directions
              </button>
            </div>
          ) : (
            <div className="evidence-fabric-control">
              <label>
                Predefined direction
                <select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)} disabled={Boolean(busy)}>
                  {templates.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.title} · {template.categoryName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void run("fabric_vto")} disabled={Boolean(busy) || !selectedTemplate}>
                {busy === "fabric_vto" ? "Applying direction..." : "Apply fabric direction"}
              </button>
            </div>
          )}
        </article>
      )}

      {activeFeature === "approved_motion" && (
        <article className="evidence-current-action">
          <div><h4>Approved motion proof</h4><p>Create a five-second presentation after the exact Cut Card is approved.</p></div>
          <button type="button" onClick={() => void run("approved_motion")} disabled={Boolean(busy)}>
            {busy === "approved_motion" ? "Creating motion..." : "Create motion proof"}
          </button>
        </article>
      )}

      {!activeFeature && !fabricDirection && (
        <p className="evidence-next-step"><strong>Reference ready.</strong> Generate the body-specific preview below.</p>
      )}
      {!activeFeature && fabricDirection && !motionUrl && (
        <p className="evidence-next-step"><strong>Visual tools complete.</strong> Continue with the human construction review.</p>
      )}
      {motionUrl && (
        <details className="evidence-motion-proof">
          <summary>View approved 5-second motion proof</summary>
          {/*
            preload="auto", not "metadata": the provider returns a non-faststart MP4
            (moov atom after mdat), so a metadata-only preload cannot resolve duration
            or dimensions and the player renders black at 0:00. The clip is ~1 MB, so
            fetching it whole is cheap and makes playback reliable.
          */}
          <video src={motionUrl} controls playsInline preload="auto">Your browser cannot play this private motion proof.</video>
        </details>
      )}
      <details className="evidence-caveat-details">
        <summary>Visual-tool limits</summary>
        <p>Fabric is a predefined visual direction, not an uploaded swatch or drape simulation. Motion is presentation-only and is excluded from the frozen construction checksum.</p>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
