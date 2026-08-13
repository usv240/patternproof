import "server-only";

import type { NextRequest } from "next/server";

import { isTrustedBrowserOrigin, resolveAppOrigin } from "./app-origin";

export function hasTrustedMutationOrigin(request: NextRequest): boolean {
  try {
    const appOrigin = resolveAppOrigin({
      configuredUrl: process.env.APP_URL,
      nodeEnv: process.env.NODE_ENV,
      requestOrigin: request.nextUrl.origin,
    });
    return isTrustedBrowserOrigin(
      request.headers.get("origin"),
      appOrigin,
      process.env.NODE_ENV,
    );
  } catch {
    return false;
  }
}
