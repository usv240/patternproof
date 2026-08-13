import { NextRequest, NextResponse } from "next/server";

import { isStrictUuid } from "../../../../../lib/brief-workspace";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../lib/security/bounded-json";
import { isPublicDemoToken } from "../../../../../lib/public-demo-token";
import { isSnapshotSha256 } from "../../../../../lib/review-snapshot";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";
import {
  hashShareToken,
  isPlausibleShareToken,
} from "../../../../../lib/security/share-token";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_000;

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

type ApprovalRow = {
  brief_id: string;
  revision_id: string;
  approval_id: string;
  approval_snapshot_sha256: string;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return error("Untrusted request origin.", 403);

  const { token } = await params;
  if (isPublicDemoToken(token)) return error("The public demo is read-only.", 403);
  if (!isPlausibleShareToken(token)) {
    return error("This approval link is invalid or expired.", 404);
  }
  if (!isSupabaseAdminConfigured()) return error("Approval is not configured yet.", 503);

  let revisionId: unknown;
  let snapshotSha256: unknown;
  let acknowledgedAdjustmentIds: unknown;
  try {
    const body = await readBoundedJsonBody(request, MAX_BODY_BYTES) as {
      revisionId?: unknown;
      snapshotSha256?: unknown;
      acknowledgedAdjustmentIds?: unknown;
    };
    revisionId = body.revisionId;
    snapshotSha256 = body.snapshotSha256;
    acknowledgedAdjustmentIds = body.acknowledgedAdjustmentIds;
  } catch (caught) {
    return error(
      "Invalid approval request.",
      caught instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  if (
    !isStrictUuid(revisionId) ||
    !isSnapshotSha256(snapshotSha256) ||
    !Array.isArray(acknowledgedAdjustmentIds) ||
    acknowledgedAdjustmentIds.some((id) => !isStrictUuid(id)) ||
    new Set(acknowledgedAdjustmentIds).size !== acknowledgedAdjustmentIds.length
  ) {
    return error("This approval link is invalid or expired.", 404);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const tokenHash = hashShareToken(token);
    const frozen = await supabase
      .from("brief")
      .select("shared_snapshot, shared_revision_id, shared_snapshot_sha256, approved_revision_id, status")
      .eq("share_token_hash", tokenHash)
      .eq("shared_revision_id", revisionId)
      .eq("shared_snapshot_sha256", snapshotSha256)
      .in("status", ["awaiting_customer", "approved"])
      .gt("token_expires_at", new Date().toISOString())
      .is("share_token_revoked_at", null)
      .maybeSingle();
    if (frozen.error || !frozen.data) {
      return error("This approval is stale, already used, or no longer valid.", 409);
    }
    const snapshot = frozen.data.shared_snapshot as {
      requirements?: Array<{ id?: unknown; feasibility?: { status?: unknown } | null }>;
    } | null;
    const requiredAdjustments = (snapshot?.requirements ?? [])
      .filter((requirement) => requirement.feasibility?.status === "with_adjustment")
      .map((requirement) => requirement.id)
      .filter(isStrictUuid)
      .sort();
    const acknowledged = [...acknowledgedAdjustmentIds].sort();
    if (
      requiredAdjustments.length !== acknowledged.length ||
      requiredAdjustments.some((id, index) => id !== acknowledged[index])
    ) {
      return error("Confirm every tailor adjustment before approving.", 409);
    }
    if (frozen.data.status === "approved" && frozen.data.approved_revision_id === revisionId) {
      return NextResponse.json(
        { approved: true, revisionId, snapshotSha256, idempotent: true },
        { headers: privateHeaders },
      );
    }
    const { data, error: approvalError } = await supabase.rpc(
      "approve_shared_revision",
      {
        p_share_token_hash: tokenHash,
        p_shared_revision_id: revisionId,
        p_shared_snapshot_sha256: snapshotSha256,
      },
    );

    if (approvalError) {
      const raced = await supabase
        .from("brief")
        .select("approved_revision_id, shared_revision_id, shared_snapshot_sha256, status")
        .eq("share_token_hash", tokenHash)
        .gt("token_expires_at", new Date().toISOString())
        .is("share_token_revoked_at", null)
        .maybeSingle();
      if (
        !raced.error &&
        raced.data?.status === "approved" &&
        raced.data.approved_revision_id === revisionId &&
        raced.data.shared_revision_id === revisionId &&
        raced.data.shared_snapshot_sha256 === snapshotSha256
      ) {
        return NextResponse.json(
          { approved: true, revisionId, snapshotSha256, idempotent: true },
          { headers: privateHeaders },
        );
      }

      if (["42501", "22023", "P0001"].includes(approvalError.code ?? "")) {
        return error("This approval is stale, already used, or no longer valid.", 409);
      }
      throw approvalError;
    }

    const approval = (Array.isArray(data) ? data[0] : data) as ApprovalRow | undefined;
    if (
      !approval ||
      approval.revision_id !== revisionId ||
      !isSnapshotSha256(approval.approval_snapshot_sha256)
    ) {
      throw new Error("Approval RPC returned an invalid proof.");
    }

    return NextResponse.json(
      {
        approved: true,
        revisionId: approval.revision_id,
        approvalId: approval.approval_id,
        snapshotSha256,
        approvalSnapshotSha256: approval.approval_snapshot_sha256,
      },
      { headers: privateHeaders },
    );
  } catch (caught) {
    console.error(
      "Customer approval failed",
      caught instanceof Error ? caught.message : "unknown",
    );
    return error("We could not approve this Cut Card.", 500);
  }
}