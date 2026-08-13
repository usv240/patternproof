import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  assertNormalizedBodyPhotoQuality,
  isBodyPhotoGarmentCategory,
} from "../../../../../lib/images/body-photo-quality";
import { ImageValidationError, normalizePrivateImage } from "../../../../../lib/images/normalize";
import { hasReadyIntakeSpec } from "../../../../../lib/intake-maintenance";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";
import {
  isCanonicalRevisionAssetPath,
  revisionStoragePrefix,
} from "../../../../../lib/security/storage-path";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "brief-images";
const MAX_BODY_BYTES = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FinalizeRequest = {
  briefId?: unknown;
  revisionId?: unknown;
  bodyUploadPath?: unknown;
  referenceUploadPath?: unknown;
};

type FinalizationClaim = {
  claim_acquired: boolean;
  intake_state: string;
  issuance_id: string;
  finalization_claim_id: string | null;
  shop_id: string;
  body_path: string;
  reference_path: string;
  raw_body_path: string;
  raw_reference_path: string;
  expires_at: string | null;
  ready_at: string | null;
  raw_cleanup_state: string;
  raw_removed_at: string | null;
  garment_spec: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

async function recordImmediateRemoval(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claim: FinalizationClaim,
  succeeded: boolean,
) {
  if (claim.raw_cleanup_state === "deleted" || claim.raw_cleanup_state === "cleaning") {
    return;
  }
  const attemptedAt = new Date().toISOString();
  const update: Record<string, unknown> = {
    raw_cleanup_state: succeeded ? "removed" : "cleanup_required",
    cleanup_attempted_at: attemptedAt,
    last_error: succeeded ? null : "Private object cleanup requires retry.",
  };
  if (succeeded && !claim.raw_removed_at) update.raw_removed_at = attemptedAt;
  const result = await admin.from("intake_issuance").update(update).eq("id", claim.issuance_id);
  if (result.error) {
    console.error("Intake cleanup state update failed", result.error.message);
  } else {
    claim.raw_cleanup_state = succeeded ? "removed" : "cleanup_required";
    if (succeeded && !claim.raw_removed_at) claim.raw_removed_at = attemptedAt;
  }
}

async function removeRawUploads(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claim: FinalizationClaim,
) {
  const removal = await admin.storage
    .from(BUCKET)
    .remove([claim.raw_body_path, claim.raw_reference_path]);
  await recordImmediateRemoval(admin, claim, !removal.error);
}

async function releaseClaim(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claim: FinalizationClaim,
  message: string,
  rejected = false,
) {
  if (!claim.finalization_claim_id) return null;
  const released = await admin.rpc("release_intake_finalization", {
    p_issuance_id: claim.issuance_id,
    p_finalization_claim_id: claim.finalization_claim_id,
    p_error: message,
    p_rejected: rejected,
  });
  if (released.error) {
    console.error("Intake finalization release failed", released.error.message);
    return null;
  }
  if (typeof released.data !== "string") return null;
  claim.intake_state = released.data;
  claim.finalization_claim_id = null;
  return released.data;
}

async function isReadyInDatabase(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claim: FinalizationClaim,
  revisionId: string,
): Promise<boolean> {
  const [ledgerResult, revisionResult] = await Promise.all([
    admin
      .from("intake_issuance")
      .select("state, ready_at")
      .eq("id", claim.issuance_id)
      .maybeSingle(),
    admin
      .from("revision")
      .select("garment_spec")
      .eq("id", revisionId)
      .maybeSingle(),
  ]);
  return !ledgerResult.error
    && !revisionResult.error
    && ledgerResult.data?.state === "ready"
    && typeof ledgerResult.data.ready_at === "string"
    && hasReadyIntakeSpec(revisionResult.data?.garment_spec);
}

function readyResponse(revisionId: string) {
  return NextResponse.json(
    { ready: true, revisionId },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  if (!isSupabaseConfigured()) return jsonError("Private brief storage is not configured yet.", 503);

  let input: FinalizeRequest;
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES) as FinalizeRequest;
  } catch (error) {
    return jsonError(
      error instanceof RequestBodyTooLargeError
        ? "Intake finalization request is too large."
        : "A valid intake finalization request is required.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
  let claim: FinalizationClaim | undefined;
  let revisionId: string | undefined;

  try {

    if (!isUuid(input.briefId) || !isUuid(input.revisionId)) {
      return jsonError("Invalid intake session.", 400);
    }
    revisionId = input.revisionId;

    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return jsonError("Sign in to finish this upload.", 401);
    }

    admin = createSupabaseAdminClient();
    const claimResult = await admin
      .rpc("claim_intake_finalization", {
        p_owner_id: userResult.data.user.id,
        p_brief_id: input.briefId,
        p_revision_id: input.revisionId,
      })
      .maybeSingle();
    if (claimResult.error) throw claimResult.error;
    if (!claimResult.data) return jsonError("Intake session not found.", 404);
    claim = claimResult.data as FinalizationClaim;

    const prefix = revisionStoragePrefix(claim.shop_id, input.briefId, input.revisionId);
    const pathsMatch = Boolean(
      prefix
      && isCanonicalRevisionAssetPath(claim.body_path, prefix, "body")
      && isCanonicalRevisionAssetPath(claim.reference_path, prefix, "reference")
      && input.bodyUploadPath === claim.raw_body_path
      && input.referenceUploadPath === claim.raw_reference_path
    );
    if (!pathsMatch) {
      if (claim.claim_acquired) {
        await releaseClaim(admin, claim, "Client upload paths failed intake integrity checks.");
      }
      return jsonError("Upload paths do not match this intake issuance.", 400);
    }

    if (claim.intake_state === "ready") {
      await removeRawUploads(admin, claim);
      return readyResponse(input.revisionId);
    }
    if (claim.intake_state === "expired") {
      return jsonError("This intake upload session has expired.", 410);
    }
    if (!claim.claim_acquired || !claim.finalization_claim_id) {
      return jsonError(
        claim.intake_state === "finalizing"
          ? "This intake is already being finalized."
          : "This intake session cannot be finalized.",
        409,
      );
    }

    const [bodyDownload, referenceDownload] = await Promise.all([
      admin.storage.from(BUCKET).download(claim.raw_body_path),
      admin.storage.from(BUCKET).download(claim.raw_reference_path),
    ]);
    if (bodyDownload.error || referenceDownload.error || !bodyDownload.data || !referenceDownload.data) {
      await releaseClaim(admin, claim, "Both private uploads were not present.");
      return jsonError("Both private uploads must finish before validation.", 409);
    }

    const [bodyImage, referenceImage] = await Promise.all([
      normalizePrivateImage(bodyDownload.data),
      normalizePrivateImage(referenceDownload.data),
    ]);
    const expectedSpec = claim.garment_spec && typeof claim.garment_spec === "object"
      && !Array.isArray(claim.garment_spec)
      ? claim.garment_spec as Record<string, unknown>
      : {};
    if (!isBodyPhotoGarmentCategory(expectedSpec.category)) {
      throw new ImageValidationError("Choose a supported garment category and try again.");
    }
    const bodyQuality = await assertNormalizedBodyPhotoQuality(bodyImage, expectedSpec.category);

    const [bodyStored, referenceStored] = await Promise.all([
      admin.storage.from(BUCKET).upload(claim.body_path, bodyImage.bytes, {
        contentType: bodyImage.contentType,
        cacheControl: "0",
        upsert: true,
      }),
      admin.storage.from(BUCKET).upload(claim.reference_path, referenceImage.bytes, {
        contentType: referenceImage.contentType,
        cacheControl: "0",
        upsert: true,
      }),
    ]);
    if (bodyStored.error || referenceStored.error) {
      throw bodyStored.error ?? referenceStored.error ?? new Error("Canonical upload failed");
    }

    const normalizedImages = {
      body: {
        width: bodyImage.width,
        height: bodyImage.height,
        format: "jpeg",
        sha256: createHash("sha256").update(bodyImage.bytes).digest("hex"),
        quality: {
          grayscale_mean: Math.round(bodyQuality.grayscaleMean * 10) / 10,
          portrait_ratio: Math.round((bodyImage.height / bodyImage.width) * 100) / 100,
        },
      },
      reference: {
        width: referenceImage.width,
        height: referenceImage.height,
        format: "jpeg",
        sha256: createHash("sha256").update(referenceImage.bytes).digest("hex"),
      },
    };
    const committed = await admin
      .rpc("commit_intake_finalization", {
        p_issuance_id: claim.issuance_id,
        p_finalization_claim_id: claim.finalization_claim_id,
        p_expected_garment_spec: expectedSpec,
        p_normalized_images: normalizedImages,
      })
      .maybeSingle();

    const commitData = committed.data as { committed?: boolean } | null;
    const commitAcknowledged = !committed.error && commitData?.committed === true;
    if (!commitAcknowledged && !(await isReadyInDatabase(admin, claim, input.revisionId))) {
      await releaseClaim(admin, claim, "Atomic intake commit was not acknowledged.");
      throw committed.error ?? new Error("Atomic intake commit was not acknowledged");
    }

    claim.intake_state = "ready";
    claim.finalization_claim_id = null;
    await removeRawUploads(admin, claim);
    return readyResponse(input.revisionId);
  } catch (error) {
    if (admin && claim && revisionId) {
      if (error instanceof ImageValidationError) {
        const released = await releaseClaim(admin, claim, error.message, true);
        if (released === "rejected") {
          await removeRawUploads(admin, claim);
          return jsonError(error.message, 400);
        }
        console.error("Rejected intake could not be durably recorded; raw uploads retained");
        return jsonError("We could not record the image rejection safely. Please retry.", 500);
      }

      if (await isReadyInDatabase(admin, claim, revisionId)) {
        claim.intake_state = "ready";
        claim.finalization_claim_id = null;
        await removeRawUploads(admin, claim);
        return readyResponse(revisionId);
      }
      await releaseClaim(
        admin,
        claim,
        error instanceof Error ? error.message : "Intake finalization failed.",
      );
    }
    console.error("Intake finalization failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not validate the private uploads.", 500);
  }
}