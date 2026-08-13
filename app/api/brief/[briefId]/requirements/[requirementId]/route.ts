import { NextRequest, NextResponse } from "next/server";

import {
  isLockedMutationError,
  isStrictUuid,
  parseFeasibilityInput,
  PRIVATE_NO_STORE_HEADERS,
} from "../../../../../../lib/brief-workspace";
import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../../../../lib/supabase/server";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../../lib/security/request-origin";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "unknown";
}



export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ briefId: string; requirementId: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  const { briefId, requirementId } = await params;
  if (!isStrictUuid(briefId) || !isStrictUuid(requirementId)) {
    return jsonError("Invalid brief or requirement.", 400);
  }
  if (!isSupabaseAuthConfigured()) {
    return jsonError("Private brief storage is not configured yet.", 503);
  }

  let input: unknown;
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(
      error instanceof RequestBodyTooLargeError ? "Request body is too large." : "A valid JSON body is required.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const parsed = parseFeasibilityInput(input);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return jsonError("Sign in to update this brief.", 401);
    }

    const briefState = await supabase
      .from("brief")
      .select("status")
      .eq("id", briefId)
      .maybeSingle();
    if (briefState.error) throw briefState.error;
    if (!briefState.data) return jsonError("Brief not found.", 404);
    if (
      ["awaiting_customer", "approved", "archived"].includes(
        String(briefState.data.status),
      )
    ) {
      return jsonError(
        "A revision under customer review cannot be changed.",
        409,
      );
    }

    const revisionResult = await supabase
      .from("revision")
      .select("id, locked_at")
      .eq("brief_id", briefId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionResult.error) throw revisionResult.error;
    if (!revisionResult.data) return jsonError("Brief or revision not found.", 404);
    if (revisionResult.data.locked_at) {
      return jsonError("Approved revisions cannot change feasibility.", 409);
    }

    const requirementResult = await supabase
      .from("requirement")
      .select("id, label, note")
      .eq("id", requirementId)
      .eq("revision_id", revisionResult.data.id)
      .maybeSingle();
    if (requirementResult.error) throw requirementResult.error;
    if (!requirementResult.data) return jsonError("Requirement not found.", 404);

    const existingFeasibility = await supabase
      .from("feasibility")
      .select("requirement_id")
      .eq("requirement_id", requirementResult.data.id)
      .maybeSingle();
    if (existingFeasibility.error) throw existingFeasibility.error;

    const decision = {
      status: parsed.value.status,
      tailor_note: parsed.value.tailorNote,
    };
    let feasibilityResult = existingFeasibility.data
      ? await supabase
          .from("feasibility")
          .update(decision)
          .eq("requirement_id", requirementResult.data.id)
          .select("status, tailor_note")
          .single()
      : await supabase
          .from("feasibility")
          .insert({
            requirement_id: requirementResult.data.id,
            ...decision,
          })
          .select("status, tailor_note")
          .single();

    // A simultaneous first save can win after the read above. Retry only the
    // mutable columns; never grant UPDATE on the immutable requirement key.
    if (!existingFeasibility.data && feasibilityResult.error?.code === "23505") {
      feasibilityResult = await supabase
        .from("feasibility")
        .update(decision)
        .eq("requirement_id", requirementResult.data.id)
        .select("status, tailor_note")
        .single();
    }
    if (feasibilityResult.error) {
      if (isLockedMutationError(feasibilityResult.error)) {
        return jsonError("Approved revisions cannot change feasibility.", 409);
      }
      throw feasibilityResult.error;
    }

    const tailorNote = typeof feasibilityResult.data.tailor_note === "string"
      ? feasibilityResult.data.tailor_note
      : null;
    return NextResponse.json(
      {
        requirement: {
          id: String(requirementResult.data.id),
          label: String(requirementResult.data.label),
          note: requirementResult.data.note ?? null,
          status: feasibilityResult.data.status,
          ...(tailorNote ? { tailorNote } : {}),
        },
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Feasibility update failed", errorMessage(error));
    return jsonError("We could not record this feasibility decision.", 500);
  }
}
