import { NextRequest, NextResponse } from "next/server";

import { hasTrustedMutationOrigin } from "../../../lib/security/request-origin";
import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) {
    return NextResponse.json(
      { error: "Untrusted request origin." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.signOut();
    if (result.error) {
      console.error("Sign out failed", result.error.message);
      return NextResponse.json(
        { error: "We could not sign you out." },
        { status: 500, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }

  return NextResponse.redirect(new URL("/login", request.url), 303);
}
