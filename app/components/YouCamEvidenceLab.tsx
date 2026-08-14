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
  const [busy, setBusy] = useState<Feature>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!canApplyFabric || templates.length > 0 || loadingTemplates || error) return;
    let active = true;
    setLoadingTemplates(true);
    fetch("/api/youcam/fabric/templates", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return response.json() as Promise<{ templates?: Template[] }>;
      })
      .then((result) => {
        if (!active) return;
        const catalog = Array.isArray(result.templates) ? result.templates : [];
        setTemplates(catalog);
        setSelectedTemplate(catalog[0]?.id ?? "");
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "Fabric directions are unavailable."))
      .finally(() => active && setLoadingTemplates(false));
    return () => { active = false; };
  }, [canApplyFabric, error, loadingTemplates, templates.length]);

  async function run(feature: Feature) {
    if (busy) return;
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

  return (
    <section className="youcam-evidence-lab" aria-labelledby="youcam-evidence-heading">
      <header>
        <div>
          <p className="eyebrow">Optional evidence lab</p>
          <h3 id="youcam-evidence-heading">Strengthen the visual—without changing the promise.</h3>
        </div>
        <span>Server-bounded YouCam tools</span>
      </header>
      <div className="evidence-lab-grid">
        <article className={backgroundReady ? "complete" : ""}>
          <b>01</b>
          <h4>Reference rescue</h4>
          <p>Remove a distracting background before the core Clothes VTO request.</p>
          {backgroundReady ? <strong>Background rescued</strong> : canRescueBackground ? (
            <button type="button" onClick={() => void run("background_removal")} disabled={Boolean(busy)}>
              {busy === "background_removal" ? "Rescuing..." : "Rescue this reference"}
            </button>
          ) : <small>Available before the first preview.</small>}
        </article>

        <article className={fabricDirection ? "complete" : ""}>
          <b>02</b>
          <h4>Fabric direction</h4>
          <p>Explore one predefined Perfect Corp fabric template before craft review.</p>
          {fabricDirection ? (
            <strong>{fabricDirection.templateTitle}</strong>
          ) : canApplyFabric ? (
            <>
              <label>
                Predefined direction
                <select
                  value={selectedTemplate}
                  onChange={(event) => setSelectedTemplate(event.target.value)}
                  disabled={Boolean(busy) || loadingTemplates}
                >
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
            </>
          ) : <small>Available after preview, before any human decision.</small>}
        </article>

        <article className={motionUrl ? "complete" : ""}>
          <b>03</b>
          <h4>Approved motion proof</h4>
          <p>Create a fixed five-second presentation only after customer approval.</p>
          {motionUrl ? (
            <video src={motionUrl} controls playsInline preload="metadata">
              Your browser cannot play this private motion proof.
            </video>
          ) : canCreateMotion ? (
            <button type="button" onClick={() => void run("approved_motion")} disabled={Boolean(busy)}>
              {busy === "approved_motion" ? "Creating motion..." : "Create 5-second motion proof"}
            </button>
          ) : <small>Unlocks only after the exact Cut Card is approved.</small>}
        </article>
      </div>
      <p className="evidence-lab-caveat">
        Fabric is a predefined visual direction, not an uploaded swatch or drape simulation. Motion is presentation-only and is excluded from the frozen construction checksum.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
