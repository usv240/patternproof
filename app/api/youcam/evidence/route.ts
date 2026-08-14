import { NextRequest, NextResponse } from "next/server";

import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../lib/security/request-origin";
import {
  abortEvidenceAttempt,
  attachEvidenceTask,
  consumeEvidenceBudget,
  prepareAuthorizedEvidence,
  reserveAuthorizedEvidence,
  signedEvidenceInput,
} from "../../../../lib/youcam/evidence-authorization";
import {
  createEvidenceTask,
  type EvidenceFeature,
  listFabricTemplates,
} from "../../../../lib/youcam/evidence-client";
import { RenderAccessError } from "../../../../lib/youcam/authorization";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4_096;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const features: EvidenceFeature[] = ["background_removal", "fabric_vto", "approved_motion"];
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Origin",
};

function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers });
}

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return json({ error: "Untrusted request origin." }, 403);
  let body: { revisionId?: unknown; feature?: unknown; templateId?: unknown };
  try {
    body = await readBoundedJsonBody(request, MAX_BODY_BYTES) as typeof body;
  } catch (error) {
    return json(
      { error: error instanceof RequestBodyTooLargeError ? "Evidence request is too large." : "A valid evidence request is required." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  if (
    typeof body.revisionId !== "string" || !uuid.test(body.revisionId) ||
    typeof body.feature !== "string" || !features.includes(body.feature as EvidenceFeature)
  ) return json({ error: "A valid revision and evidence feature are required." }, 400);

  const feature = body.feature as EvidenceFeature;
  let templateId: string | undefined;
  let templateTitle: string | undefined;
  if (feature === "fabric_vto") {
    if (typeof body.templateId !== "string") return json({ error: "Choose a predefined fabric direction." }, 400);
    const catalog = await listFabricTemplates();
    const template = catalog.templates.find((item) => item.id === body.templateId);
    if (!template) return json({ error: "That fabric direction is not in the current YouCam catalog." }, 400);
    templateId = template.id;
    templateTitle = template.title;
  } else if (body.templateId !== undefined) {
    return json({ error: "A fabric template is valid only for Fabric VTO." }, 400);
  }

  let reservation: Awaited<ReturnType<typeof reserveAuthorizedEvidence>> | undefined;
  try {
    const authorized = await prepareAuthorizedEvidence({
      revisionId: body.revisionId,
      feature,
      templateId,
      templateTitle,
    });
    const sourceUrl = await signedEvidenceInput(authorized);
    reservation = await reserveAuthorizedEvidence(authorized);
    if (!reservation.claimed) {
      return json(
        { jobId: reservation.jobId, status: reservation.status, reused: true },
        reservation.status === "success" ? 200 : 202,
      );
    }

    await consumeEvidenceBudget(reservation.jobId, reservation.attemptNumber);
    const task = await createEvidenceTask({ feature, sourceUrl, templateId });
    const attached = await attachEvidenceTask(reservation.jobId, reservation.attemptNumber, task.taskId);
    if (!attached) throw new Error("Evidence reservation expired before task attachment.");
    return json({ jobId: reservation.jobId, status: "running", reused: false }, 202);
  } catch (error) {
    if (reservation?.claimed && reservation.status === "reserved") {
      await abortEvidenceAttempt(
        reservation.jobId,
        reservation.attemptNumber,
        error instanceof Error ? error.message : "Evidence request failed",
      ).catch((cleanupError) => console.error(
        "Evidence reservation cleanup failed",
        cleanupError instanceof Error ? cleanupError.message : "unknown",
      ));
    }
    if (error instanceof RenderAccessError) return json({ error: error.message }, error.status);
    console.error("YouCam evidence creation failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "We could not start this YouCam evidence step." }, 502);
  }
}
