import { NextRequest, NextResponse } from "next/server";

import {
  isStrictUuid,
  PRIVATE_NO_STORE_HEADERS,
} from "../../../../../lib/brief-workspace";
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

const BUCKET = "brief-images";

type ErasureClaim = {
  erasure_id: string;
  shop_id: string;
  brief_id: string;
  revision_id: string;
  body_path: string;
  erasure_status: string;
  claim_id: string | null;
  completed_at: string | null;
};

function json(payload: object, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return json({ error: "Untrusted request origin." }, 403);
  if (!isSupabaseConfigured()) return json({ error: "Photo erasure is not configured yet." }, 503);

  const { briefId } = await params;
  if (!isStrictUuid(briefId)) return json({ error: "Brief not found." }, 404);

  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
  let activeClaim: ErasureClaim | undefined;

  try {
    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return json({ error: "Sign in to erase this customer photo." }, 401);
    }

    // This authenticated RLS query is the authorization boundary. The service
    // client is created only after ownership of the exact brief is proven.
    const owned = await supabase
      .from("brief")
      .select("id, status, approved_revision_id")
      .eq("id", briefId)
      .maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return json({ error: "Brief not found." }, 404);
    if (
      !["approved", "archived"].includes(String(owned.data.status)) ||
      !isStrictUuid(owned.data.approved_revision_id)
    ) {
      return json({ error: "The customer photo can be erased after approval." }, 409);
    }

    admin = createSupabaseAdminClient();
    const claimResult = await admin.rpc("claim_body_photo_erasure", {
      p_brief_id: briefId,
    });
    if (claimResult.error) {
      if (["42501", "55000", "P0001"].includes(claimResult.error.code ?? "")) {
        return json({ error: "Photo erasure is already running or no longer eligible." }, 409);
      }
      throw claimResult.error;
    }

    const claim = (Array.isArray(claimResult.data)
      ? claimResult.data[0]
      : claimResult.data) as ErasureClaim | undefined;
    activeClaim = claim;
    if (
      !claim ||
      claim.brief_id !== briefId ||
      claim.revision_id !== owned.data.approved_revision_id ||
      !isStrictUuid(claim.erasure_id) ||
      !isStrictUuid(claim.shop_id)
    ) {
      throw new Error("Erasure claim returned an invalid identity.");
    }
    if (claim.erasure_status === "completed") {
      return json({
        erased: true,
        revisionId: claim.revision_id,
        erasedAt: claim.completed_at,
        idempotent: true,
      });
    }
    if (!isStrictUuid(claim.claim_id)) {
      throw new Error("Erasure claim did not include a lease.");
    }

    const prefix = revisionStoragePrefix(claim.shop_id, briefId, claim.revision_id);
    if (!prefix || !isCanonicalRevisionAssetPath(claim.body_path, prefix, "body")) {
      throw new Error("Erasure path failed canonical ownership validation.");
    }

    const removal = await admin.storage.from(BUCKET).remove([claim.body_path]);
    const completion = await admin.rpc("complete_body_photo_erasure", {
      p_erasure_id: claim.erasure_id,
      p_claim_id: claim.claim_id,
      p_succeeded: !removal.error,
      p_error: removal.error ? "Body-photo object cleanup requires retry." : null,
    });
    if (completion.error || completion.data !== true) {
      throw completion.error ?? new Error("Erasure completion lease was lost.");
    }
    activeClaim = undefined;
    if (removal.error) {
      console.error("Body-photo object removal failed", removal.error.message);
      return json({ error: "Photo erasure is queued for retry." }, 503);
    }

    return json({
      erased: true,
      revisionId: claim.revision_id,
      erasedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (
      admin &&
      activeClaim &&
      isStrictUuid(activeClaim.erasure_id) &&
      isStrictUuid(activeClaim.claim_id)
    ) {
      const released = await admin.rpc("complete_body_photo_erasure", {
        p_erasure_id: activeClaim.erasure_id,
        p_claim_id: activeClaim.claim_id,
        p_succeeded: false,
        p_error: "Body-photo erasure requires a secure retry.",
      });
      if (released.error) {
        console.error("Body-photo erasure lease release failed", released.error.message);
      }
    }
    console.error("Body-photo erasure failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "We could not complete photo erasure." }, 500);
  }
}
