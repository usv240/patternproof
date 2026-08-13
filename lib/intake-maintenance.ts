import { createHash, timingSafeEqual } from "node:crypto";

type RevisionState = {
  locked_at?: unknown;
  garment_spec?: unknown;
};

type ExpiredDraftCandidate = {
  now: Date;
  expiresAt: unknown;
  status: unknown;
  approvedRevisionId: unknown;
  ledgerReady: boolean;
  finalizationActive: boolean;
  revisions: RevisionState[];
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidMaintenanceSecret(
  secret: string | undefined,
): secret is string {
  return typeof secret === "string" && /^[\x21-\x7e]{32,4089}$/.test(secret);
}

export function hasValidMaintenanceAuthorization(
  authorization: string | null,
  configuredSecret: string | undefined,
): boolean {
  const supplied = authorization?.startsWith("Bearer ") && authorization.length <= 4_096
    ? authorization.slice("Bearer ".length)
    : "";
  const expected = hasValidMaintenanceSecret(configuredSecret)
    ? configuredSecret
    : "";
  const matches = timingSafeEqual(digest(supplied), digest(expected));
  return Boolean(supplied && expected && matches);
}

export function hasReadyIntakeSpec(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const readyAt = (value as Record<string, unknown>).intake_ready_at;
  return typeof readyAt === "string" && Boolean(readyAt.trim());
}

export function isFinalizationActive(
  state: unknown,
  updatedAt: unknown,
  now: Date,
  staleAfterMs = 15 * 60 * 1_000,
): boolean {
  if (state !== "finalizing") return false;
  if (typeof updatedAt !== "string") return true;
  const updated = Date.parse(updatedAt);
  return !Number.isFinite(updated) || now.getTime() - updated < staleAfterMs;
}

export function canDeleteExpiredIncompleteDraft(candidate: ExpiredDraftCandidate): boolean {
  const expiry = typeof candidate.expiresAt === "string"
    ? Date.parse(candidate.expiresAt)
    : Number.NaN;
  if (!Number.isFinite(expiry) || expiry > candidate.now.getTime()) return false;
  if (candidate.status !== "draft" || candidate.approvedRevisionId) return false;
  if (candidate.ledgerReady || candidate.finalizationActive) return false;

  return candidate.revisions.every(
    (revision) => !revision.locked_at && !hasReadyIntakeSpec(revision.garment_spec),
  );
}
