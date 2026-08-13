import { NextRequest, NextResponse } from "next/server";

import {
  isLockedMutationError,
  isStrictUuid,
  parseRequirementInput,
  PRIVATE_NO_STORE_HEADERS,
} from "../../../../../lib/brief-workspace";
import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../../../lib/supabase/server";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: PRIVATE_NO_STORE_HEADERS },
  );
}



export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  const { briefId } = await params;
  if (!isStrictUuid(briefId)) return jsonError("Invalid brief.", 400);
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
  const parsed = parseRequirementInput(input);
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
      return jsonError("Approved revisions cannot accept new requirements.", 409);
    }

    const created = await supabase
      .from("requirement")
      .insert({
        revision_id: revisionResult.data.id,
        label: parsed.value.label,
        note: parsed.value.note,
      })
      .select("id, label, note")
      .single();
    if (created.error) {
      if (isLockedMutationError(created.error)) {
        return jsonError("Approved revisions cannot accept new requirements.", 409);
      }
      throw created.error;
    }

    return NextResponse.json(
      {
        requirement: {
          id: String(created.data.id),
          label: String(created.data.label),
          note: created.data.note ?? null,
        },
      },
      { status: 201, headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Requirement creation failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not add this requirement.", 500);
  }
}
