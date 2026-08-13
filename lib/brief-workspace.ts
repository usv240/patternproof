import {
  FEASIBILITY_STATES,
  type FeasibilityStatus,
} from "./domain";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BRIEF_IMAGE_BUCKET = "brief-images";
export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

type Valid<T> = { ok: true; value: T };
type Invalid = { ok: false; error: string };
export type ValidationResult<T> = Valid<T> | Invalid;

export type RequirementInput = {
  label: string;
  note: string | null;
};

export type FeasibilityInput = {
  status: FeasibilityStatus;
  tailorNote: string | null;
};
export type AnnotationInput = {
  requirementId: string;
  anchorX: number;
  anchorY: number;
  body: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function optionalNote(value: unknown, field: string): ValidationResult<string | null> {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${field} must be text.` };
  if (value.length > 1_000) {
    return { ok: false, error: `${field} must be 1,000 characters or fewer.` };
  }
  if (value.includes("\0")) return { ok: false, error: `${field} contains invalid text.` };

  const cleaned = value.trim();
  return { ok: true, value: cleaned || null };
}

export function isStrictUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseRequirementInput(value: unknown): ValidationResult<RequirementInput> {
  const input = record(value);
  if (!input) return { ok: false, error: "A JSON object is required." };
  if (typeof input.label !== "string") {
    return { ok: false, error: "Requirement label must be text." };
  }
  if (input.label.length > 120) {
    return { ok: false, error: "Requirement label must be 120 characters or fewer." };
  }

  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label || label.includes("\0")) {
    return { ok: false, error: "Requirement label cannot be blank." };
  }

  const note = optionalNote(input.note, "Requirement note");
  if (!note.ok) return note;
  return { ok: true, value: { label, note: note.value } };
}

export function parseFeasibilityInput(value: unknown): ValidationResult<FeasibilityInput> {
  const input = record(value);
  if (!input) return { ok: false, error: "A JSON object is required." };
  if (
    typeof input.status !== "string" ||
    !FEASIBILITY_STATES.includes(input.status as FeasibilityStatus)
  ) {
    return { ok: false, error: "A recognized feasibility status is required." };
  }

  const tailorNote = optionalNote(input.tailorNote, "Tailor note");
  if (!tailorNote.ok) return tailorNote;
  if (input.status === "with_adjustment" && !tailorNote.value) {
    return { ok: false, error: "A tailor note is required for an adjustment." };
  }

  return {
    ok: true,
    value: {
      status: input.status as FeasibilityStatus,
      tailorNote: tailorNote.value,
    },
  };
}

export function parseAnnotationInput(value: unknown): ValidationResult<AnnotationInput> {
  const input = record(value);
  if (!input) return { ok: false, error: "A JSON object is required." };
  if (!isStrictUuid(input.requirementId)) {
    return { ok: false, error: "Choose the non-negotiable this pin explains." };
  }
  if (
    typeof input.anchorX !== "number" ||
    !Number.isFinite(input.anchorX) ||
    input.anchorX < 0 ||
    input.anchorX > 1 ||
    typeof input.anchorY !== "number" ||
    !Number.isFinite(input.anchorY) ||
    input.anchorY < 0 ||
    input.anchorY > 1
  ) {
    return { ok: false, error: "Choose a point inside the YouCam result." };
  }
  if (typeof input.body !== "string") {
    return { ok: false, error: "Pinned note must be text." };
  }
  if (input.body.length > 1_000) {
    return { ok: false, error: "Pinned note must be 1,000 characters or fewer." };
  }
  const body = input.body.trim();
  if (!body || body.includes("\0")) {
    return { ok: false, error: "Pinned note cannot be blank." };
  }
  return {
    ok: true,
    value: {
      requirementId: input.requirementId,
      anchorX: input.anchorX,
      anchorY: input.anchorY,
      body,
    },
  };
}
export function isLockedMutationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message) : "";
  return /approved|immutable|locked/i.test(message);
}
