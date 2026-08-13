import { NextRequest, NextResponse } from "next/server";

import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../lib/security/request-origin";
import { createClothesRender } from "../../../../lib/youcam/client";
import {
  attachReservedRenderTask,
  consumeReservedRenderBudget,
  abortReservedRenderAttempt,
  prepareAuthorizedRender,
  RenderAccessError,
  reserveAuthorizedRender,
  signedRenderInputs,
} from "../../../../lib/youcam/authorization";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4_096;

const categories = ["auto", "full_body", "upper_body", "lower_body"] as const;
type Category = (typeof categories)[number];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Origin",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);

  let input: { revisionId?: unknown; garmentCategory?: unknown };
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES) as typeof input;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError("Render request is too large.", 413);
    }
    return jsonError("A valid render request is required.", 400);
  }

  if (
    typeof input.revisionId !== "string" ||
    !uuid.test(input.revisionId) ||
    !categories.includes(input.garmentCategory as Category)
  ) {
    return jsonError("A valid revision and garment category are required.", 400);
  }

  let authorized: Awaited<ReturnType<typeof prepareAuthorizedRender>> | undefined;
  let reservation: Awaited<ReturnType<typeof reserveAuthorizedRender>> | undefined;

  try {
    authorized = await prepareAuthorizedRender(input.revisionId);
    const signed = await signedRenderInputs(authorized);
    reservation = await reserveAuthorizedRender(
      authorized,
      input.garmentCategory as Category,
    );

    if (!reservation.reserved) {
      return NextResponse.json(
        {
          jobId: reservation.jobId,
          status: reservation.status,
          reused: true,
        },
        { status: reservation.status === "success" ? 200 : 202, headers: privateHeaders },
      );
    }

    await consumeReservedRenderBudget({
      jobId: reservation.jobId,
      attemptNumber: reservation.attemptNumber,
    });
    const vendorTask = await createClothesRender({
      sourceImageUrl: signed.sourceImageUrl,
      referenceImageUrl: signed.referenceImageUrl,
      garmentCategory: input.garmentCategory as Category,
    });
    const attached = await attachReservedRenderTask({
      jobId: reservation.jobId,
      attemptNumber: reservation.attemptNumber,
      vendorTaskId: vendorTask.jobId,
    });
    if (!attached) {
      throw new Error("The render reservation expired before the vendor task was attached.");
    }

    return NextResponse.json(
      { jobId: reservation.jobId, status: "running", reused: false },
      { status: 202, headers: privateHeaders },
    );
  } catch (error) {
    if (authorized && reservation?.reserved) {
      try {
        await abortReservedRenderAttempt({
          jobId: reservation.jobId,
          attemptNumber: reservation.attemptNumber,
        });
      } catch (markError) {
        console.error(
          "Render reservation cleanup failed",
          markError instanceof Error ? markError.message : "unknown",
        );
      }
    }

    if (error instanceof RenderAccessError) {
      return jsonError(error.message, error.status);
    }
    console.error(
      "YouCam render creation failed",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("We could not start this preview.", 502);
  }
}
