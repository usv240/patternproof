import { NextRequest, NextResponse } from "next/server";

import { runBodyPhotoErasureCleanup } from "../../../../lib/body-photo-erasure";
import {
  hasValidMaintenanceAuthorization,
  hasValidMaintenanceSecret,
} from "../../../../lib/intake-maintenance";
import { runReviewCloneCleanup } from "../../../../lib/review-clone-cleanup";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "brief-images";
const BATCH_SIZE = 15;
const MAX_INTAKE_CLAIMS = 100;
const INTAKE_DRAIN_BUDGET_MS = 35_000;
const SECONDARY_CLEANUP_BATCH = 10;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

type CleanupClaim = {
  issuance_id: string;
  cleanup_claim_id: string;
  cleanup_object_paths: string[];
  state: string;
  expires_at: string | null;
};

type Reconciliation = {
  reconciled: boolean;
  ready: boolean;
  draft_deleted: boolean;
  cleanup_object_paths: string[];
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: NO_STORE_HEADERS },
  );
}

async function finishClaim(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claim: CleanupClaim,
  succeeded: boolean,
  error?: string,
): Promise<boolean> {
  const completed = await admin.rpc("complete_intake_cleanup", {
    p_issuance_id: claim.issuance_id,
    p_cleanup_claim_id: claim.cleanup_claim_id,
    p_succeeded: succeeded,
    p_error: error ?? null,
  });
  if (completed.error) {
    console.error("Intake cleanup completion failed", completed.error.message);
    return false;
  }
  return completed.data === true;
}

async function cleanup(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!hasValidMaintenanceSecret(cronSecret) || !isSupabaseAdminConfigured()) {
    return jsonError("Intake maintenance is not configured.", 503);
  }
  if (!hasValidMaintenanceAuthorization(request.headers.get("authorization"), cronSecret)) {
    return jsonError("Unauthorized.", 401);
  }

  const admin = createSupabaseAdminClient();
  const drainStartedAt = Date.now();
  let processed = 0;
  let cleaned = 0;
  let cleanupRequired = 0;
  let expiredDraftsDeleted = 0;
  let readyIntakesReconciled = 0;
  let drained = false;

  while (
    processed < MAX_INTAKE_CLAIMS
    && Date.now() - drainStartedAt < INTAKE_DRAIN_BUDGET_MS
  ) {
    const claimResult = await admin.rpc("claim_intake_cleanup", {
      p_limit: Math.min(BATCH_SIZE, MAX_INTAKE_CLAIMS - processed),
    });
    if (claimResult.error) {
      console.error("Intake cleanup claim failed", claimResult.error.message);
      return jsonError("Intake maintenance failed.", 500);
    }

    const claims = (claimResult.data ?? []) as CleanupClaim[];
    if (!claims.length) {
      drained = true;
      break;
    }

    for (const claim of claims) {
      processed += 1;
      const reconciliationResult = await admin
        .rpc("reconcile_claimed_intake_cleanup", {
          p_issuance_id: claim.issuance_id,
          p_cleanup_claim_id: claim.cleanup_claim_id,
        })
        .maybeSingle();
      const reconciliationData = reconciliationResult.data as Reconciliation | null;
      if (
        reconciliationResult.error
        || !reconciliationData
        || reconciliationData.reconciled !== true
      ) {
        if (reconciliationResult.error) {
          console.error("Intake cleanup reconciliation failed", reconciliationResult.error.message);
        }
        cleanupRequired += 1;
        await finishClaim(
          admin,
          claim,
          false,
          "Atomic intake cleanup reconciliation requires retry.",
        );
        continue;
      }

      const exactPaths = [...new Set(reconciliationData.cleanup_object_paths ?? [])];
      const removal = exactPaths.length
        ? await admin.storage.from(BUCKET).remove(exactPaths)
        : { error: null };
      const succeeded = !removal.error;
      const completed = await finishClaim(
        admin,
        claim,
        succeeded,
        succeeded ? undefined : "Private object cleanup requires retry.",
      );
      if (succeeded && completed) {
        cleaned += 1;
        if (reconciliationData.draft_deleted) expiredDraftsDeleted += 1;
        if (reconciliationData.ready) readyIntakesReconciled += 1;
      } else {
        cleanupRequired += 1;
      }
    }
  }

  const intakeDrainDurationMs = Date.now() - drainStartedAt;

  let reviewCloneCleanup;
  let reviewCloneCleanupFailed = false;
  try {
    reviewCloneCleanup = await runReviewCloneCleanup(admin, SECONDARY_CLEANUP_BATCH);
  } catch (error) {
    reviewCloneCleanupFailed = true;
    console.error(
      "Review-clone maintenance failed",
      error instanceof Error ? error.message : "unknown",
    );
  }

  let bodyPhotoErasure;
  try {
    bodyPhotoErasure = await runBodyPhotoErasureCleanup(admin, SECONDARY_CLEANUP_BATCH);
  } catch (error) {
    console.error(
      "Body-photo erasure maintenance failed",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("Privacy maintenance failed.", 500);
  }

  if (reviewCloneCleanupFailed) {
    return jsonError("Review maintenance failed.", 500);
  }

  return NextResponse.json(
    {
      processed,
      cleaned,
      cleanupRequired,
      expiredDraftsDeleted,
      readyIntakesReconciled,
      drained,
      intakeDrainDurationMs,
      reviewCloneCleanup,
      bodyPhotoErasure,
      maintenanceDurationMs: Date.now() - drainStartedAt,
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  return cleanup(request);
}

export async function POST(request: NextRequest) {
  return cleanup(request);
}