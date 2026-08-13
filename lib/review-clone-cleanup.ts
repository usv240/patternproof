import "server-only";

import { createSupabaseAdminClient } from "./supabase/server";
import {
  isCanonicalUuid,
  parseReviewCloneCleanupManifest,
} from "./review-clone-cleanup-contract";

const BUCKET = "brief-images";
const MAX_BATCH = 10;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type CleanupClaim = {
  clone_id: unknown;
  cleanup_claim_id: unknown;
  cleanup_object_paths: unknown;
};

export type ReviewCloneCleanupTelemetry = {
  processed: number;
  cleaned: number;
  retryRequired: number;
  invalidManifests: number;
};

async function finish(
  admin: AdminClient,
  cloneId: string,
  claimId: string,
  succeeded: boolean,
  error?: string,
): Promise<boolean> {
  const result = await admin.rpc("complete_review_revision_clone_cleanup", {
    p_clone_id: cloneId,
    p_cleanup_claim_id: claimId,
    p_succeeded: succeeded,
    p_error: error ?? null,
  });
  if (result.error) {
    console.error("Review-clone cleanup completion failed", result.error.message);
    return false;
  }
  return result.data === true;
}

export async function runReviewCloneCleanup(
  admin: AdminClient,
  limit = MAX_BATCH,
): Promise<ReviewCloneCleanupTelemetry> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_BATCH);
  const claimResult = await admin.rpc("claim_review_revision_clone_cleanup", {
    p_limit: boundedLimit,
  });
  if (claimResult.error) throw claimResult.error;

  const telemetry: ReviewCloneCleanupTelemetry = {
    processed: 0,
    cleaned: 0,
    retryRequired: 0,
    invalidManifests: 0,
  };

  for (const claim of (claimResult.data ?? []) as CleanupClaim[]) {
    telemetry.processed += 1;
    const cloneId = isCanonicalUuid(claim.clone_id) ? claim.clone_id : undefined;
    const claimId = isCanonicalUuid(claim.cleanup_claim_id)
      ? claim.cleanup_claim_id
      : undefined;
    const manifest = parseReviewCloneCleanupManifest(claim.cleanup_object_paths);

    if (!cloneId || !claimId || !manifest) {
      telemetry.invalidManifests += 1;
      telemetry.retryRequired += 1;
      if (cloneId && claimId) {
        await finish(
          admin,
          cloneId,
          claimId,
          false,
          "Review-clone cleanup manifest failed canonical validation.",
        );
      } else {
        console.error("Review-clone cleanup claim returned an invalid identity");
      }
      continue;
    }

    let removalError: string | undefined;
    try {
      const removal = await admin.storage.from(BUCKET).remove(manifest.paths);
      if (removal.error) removalError = "Review-clone object cleanup requires retry.";
    } catch {
      removalError = "Review-clone object cleanup requires retry.";
    }

    const completed = await finish(
      admin,
      cloneId,
      claimId,
      !removalError,
      removalError,
    );
    if (!removalError && completed) telemetry.cleaned += 1;
    else telemetry.retryRequired += 1;
  }

  return telemetry;
}
