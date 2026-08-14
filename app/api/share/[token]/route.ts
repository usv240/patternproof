import { NextRequest, NextResponse } from "next/server";

import {
  classifyShareReadRequest,
  PUBLIC_DEMO_PAYLOAD,
} from "../../../../lib/public-demo";
import {
  isSnapshotSha256,
  parseFrozenReviewSnapshot,
} from "../../../../lib/review-snapshot";
import { hashShareToken } from "../../../../lib/security/share-token";
import {
  isCanonicalFrozenReferencePath,
  isCanonicalFrozenRenderPath,
  revisionStoragePrefix,
} from "../../../../lib/security/storage-path";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../../../../lib/supabase/server";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const publicDemoHeaders = {
  ...privateHeaders,
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  "X-PatternProof-Mode": "public-demo",
};

const notFound = () =>
  NextResponse.json(
    { error: "This share link is invalid or expired." },
    { status: 404, headers: privateHeaders },
  );

async function signedUrl(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  path: string,
) {
  const { data, error } = await supabase.storage
    .from("brief-images")
    .createSignedUrl(path, 5 * 60);
  if (error || !data) throw error ?? new Error("Signed URL missing");
  return data.signedUrl;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const disposition = classifyShareReadRequest(token, isSupabaseAdminConfigured());

  if (disposition === "public_demo") {
    return NextResponse.json(PUBLIC_DEMO_PAYLOAD, { headers: publicDemoHeaders });
  }
  if (disposition === "invalid_token") return notFound();
  if (disposition === "sharing_unconfigured") {
    return NextResponse.json(
      { error: "Customer sharing is not configured yet." },
      { status: 503, headers: privateHeaders },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: brief, error: briefError } = await supabase
      .from("brief")
      .select(
        "id, shop_id, status, token_expires_at, approved_revision_id, shared_revision_id, shared_snapshot, shared_snapshot_sha256, share_token_revoked_at",
      )
      .eq("share_token_hash", hashShareToken(token))
      .gt("token_expires_at", new Date().toISOString())
      .is("share_token_revoked_at", null)
      .in("status", ["awaiting_customer", "approved"])
      .maybeSingle();
    if (briefError) throw briefError;
    if (!brief) return notFound();

    const revisionId = typeof brief.shared_revision_id === "string"
      ? brief.shared_revision_id
      : "";
    const digest = brief.shared_snapshot_sha256;
    if (!isSnapshotSha256(digest)) throw new Error("Shared snapshot digest is invalid.");
    if (brief.approved_revision_id && brief.approved_revision_id !== revisionId) {
      throw new Error("Approved revision does not match the customer-visible snapshot.");
    }

    const snapshot = parseFrozenReviewSnapshot(brief.shared_snapshot, {
      shopId: String(brief.shop_id),
      briefId: String(brief.id),
      revisionId,
    });
    if (!snapshot) throw new Error("Shared review snapshot failed validation.");

    const prefix = revisionStoragePrefix(
      String(brief.shop_id),
      String(brief.id),
      snapshot.revision.id,
    );
    const referencePath = snapshot.revision.reference_path;
    const renderPath = snapshot.revision.render_path;
    if (
      !prefix ||
      !isCanonicalFrozenReferencePath(referencePath, prefix) ||
      !isCanonicalFrozenRenderPath(renderPath, prefix)
    ) {
      throw new Error("Shared revision asset path failed ownership checks.");
    }

    const changeRequestResult = await supabase
      .from("customer_change_request")
      .select("id, revision_id, source_version, snapshot_sha256, reason, state, created_at")
      .eq("brief_id", brief.id)
      .eq("revision_id", revisionId)
      .eq("snapshot_sha256", digest)
      .eq("state", "open")
      .maybeSingle();
    if (changeRequestResult.error) throw changeRequestResult.error;

    const [referenceUrl, renderUrl] = await Promise.all([
      signedUrl(supabase, referencePath),
      signedUrl(supabase, renderPath),
    ]);

    return NextResponse.json(
      {
        brief: {
          id: brief.id,
          shop_name: snapshot.shop.name,
          customer_label: snapshot.brief.customer_label,
          status: brief.status,
          token_expires_at: brief.token_expires_at,
          approved_revision_id: brief.approved_revision_id,
          snapshot_sha256: digest,
        },
        revision: {
          id: snapshot.revision.id,
          version: snapshot.revision.version,
          category: snapshot.revision.category,
          created_at: snapshot.revision.created_at,
          reference_sha256: snapshot.revision.reference_sha256,
          render_sha256: snapshot.revision.render_sha256,
          evidence: snapshot.revision.evidence,
          locked: brief.status === "approved",
          referenceUrl,
          renderUrl,
          requirements: snapshot.requirements,
          annotations: snapshot.annotations,
        },
        consent: snapshot.consent,
        changeRequest: changeRequestResult.data ? {
          id: String(changeRequestResult.data.id),
          revisionId: String(changeRequestResult.data.revision_id),
          sourceVersion: Number(changeRequestResult.data.source_version),
          snapshotSha256: String(changeRequestResult.data.snapshot_sha256),
          reason: String(changeRequestResult.data.reason),
          state: String(changeRequestResult.data.state),
          createdAt: String(changeRequestResult.data.created_at),
        } : null,
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    console.error(
      "Share-link resolution failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { error: "We could not load this brief." },
      { status: 500, headers: privateHeaders },
    );
  }
}