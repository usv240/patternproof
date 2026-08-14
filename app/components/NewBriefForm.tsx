"use client";

import Link from "next/link";
import { useState } from "react";

import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

type ImageField = "body" | "reference";
type Errors = Partial<Record<ImageField | "consent" | "rights" | "form", string>>;
type Phase = "idle" | "starting" | "uploading" | "validating" | "ready";

type UploadGrant = { path: string; token: string };
type IntakeSession = {
  briefId: string;
  revisionId: string;
  uploads: { body: UploadGrant; reference: UploadGrant };
};

type IntakeResult = {
  briefId: string;
  revisionId: string;
};

function validateImage(file: File | null, kind: ImageField): string | undefined {
  if (!file) {
    return kind === "body"
      ? "Add a clear customer photo."
      : "Add a garment reference image.";
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    return "Use a JPG or PNG image.";
  }
  if (file.size > 10 * 1024 * 1024) return "Image must be 10 MB or smaller.";
  return undefined;
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // The generic message below intentionally avoids exposing infrastructure details.
  }
  return "The private upload could not be completed.";
}

export default function NewBriefForm() {
  const [body, setBody] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [customerLabel, setCustomerLabel] = useState("");
  const [shopName, setShopName] = useState("");
  const [garmentCategory, setGarmentCategory] = useState("dresses");
  const [consent, setConsent] = useState(false);
  const [rights, setRights] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const busy = phase === "starting" || phase === "uploading" || phase === "validating";
  const bodyFramingGuidance = garmentCategory === "tops"
    ? "face, shoulders, and torso; height at least 0.9 times the width"
    : "full person; height at least 1.2 times the width";

  async function discardDraft(briefId: string) {
    await fetch("/api/brief/intake/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefId }),
    }).catch(() => undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const next: Errors = {
      body: validateImage(body, "body"),
      reference: validateImage(reference, "reference"),
    };
    if (!consent) {
      next.consent = "Customer consent is required before a body photo can be processed.";
    }
    if (!rights) {
      next.rights = "Confirm that you have permission to use the reference image.";
    }
    setErrors(next);
    setResult(null);
    if (Object.values(next).some(Boolean) || !body || !reference) return;

    let session: IntakeSession | undefined;
    let uploadsCompleted = false;

    try {
      setPhase("starting");
      const sessionResponse = await fetch("/api/brief/intake/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerLabel,
          shopName,
          garmentCategory,
          bodyProcessingConfirmed: consent,
          rightsConfirmed: rights,
        }),
      });
      if (!sessionResponse.ok) throw new Error(await responseError(sessionResponse));
      session = (await sessionResponse.json()) as IntakeSession;

      setPhase("uploading");
      const storage = createSupabaseBrowserClient().storage.from("brief-images");
      const [bodyUpload, referenceUpload] = await Promise.all([
        storage.uploadToSignedUrl(session.uploads.body.path, session.uploads.body.token, body, {
          cacheControl: "0",
          contentType: body.type,
          upsert: false,
        }),
        storage.uploadToSignedUrl(
          session.uploads.reference.path,
          session.uploads.reference.token,
          reference,
          {
            cacheControl: "0",
            contentType: reference.type,
            upsert: false,
          },
        ),
      ]);
      if (bodyUpload.error || referenceUpload.error) {
        throw new Error("One of the private image uploads failed. Please try again.");
      }
      uploadsCompleted = true;

      setPhase("validating");
      const finalizeResponse = await fetch("/api/brief/intake/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          briefId: session.briefId,
          revisionId: session.revisionId,
          bodyUploadPath: session.uploads.body.path,
          referenceUploadPath: session.uploads.reference.path,
        }),
      });
      if (!finalizeResponse.ok) throw new Error(await responseError(finalizeResponse));

      setResult({
        briefId: session.briefId,
        revisionId: session.revisionId,
      });
      setErrors({});
      setPhase("ready");
    } catch (error) {
      if (session && !uploadsCompleted) await discardDraft(session.briefId);
      setErrors({
        form: error instanceof Error ? error.message : "The private upload could not be completed.",
      });
      setPhase("idle");
    }
  }

  function resetFile(kind: ImageField, file: File | null) {
    if (kind === "body") setBody(file);
    else setReference(file);
    setErrors((current) => ({ ...current, [kind]: undefined, form: undefined }));
    setResult(null);
    setPhase("idle");
  }

  return (
    <form className="intake-form" onSubmit={submit} noValidate>
      <div className="brief-details">
        <label>
          <span>Customer label</span>
          <input
            value={customerLabel}
            onChange={(event) => setCustomerLabel(event.target.value)}
            maxLength={80}
            placeholder="e.g. Amina - ceremony dress"
            disabled={busy}
          />
        </label>
        <label>
          <span>Studio name</span>
          <input
            value={shopName}
            onChange={(event) => setShopName(event.target.value)}
            maxLength={120}
            placeholder="Your tailoring studio"
            disabled={busy}
          />
        </label>
        <label>
          <span>Garment category</span>
          <select
            value={garmentCategory}
            onChange={(event) => setGarmentCategory(event.target.value)}
            disabled={busy}
          >
            <option value="dresses">Dress</option>
            <option value="tops">Top</option>
            <option value="bottoms">Bottom</option>
            <option value="one-pieces">One-piece</option>
          </select>
        </label>
      </div>

      <div className="intake-grid">
        <label className="upload-card">
          <span className="upload-number">01</span>
          <strong>Customer photo</strong>
          <small>
            One person &middot; forward-facing &middot; {bodyFramingGuidance} &middot; bright, even light &middot; long side
            512+ px &middot; short side 384+ px &middot; JPG/PNG &middot; &le; 10 MB
          </small>
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
            onChange={(event) => resetFile("body", event.target.files?.[0] ?? null)}
          />
          <em>{body ? body.name : "Choose photo"}</em>
          {errors.body && <b>{errors.body}</b>}
        </label>

        <label className="upload-card">
          <span className="upload-number">02</span>
          <strong>Garment reference</strong>
          <small>One garment or one person &middot; front-facing when possible &middot; JPG/PNG &middot; &le; 10 MB</small>
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
            onChange={(event) => resetFile("reference", event.target.files?.[0] ?? null)}
          />
          <em>{reference ? reference.name : "Choose reference"}</em>
          {errors.reference && <b>{errors.reference}</b>}
        </label>
      </div>

      <div className="consent-box">
        <label>
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(event) => {
              setConsent(event.target.checked);
              setResult(null);
            }}
          />
          The customer consents to this body photo being privately processed by PatternProof
          and YouCam to create a visual-intent preview.
        </label>
        {errors.consent && <b>{errors.consent}</b>}
        <label>
          <input
            type="checkbox"
            checked={rights}
            disabled={busy}
            onChange={(event) => {
              setRights(event.target.checked);
              setResult(null);
            }}
          />
          I have permission to use this garment reference image.
        </label>
        {errors.rights && <b>{errors.rights}</b>}
        <small>
          Original uploads are private and temporary. The server validates the image, removes
          embedded metadata, and stores only a normalized copy.
        </small>
      </div>

      <button className="button primary" type="submit" disabled={busy || phase === "ready"}>
        {phase === "starting"
          ? "Creating private session..."
          : phase === "uploading"
            ? "Uploading privately..."
            : phase === "validating"
              ? "Validating and removing metadata..."
              : phase === "ready"
                ? "Private intake ready"
                : "Create private Cut Card"}
      </button>

      <div aria-live="polite">
        {errors.form && (
          <div className="form-error" role="alert">
            <strong>Could not create the Cut Card.</strong>
            <p>{errors.form}</p>
          </div>
        )}

        {result && (
          <div className="ready-message">
            <strong>&#10003; Images validated and stored privately.</strong>
            <p>
              Embedded metadata was removed. Add the visual preview and feasibility decisions
              before creating a customer approval link.
            </p>
            <Link className="button secondary" href={`/brief/${result.briefId}`}>
              Continue to visual agreement
            </Link>
          </div>
        )}
      </div>
    </form>
  );
}
