import { NextRequest, NextResponse } from "next/server";

import {
  isLockedMutationError,
  isStrictUuid,
  parseAnnotationInput,
  PRIVATE_NO_STORE_HEADERS,
} from "../../../../../lib/brief-workspace";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";
import { createSupabaseServerClient, isSupabaseAuthConfigured } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 4_096;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  const { briefId } = await params;
  if (!isStrictUuid(briefId)) return jsonError("Invalid brief.", 400);
  if (!isSupabaseAuthConfigured()) return jsonError("Private brief storage is not configured yet.", 503);

  let input: unknown;
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(
      error instanceof RequestBodyTooLargeError ? "Pinned note is too large." : "A valid pinned note is required.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const parsed = parseAnnotationInput(input);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) return jsonError("Sign in to update this brief.", 401);
    const briefResult = await supabase.from("brief").select("status").eq("id", briefId).maybeSingle();
    if (briefResult.error) throw briefResult.error;
    if (!briefResult.data) return jsonError("Brief not found.", 404);
    if (["awaiting_customer", "approved", "archived"].includes(String(briefResult.data.status))) {
      return jsonError("A revision under customer review cannot be changed.", 409);
    }
    const revisionResult = await supabase
      .from("revision")
      .select("id, locked_at, render_path")
      .eq("brief_id", briefId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionResult.error) throw revisionResult.error;
    if (!revisionResult.data) return jsonError("Brief or revision not found.", 404);
    if (revisionResult.data.locked_at) return jsonError("Approved revisions cannot accept pinned notes.", 409);
    if (!revisionResult.data.render_path) return jsonError("Generate a YouCam result before pinning a note.", 409);
    const requirementResult = await supabase
      .from("requirement")
      .select("id")
      .eq("id", parsed.value.requirementId)
      .eq("revision_id", revisionResult.data.id)
      .maybeSingle();
    if (requirementResult.error) throw requirementResult.error;
    if (!requirementResult.data) {
      return jsonError("Choose a non-negotiable from this revision.", 400);
    }
    const created = await supabase
      .from("annotation")
      .insert({
        revision_id: revisionResult.data.id,
        requirement_id: requirementResult.data.id,
        author_role: "tailor",
        anchor_x: parsed.value.anchorX,
        anchor_y: parsed.value.anchorY,
        body: parsed.value.body,
      })
      .select("id, requirement_id, anchor_x, anchor_y, body, created_at")
      .single();
    if (created.error) {
      if (isLockedMutationError(created.error)) return jsonError("This revision can no longer accept pinned notes.", 409);
      throw created.error;
    }
    return NextResponse.json({ annotation: created.data }, { status: 201, headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("Annotation creation failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not add this pinned note.", 500);
  }
}
