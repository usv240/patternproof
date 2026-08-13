import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, isSupabaseAuthConfigured } from "../../../lib/supabase/server";
import { resolveAppOrigin, safePostAuthPath } from "../../../lib/security/app-origin";

function redirect(appOrigin: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, appOrigin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  let appOrigin: string;
  try {
    appOrigin = resolveAppOrigin({
      configuredUrl: process.env.APP_URL,
      nodeEnv: process.env.NODE_ENV,
      requestOrigin: request.nextUrl.origin,
    });
  } catch (error) {
    console.error("Auth callback origin configuration is invalid", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { error: "Tailor sign-in is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (!isSupabaseAuthConfigured()) return redirect(appOrigin, "/login?error=not_configured");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4_096) return redirect(appOrigin, "/login?error=missing_code");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback exchange failed", { status: error.status, code: error.code ?? "unknown" });
    return redirect(appOrigin, "/login?error=invalid_link");
  }
  return redirect(
    appOrigin,
    safePostAuthPath(request.nextUrl.searchParams.get("next")),
  );
}
