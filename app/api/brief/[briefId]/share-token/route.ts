import { NextRequest, NextResponse } from "next/server";

import { isSnapshotSha256 } from "../../../../../lib/review-snapshot";

import { isTrustedBrowserOrigin, resolveAppOrigin } from "../../../../../lib/security/app-origin";
import { generateShareToken, hashShareToken } from "../../../../../lib/security/share-token";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Origin",
};

function json(payload: object, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: PRIVATE_HEADERS });
}

function trustedRequestOrigin(request: NextRequest): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;

  try {
    const appOrigin = resolveAppOrigin({
      configuredUrl: process.env.APP_URL,
      nodeEnv: process.env.NODE_ENV,
      requestOrigin: request.nextUrl.origin,
    });
    return isTrustedBrowserOrigin(suppliedOrigin, appOrigin, process.env.NODE_ENV);
  } catch (error) {
    console.error(
      "Share-token origin configuration is invalid",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) {
  if (!trustedRequestOrigin(request)) return json({ error: "Untrusted request origin." }, 403);
  if (!isSupabaseConfigured()) return json({ error: "Customer sharing is not configured yet." }, 503);

  const { briefId } = await params;
  if (!UUID.test(briefId)) return json({ error: "Brief not found." }, 404);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sign in to share this brief." }, 401);

    // This query runs with the user's session and RLS. A service-role client is
    // deliberately not created until ownership and the latest revision are proven.
    const { data: brief, error: briefError } = await supabase
      .from("brief")
      .select("id, status, approved_revision_id")
      .eq("id", briefId)
      .maybeSingle();
    if (briefError) throw briefError;
    if (!brief) return json({ error: "Brief not found." }, 404);

    if (brief.status === "approved" || brief.status === "archived" || brief.approved_revision_id) {
      return json({ error: "Approved or archived Cut Cards cannot be shared as a new approval request." }, 409);
    }

    const { data: latestRevision, error: revisionError } = await supabase
      .from("revision")
      .select("id, version, locked_at")
      .eq("brief_id", brief.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionError) throw revisionError;
    if (!latestRevision || latestRevision.locked_at) {
      return json({ error: "Create an unlocked revision before sharing." }, 409);
    }

    const admin = createSupabaseAdminClient();
    const { data: revisionAtRotation, error: latestError } = await admin
      .from("revision")
      .select("id, locked_at")
      .eq("brief_id", brief.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    if (
      !revisionAtRotation ||
      revisionAtRotation.id !== latestRevision.id ||
      revisionAtRotation.locked_at
    ) {
      return json({ error: "This brief changed before it could be shared. Refresh and try again." }, 409);
    }

    const { data: canApprove, error: readinessError } = await admin.rpc(
      "can_approve_revision",
      { p_revision_id: latestRevision.id },
    );
    if (readinessError) throw readinessError;
    if (canApprove !== true) {
      return json(
        { error: "Complete the render, consent, requirements, and feasible tailor decisions before sharing." },
        409,
      );
    }

    const token = generateShareToken();
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
    const { data: reviewData, error: reviewError } = await admin.rpc(
      "start_customer_review",
      {
        p_brief_id: brief.id,
        p_revision_id: latestRevision.id,
        p_share_token_hash: hashShareToken(token),
        p_expires_at: expiresAt,
      },
    );
    if (reviewError) throw reviewError;
    const review = Array.isArray(reviewData) ? reviewData[0] : reviewData;
    if (
      !review ||
      !UUID.test(String(review.review_session_id)) ||
      review.shared_revision_id !== latestRevision.id ||
      !isSnapshotSha256(review.shared_snapshot_sha256)
    ) {
      throw new Error("Review start returned an invalid snapshot proof.");
    }

    return json({
      sharePath: `/s/${token}`,
      expiresAt: review.token_expires_at,
      revisionId: latestRevision.id,
      reviewSessionId: review.review_session_id,
      snapshotSha256: review.shared_snapshot_sha256,
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (["42501", "22023", "P0001", "23505"].includes(code)) {
      return json(
        { error: "This brief changed or no longer satisfies the customer-review gate." },
        409,
      );
    }
    console.error("Customer-review start failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "We could not create a customer approval link." }, 500);
  }
}
