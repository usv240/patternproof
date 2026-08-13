type ResolveAppOriginOptions = {
  configuredUrl?: string;
  nodeEnv?: string;
  requestOrigin?: string;
};

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function parseOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not include credentials, a query, or a fragment.`);
  }
  if (url.pathname !== "/") {
    throw new Error(`${label} must be an origin without a path.`);
  }
  return url;
}

export function resolveAppOrigin({ configuredUrl, nodeEnv, requestOrigin }: ResolveAppOriginOptions): string {
  const production = nodeEnv === "production";

  if (configuredUrl?.trim()) {
    const configured = parseOrigin(configuredUrl.trim(), "APP_URL");
    if (production && configured.protocol !== "https:") {
      throw new Error("APP_URL must use HTTPS in production.");
    }
    if (configured.protocol === "http:" && !isLoopback(configured.hostname)) {
      throw new Error("Plain HTTP is only allowed for a loopback APP_URL.");
    }
    return configured.origin;
  }

  if (production) {
    throw new Error("APP_URL is required in production.");
  }
  if (!requestOrigin) {
    throw new Error("A local request origin is required when APP_URL is not configured.");
  }

  const local = parseOrigin(requestOrigin, "Request origin");
  if (!isLoopback(local.hostname)) {
    throw new Error("APP_URL is required outside local development.");
  }
  return local.origin;
}

export function isTrustedBrowserOrigin(originHeader: string | null, appOrigin: string, nodeEnv?: string): boolean {
  if (!originHeader) return nodeEnv !== "production";
  try {
    return new URL(originHeader).origin === appOrigin;
  } catch {
    return false;
  }
}

const BRIEF_DESTINATION = /^\/brief(?:\/new|\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/i;

export function safePostAuthPath(value: unknown, fallback = "/brief"): string {
  if (typeof value !== "string" || value.length > 160) return fallback;
  return BRIEF_DESTINATION.test(value) ? value : fallback;
}
