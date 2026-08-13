import { FEASIBILITY_STATES, type FeasibilityStatus } from "./domain";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

type JsonRecord = Record<string, unknown>;

export type FrozenFeasibility = {
  status: FeasibilityStatus;
  tailor_note: string | null;
};

export type FrozenRequirement = {
  id: string;
  label: string;
  note: string | null;
  feasibility: FrozenFeasibility | null;
};

export type FrozenAnnotation = {
  id: string;
  requirement_id: string | null;
  author_role: string;
  anchor_x: number;
  anchor_y: number;
  body: string;
  created_at: string;
};

export type FrozenConsent = {
  scope: string;
  rights_confirmed: true;
  body_processing_confirmed: true;
  policy_version: string;
  granted_at: string;
};

export type FrozenReviewSnapshot = {
  shop: { id: string; name: string };
  brief: { id: string; customer_label: string };
  revision: {
    id: string;
    version: number;
    reference_path: string;
    render_path: string;
    reference_sha256: string;
    render_sha256: string;
    category: string;
    created_at: string;
  };
  requirements: FrozenRequirement[];
  annotations: FrozenAnnotation[];
  consent: FrozenConsent;
};

export type ReviewSnapshotIdentity = {
  shopId: string;
  briefId: string;
  revisionId: string;
};

function record(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function parseRequirement(value: unknown): FrozenRequirement | undefined {
  const source = record(value);
  if (!source || typeof source.id !== "string" || !UUID.test(source.id)) return undefined;
  if (!nonblank(source.label)) return undefined;

  const note = nullableText(source.note);
  if (note === undefined) return undefined;

  let feasibility: FrozenFeasibility | null = null;
  if (source.feasibility !== null) {
    const decision = record(source.feasibility);
    if (
      !decision ||
      typeof decision.status !== "string" ||
      !FEASIBILITY_STATES.includes(decision.status as FeasibilityStatus)
    ) {
      return undefined;
    }
    const tailorNote = nullableText(decision.tailor_note);
    if (tailorNote === undefined) return undefined;
    feasibility = {
      status: decision.status as FeasibilityStatus,
      tailor_note: tailorNote,
    };
  }

  return { id: source.id, label: source.label, note, feasibility };
}

function parseAnnotation(value: unknown): FrozenAnnotation | undefined {
  const source = record(value);
  if (!source || typeof source.id !== "string" || !UUID.test(source.id)) return undefined;
  if (!nonblank(source.author_role) || !nonblank(source.body) || !nonblank(source.created_at)) {
    return undefined;
  }
  if (
    typeof source.anchor_x !== "number" ||
    typeof source.anchor_y !== "number" ||
    source.anchor_x < 0 ||
    source.anchor_x > 1 ||
    source.anchor_y < 0 ||
    source.anchor_y > 1
  ) {
    return undefined;
  }
  const requirementId = source.requirement_id === undefined || source.requirement_id === null
    ? null
    : typeof source.requirement_id === "string" && UUID.test(source.requirement_id)
      ? source.requirement_id
      : undefined;
  if (requirementId === undefined) return undefined;
  return {
    id: source.id,
    requirement_id: requirementId,
    author_role: source.author_role,
    anchor_x: source.anchor_x,
    anchor_y: source.anchor_y,
    body: source.body,
    created_at: source.created_at,
  };
}

export function isSnapshotSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function parseFrozenReviewSnapshot(
  value: unknown,
  identity: ReviewSnapshotIdentity,
): FrozenReviewSnapshot | undefined {
  const source = record(value);
  const shop = record(source?.shop);
  const brief = record(source?.brief);
  const revision = record(source?.revision);
  const consent = record(source?.consent);

  if (source?.schema_version !== "patternproof-review-v2") return undefined;
  if (shop?.id !== identity.shopId || brief?.id !== identity.briefId) return undefined;
  if (revision?.id !== identity.revisionId) return undefined;
  if (!nonblank(shop.name) || !nonblank(brief.customer_label)) return undefined;
  if (!Number.isInteger(revision.version) || Number(revision.version) < 1) return undefined;
  if (!nonblank(revision.reference_path) || !nonblank(revision.render_path)) return undefined;
  if (!isSnapshotSha256(revision.reference_sha256) || !isSnapshotSha256(revision.render_sha256)) {
    return undefined;
  }
  if (!nonblank(revision.category) || !nonblank(revision.created_at)) return undefined;
  if (!Array.isArray(source.requirements) || !Array.isArray(source.annotations)) return undefined;
  if (
    !consent ||
    !nonblank(consent.scope) ||
    consent.rights_confirmed !== true ||
    consent.body_processing_confirmed !== true ||
    !nonblank(consent.policy_version) ||
    !nonblank(consent.granted_at)
  ) {
    return undefined;
  }

  const requirements = source.requirements.map(parseRequirement);
  const annotations = source.annotations.map(parseAnnotation);
  if (requirements.some((requirement) => !requirement)) return undefined;
  if (annotations.some((annotation) => !annotation)) return undefined;

  return {
    shop: { id: identity.shopId, name: shop.name },
    brief: { id: identity.briefId, customer_label: brief.customer_label },
    revision: {
      id: identity.revisionId,
      version: Number(revision.version),
      reference_path: revision.reference_path,
      render_path: revision.render_path,
      reference_sha256: revision.reference_sha256,
      render_sha256: revision.render_sha256,
      category: revision.category,
      created_at: revision.created_at,
    },
    requirements: requirements as FrozenRequirement[],
    annotations: annotations as FrozenAnnotation[],
    consent: {
      scope: consent.scope,
      rights_confirmed: true,
      body_processing_confirmed: true,
      policy_version: consent.policy_version,
      granted_at: consent.granted_at,
    },
  };
}

export function shortSnapshotProof(digest: string): string {
  if (!isSnapshotSha256(digest)) return "unavailable";
  return `${digest.slice(0, 6)}-${digest.slice(6, 12)}-${digest.slice(12, 18)}`;
}