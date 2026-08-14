import { NextRequest, NextResponse } from "next/server";

import { hasTrustedMutationOrigin } from "../../../../lib/security/request-origin";
import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../../lib/supabase/server";

export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) {
    return error("Untrusted request origin.", 403);
  }
  if (!isSupabaseAuthConfigured()) {
    return error("Private workspaces are not configured yet.", 503);
  }

  const supabase = await createSupabaseServerClient();
  const existing = await supabase.auth.getUser();
  if (existing.data.user && !existing.error) {
    return NextResponse.json({ ready: true }, { headers });
  }

  const result = await supabase.auth.signInAnonymously();
  if (result.error || !result.data.user) {
    console.error(
      "Guest workspace creation failed",
      result.error?.message ?? "anonymous user missing",
    );
    return error("We could not prepare a private workspace. Try again shortly.", 503);
  }

  return NextResponse.json(
    { ready: true },
    { status: 201, headers },
  );
}
