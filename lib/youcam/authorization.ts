import "server-only";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "../supabase/server";
import { normalizedImagePairHash, YOUCAM_RENDER_API_VERSION } from "./render-key";

type GarmentCategory = "auto" | "full_body" | "upper_body" | "lower_body";
export class RenderAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RenderAccessError";
  }
}

function canonicalHash(spec: unknown, kind: "body" | "reference"): string {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new RenderAccessError("Validated intake images are required.", 409);
  }
  const normalized = (spec as Record<string, unknown>).normalized_images;
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new RenderAccessError("Validated intake images are required.", 409);
  }
  const image = (normalized as Record<string, unknown>)[kind];
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new RenderAccessError("Validated intake images are required.", 409);
  }
  const hash = (image as Record<string, unknown>).sha256;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new RenderAccessError("Validated intake image hashes are required.", 409);
  }
  return hash;
}

export async function prepareAuthorizedRender(revisionId: string) {
  if (!isSupabaseConfigured()) {
    throw new RenderAccessError("Persistent storage is not configured.", 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new RenderAccessError("Sign in to create a preview.", 401);
  }

  const { data: revision, error: revisionError } = await supabase
    .from("revision")
    .select("id, brief_id, body_path, reference_path, locked_at, garment_spec")
    .eq("id", revisionId)
    .maybeSingle();
  if (revisionError) throw revisionError;
  if (!revision) throw new RenderAccessError("Revision not found.", 404);
  if (revision.locked_at) {
    throw new RenderAccessError("Approved revisions cannot be re-rendered.", 409);
  }

  const { data: brief, error: briefError } = await supabase
    .from("brief")
    .select("status")
    .eq("id", revision.brief_id)
    .maybeSingle();
  if (briefError) throw briefError;
  if (!brief) throw new RenderAccessError("Brief not found.", 404);
  if (["awaiting_customer", "approved", "archived"].includes(String(brief.status))) {
    throw new RenderAccessError(
      "Withdraw customer review or create a new revision before re-rendering.",
      409,
    );
  }

  const { data: consent, error: consentError } = await supabase
    .from("consent")
    .select("id, rights_confirmed, body_processing_confirmed")
    .eq("brief_id", revision.brief_id)
    .maybeSingle();
  if (consentError) throw consentError;
  if (!consent?.rights_confirmed || !consent.body_processing_confirmed) {
    throw new RenderAccessError(
      "Body-photo consent and reference-image rights are required.",
      409,
    );
  }

  const bodySha256 = canonicalHash(revision.garment_spec, "body");
  const referenceSha256 = canonicalHash(revision.garment_spec, "reference");

  return {
    supabase,
    userId: userData.user.id,
    revisionId: String(revision.id),
    bodyPath: String(revision.body_path),
    referencePath: String(revision.reference_path),
    normalizedImageHash: normalizedImagePairHash(bodySha256, referenceSha256),
  };
}

export async function reserveAuthorizedRender(
  authorized: Awaited<ReturnType<typeof prepareAuthorizedRender>>,
  garmentCategory: GarmentCategory,
) {
  const admin = createSupabaseAdminClient();
  const reservation = await admin
    .rpc("reserve_render_job", {
      p_revision_id: authorized.revisionId,
      p_normalized_image_hash: authorized.normalizedImageHash,
      p_garment_category: garmentCategory,
      p_api_version: YOUCAM_RENDER_API_VERSION,
      p_requested_by: authorized.userId,
    })
    .single();
  if (reservation.error || !reservation.data) {
    throw reservation.error ?? new Error("Render reservation missing");
  }

  const row = reservation.data as {
    job_id: string;
    job_status: string;
    vendor_task_id: string | null;
    reserved: boolean;
    attempt_number: number;
    reservation_expires_at: string | null;
  };
  return {
    jobId: row.job_id,
    status: row.job_status,
    vendorTaskId: row.vendor_task_id,
    reserved: row.reserved,
    attemptNumber: row.attempt_number,
    reservationExpiresAt: row.reservation_expires_at,
  };
}

export async function signedRenderInputs(
  authorized: Awaited<ReturnType<typeof prepareAuthorizedRender>>,
) {
  const [body, reference] = await Promise.all([
    authorized.supabase.storage.from("brief-images").createSignedUrl(authorized.bodyPath, 5 * 60),
    authorized.supabase.storage
      .from("brief-images")
      .createSignedUrl(authorized.referencePath, 5 * 60),
  ]);
  if (body.error || !body.data) throw body.error ?? new Error("Body image URL missing");
  if (reference.error || !reference.data) {
    throw reference.error ?? new Error("Reference image URL missing");
  }
  const providerInput = (value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RenderAccessError("Private image storage returned an invalid URL.", 503);
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new RenderAccessError(
        "This preview needs hosted HTTPS image storage. Deploy with Supabase Cloud, then try again.",
        409,
      );
    }
    return url.toString();
  };
  return {
    sourceImageUrl: providerInput(body.data.signedUrl),
    referenceImageUrl: providerInput(reference.data.signedUrl),
  };
}

export async function attachReservedRenderTask(
  input: { jobId: string; attemptNumber: number; vendorTaskId: string },
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("attach_reserved_render_task", {
    p_job_id: input.jobId,
    p_attempt_number: input.attemptNumber,
    p_vendor_task_id: input.vendorTaskId,
  });
  if (result.error) throw result.error;
  return result.data === true;
}

export async function abortReservedRenderAttempt(
  input: { jobId: string; attemptNumber: number },
) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("abort_reserved_render_attempt", {
    p_job_id: input.jobId,
    p_attempt_number: input.attemptNumber,
  });
  if (result.error) throw result.error;
  return result.data as "deferred" | "error" | null;
}

export async function authorizeRenderPoll(jobId: string) {
  if (!isSupabaseConfigured()) {
    throw new RenderAccessError("Persistent storage is not configured.", 503);
  }
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new RenderAccessError("Sign in to retrieve this preview.", 401);
  }
  const { data: job, error } = await supabase
    .from("render_job")
    .select("id, task_id, revision_id, status, attempt_count, reservation_expires_at, updated_at")
    .eq("id", jobId)
    .eq("requested_by", userData.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!job) throw new RenderAccessError("Render job not found.", 404);
  return { supabase, job };
}


export async function consumeReservedRenderBudget(input: {
  jobId: string;
  attemptNumber: number;
}) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("consume_render_budget", {
    p_job_id: input.jobId,
    p_attempt_number: input.attemptNumber,
  });
  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (message.includes("owner render limit")) {
      throw new RenderAccessError(
        "Render limit reached. Try again in a few minutes.",
        429,
      );
    }
    if (message.includes("global render budget")) {
      throw new RenderAccessError(
        "The pilot render budget is temporarily paused.",
        503,
      );
    }
    throw result.error;
  }
  if (result.data !== true) {
    throw new RenderAccessError(
      "The render reservation expired. Start the preview again.",
      409,
    );
  }
}
