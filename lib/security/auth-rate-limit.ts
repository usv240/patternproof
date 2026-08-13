import { createHash } from "node:crypto";
import { isIP } from "node:net";

type Bucket = { timestamps: number[] };
type LimitState = { buckets: Map<string, Bucket>; lastSweep: number };
type LimitResult = { allowed: true } | { allowed: false; reason: "email" | "ip"; retryAfterSeconds: number };

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 8;
const MAX_BUCKETS = 10_000;

const processState = globalThis as typeof globalThis & { __patternProofAuthLimits?: LimitState };
const state = processState.__patternProofAuthLimits ??= { buckets: new Map<string, Bucket>(), lastSweep: 0 };

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function activeTimestamps(key: string, now: number): number[] {
  const cutoff = now - WINDOW_MS;
  return (state.buckets.get(key)?.timestamps ?? []).filter((timestamp) => timestamp > cutoff);
}

function retryAfter(timestamps: number[], now: number): number {
  return Math.max(1, Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000));
}

function sweep(now: number): void {
  if (now - state.lastSweep < 60_000 && state.buckets.size <= MAX_BUCKETS) return;
  const cutoff = now - WINDOW_MS;
  for (const [key, bucket] of state.buckets) {
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff);
    if (bucket.timestamps.length === 0) state.buckets.delete(key);
  }
  while (state.buckets.size > MAX_BUCKETS) {
    const oldestKey = state.buckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    state.buckets.delete(oldestKey);
  }
  state.lastSweep = now;
}

export function clientAddressFromHeaders(headers: Headers): string {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("cf-connecting-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
    headers.get("x-real-ip"),
  ];
  for (const candidate of candidates) {
    const address = candidate?.trim();
    if (address && isIP(address)) return address;
  }
  return "unknown";
}

export function consumeMagicLinkAttempt(clientAddress: string, normalizedEmail: string, now = Date.now()): LimitResult {
  sweep(now);
  const emailKey = `email:${digest(normalizedEmail)}`;
  const ipKey = `ip:${digest(clientAddress)}`;
  const emailTimestamps = activeTimestamps(emailKey, now);
  const ipTimestamps = activeTimestamps(ipKey, now);

  if (ipTimestamps.length >= IP_LIMIT) {
    return { allowed: false, reason: "ip", retryAfterSeconds: retryAfter(ipTimestamps, now) };
  }
  if (emailTimestamps.length >= EMAIL_LIMIT) {
    return { allowed: false, reason: "email", retryAfterSeconds: retryAfter(emailTimestamps, now) };
  }

  emailTimestamps.push(now);
  ipTimestamps.push(now);
  state.buckets.set(emailKey, { timestamps: emailTimestamps });
  state.buckets.set(ipKey, { timestamps: ipTimestamps });
  return { allowed: true };
}
