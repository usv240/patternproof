import { NextRequest, NextResponse } from "next/server";

import { isLockedMutationError, isStrictUuid, PRIVATE_NO_STORE_HEADERS } from "../../../../../../lib/brief-workspace";
import { hasTrustedMutationOrigin } from "../../../../../../lib/security/request-origin";
import { createSupabaseServerClient, isSupabaseAuthConfigured } from "../../../../../../lib/supabase/server";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string; annotationId: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  const { briefId, annotationId } = await params;
  if (!isStrictUuid(briefId) || !isStrictUuid(annotationId)) return jsonError("Invalid pinned note.", 400);
  if (!isSupabaseAuthConfigured()) return jsonError("Private brief storage is not configured yet.", 503);
  try {
    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) return jsonError("Sign in to update this brief.", 401);
    const revisionResult = await supabase
      .from("revision")
      .select("id, brief!inner(status)")
      .eq("brief_id", briefId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionResult.error) throw revisionResult.error;
    if (!revisionResult.data) return jsonError("Brief or revision not found.", 404);
    const briefRelation = revisionResult.data.brief as unknown as { status?: unknown } | Array<{ status?: unknown }>;
    const status = Array.isArray(briefRelation) ? briefRelation[0]?.status : briefRelation?.status;
    if (["awaiting_customer", "approved", "archived"].includes(String(status))) {
      return jsonError("A revision under customer review cannot be changed.", 409);
    }
    const removed = await supabase
      .from("annotation")
      .delete()
      .eq("id", annotationId)
      .eq("revision_id", revisionResult.data.id)
      .select("id")
      .maybeSingle();
    if (removed.error) {
      if (isLockedMutationError(removed.error)) return jsonError("This pinned note is frozen.", 409);
      throw removed.error;
    }
    if (!removed.data) return jsonError("Pinned note not found.", 404);
    return new NextResponse(null, { status: 204, headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("Annotation deletion failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not remove this pinned note.", 500);
  }
}
