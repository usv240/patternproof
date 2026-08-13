import { NextRequest, NextResponse } from "next/server";

import { isStrictUuid } from "../../../../../lib/brief-workspace";
import {
  readBoundedJsonBody,
  RequestBodyTooLargeError,
} from "../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";
import { hashShareToken, isPlausibleShareToken } from "../../../../../lib/security/share-token";
import { isPublicDemoToken } from "../../../../../lib/public-demo-token";
import { isSnapshotSha256 } from "../../../../../lib/review-snapshot";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_000;
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

type ChangeRequestRow = {
  request_id: string;
  brief_id: string;
  revision_id: string;
  source_version: number;
  snapshot_sha256: string;
  reason: string;
  state: string;
  created_at: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return error("Untrusted request origin.", 403);

  const { token } = await params;
  if (isPublicDemoToken(token)) return error("The public demo is read-only.", 403);
  if (!isPlausibleShareToken(token)) return error("This review link is invalid or expired.", 404);
  if (!isSupabaseAdminConfigured()) return error("Change requests are not configured yet.", 503);

  let input: { revisionId?: unknown; snapshotSha256?: unknown; reason?: unknown };
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES) as typeof input;
  } catch (caught) {
    return error(
      "Invalid change request.",
      caught instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (
    !isStrictUuid(input.revisionId) ||
    !isSnapshotSha256(input.snapshotSha256) ||
    reason.length < 5 ||
    reason.length > 1_000
  ) {
    return error("Describe the requested change in 5 to 1000 characters.", 400);
  }

  try {
    const admin = createSupabaseAdminClient();
    const result = await admin
      .rpc("request_shared_revision_change", {
        p_share_token_hash: hashShareToken(token),
        p_shared_revision_id: input.revisionId,
        p_shared_snapshot_sha256: input.snapshotSha256,
        p_reason: reason,
      })
      .maybeSingle();
    if (result.error) {
      if (["22023", "P0001"].includes(result.error.code ?? "")) {
        return error("This review changed or is no longer available.", 409);
      }
      throw result.error;
    }
    const row = result.data as ChangeRequestRow | null;
    if (
      !row ||
      !isStrictUuid(row.request_id) ||
      row.revision_id !== input.revisionId ||
      row.snapshot_sha256 !== input.snapshotSha256 ||
      row.state !== "open"
    ) {
      throw new Error("Change request receipt failed identity checks.");
    }
    return NextResponse.json(
      {
        requested: true,
        request: {
          id: row.request_id,
          revisionId: row.revision_id,
          sourceVersion: row.source_version,
          snapshotSha256: row.snapshot_sha256,
          reason: row.reason,
          state: row.state,
          createdAt: row.created_at,
        },
      },
      { headers },
    );
  } catch (caught) {
    console.error(
      "Customer change request failed",
      caught instanceof Error ? caught.message : "unknown",
    );
    return error("We could not record this change request.", 500);
  }
}
