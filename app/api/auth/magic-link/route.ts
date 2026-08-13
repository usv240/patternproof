import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, isSupabaseAuthConfigured } from "../../../../lib/supabase/server";
import { resolveAppOrigin, isTrustedBrowserOrigin, safePostAuthPath } from "../../../../lib/security/app-origin";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../lib/security/bounded-json";
import { clientAddressFromHeaders, consumeMagicLinkAttempt } from "../../../../lib/security/auth-rate-limit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_048;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store", "Vary": "Origin" };
const SUCCESS_MESSAGE = "Check your inbox for the one-time sign-in link. If it does not arrive, wait a few minutes before trying again.";

function json(payload: object, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseAuthConfigured()) return json({ error: "Tailor sign-in is not configured yet." }, 503);

  let appOrigin: string;
  try {
    appOrigin = resolveAppOrigin({
      configuredUrl: process.env.APP_URL,
      nodeEnv: process.env.NODE_ENV,
      requestOrigin: request.nextUrl.origin,
    });
  } catch (error) {
    console.error("Magic-link origin configuration is invalid", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Tailor sign-in is temporarily unavailable." }, 503);
  }

  if (!isTrustedBrowserOrigin(request.headers.get("origin"), appOrigin, process.env.NODE_ENV)) {
    return json({ error: "This sign-in request came from an untrusted origin." }, 403);
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return json({ error: "Expected a JSON request." }, 415);
  let email: unknown;
  let next: unknown;
  try {
    ({ email, next } = await readBoundedJsonBody(request, MAX_BODY_BYTES) as {
      email?: unknown;
      next?: unknown;
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Request is too large." }, 413);
    }
    return json({ error: "Enter a valid email address." }, 400);
  }
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const nextPath = safePostAuthPath(next);
  const limit = consumeMagicLinkAttempt(clientAddressFromHeaders(request.headers), normalizedEmail);
  if (!limit.allowed) {
    if (limit.reason === "email") return json({ message: SUCCESS_MESSAGE });
    return json(
      { error: "Too many sign-in requests. Please wait a few minutes and try again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false,
      emailRedirectTo:
        appOrigin + "/auth/callback?next=" + encodeURIComponent(nextPath),
    },
  });
  if (error) {
    console.error("Magic-link provider request failed", { status: error.status, code: error.code ?? "unknown" });
  }
  return json({ message: SUCCESS_MESSAGE });
}
