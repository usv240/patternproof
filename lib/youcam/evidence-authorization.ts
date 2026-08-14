import "server-only";

import { createHash } from "node:crypto";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "../supabase/server";
import type { EvidenceFeature } from "./evidence-client";
import { RenderAccessError } from "./authorization";

const FEATURE_VERSION: Record<EvidenceFeature, string> = {
  background_removal: "youcam-sod-v1",
  fabric_vto: "youcam-fabric-v1",
  approved_motion: "youcam-video-v2-480p-5s",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedReferenceHash(spec: unknown): string {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new RenderAccessError("Validated reference evidence is required.", 409);
  }
  const normalized = (spec as Record<string, unknown>).normalized_images;
  const reference = normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? (normalized as Record<string, unknown>).reference
    : undefined;
  const hash = reference && typeof reference === "object" && !Array.isArray(reference)
    ? (reference as Record<string, unknown>).sha256
    : undefined;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new RenderAccessError("Validated reference evidence is required.", 409);
  }
  return hash;
}

export async function prepareAuthorizedEvidence(input: {
  revisionId: string;
  feature: EvidenceFeature;
  templateId?: string;
  templateTitle?: string;
}) {
  if (!isSupabaseConfigured()) {
    throw new RenderAccessError("Persistent storage is not configured.", 503);
  }
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new RenderAccessError("Open a private workspace to create evidence.", 401);
  }

  const { data: revision, error } = await supabase
    .from("revision")
    .select("id, brief_id, reference_path, reference_rescued_path, reference_rescued_hash, render_path, render_hash, fabric_render_path, fabric_render_hash, garment_spec, locked_at")
    .eq("id", input.revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!revision) throw new RenderAccessError("Revision not found.", 404);

  let sourcePath: string | null;
  let sourceHash: string | null;
  if (input.feature === "background_removal") {
    sourcePath = revision.reference_path;
    sourceHash = normalizedReferenceHash(revision.garment_spec);
  } else if (input.feature === "fabric_vto") {
    sourcePath = revision.render_path;
    sourceHash = revision.render_hash;
  } else {
    sourcePath = revision.fabric_render_path ?? revision.render_path;
    sourceHash = revision.fabric_render_hash ?? revision.render_hash;
  }
  if (!sourcePath || !sourceHash || !/^[0-9a-f]{64}$/.test(sourceHash)) {
    throw new RenderAccessError("The required source evidence is not ready yet.", 409);
  }

  const requestHash = sha256(JSON.stringify({
    feature: input.feature,
    version: FEATURE_VERSION[input.feature],
    sourceHash,
    templateId: input.templateId ?? null,
  }));

  return {
    supabase,
    userId: userData.user.id,
    revisionId: String(revision.id),
    sourcePath,
    requestHash,
    feature: input.feature,
    templateId: input.templateId,
    templateTitle: input.templateTitle,
  };
}

export async function signedEvidenceInput(
  authorized: Awaited<ReturnType<typeof prepareAuthorizedEvidence>>,
): Promise<string> {
  const signed = await authorized.supabase.storage
    .from("brief-images")
    .createSignedUrl(authorized.sourcePath, 5 * 60);
  if (signed.error || !signed.data) throw signed.error ?? new Error("Evidence input URL missing");
  const url = new URL(signed.data.signedUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new RenderAccessError("Hosted HTTPS image storage is required.", 409);
  }
  return url.toString();
}

export async function reserveAuthorizedEvidence(
  authorized: Awaited<ReturnType<typeof prepareAuthorizedEvidence>>,
) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("reserve_youcam_evidence_job", {
    p_revision_id: authorized.revisionId,
    p_feature: authorized.feature,
    p_request_sha256: authorized.requestHash,
    p_template_id: authorized.templateId ?? null,
    p_template_title: authorized.templateTitle ?? null,
    p_requested_by: authorized.userId,
  }).single();
  if (result.error || !result.data) throw result.error ?? new Error("Evidence reservation missing");
  const row = result.data as {
    job_id: string;
    attempt_number: number;
    job_status: string;
    claimed: boolean;
  };
  return {
    jobId: row.job_id,
    attemptNumber: row.attempt_number,
    status: row.job_status,
    claimed: row.claimed,
  };
}

export async function consumeEvidenceBudget(jobId: string, attemptNumber: number) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("consume_youcam_evidence_budget", {
    p_job_id: jobId,
    p_attempt_number: attemptNumber,
  });
  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (message.includes("guest youcam") || message.includes("owner evidence")) {
      throw new RenderAccessError("This private workspace has reached its YouCam evidence limit.", 429);
    }
    if (message.includes("global youcam")) {
      throw new RenderAccessError("The pilot YouCam budget is temporarily paused.", 503);
    }
    throw result.error;
  }
  if (result.data !== true) throw new RenderAccessError("The evidence reservation expired.", 409);
}

export async function attachEvidenceTask(jobId: string, attemptNumber: number, value: string) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("attach_youcam_evidence_task", {
    p_job_id: jobId,
    p_attempt_number: attemptNumber,
    p_task_id: value,
  });
  if (result.error) throw result.error;
  return result.data === true;
}

export async function abortEvidenceAttempt(jobId: string, attemptNumber: number, reason: string) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("abort_youcam_evidence_attempt", {
    p_job_id: jobId,
    p_attempt_number: attemptNumber,
    p_reason: reason,
  });
  if (result.error) throw result.error;
}

export async function authorizeEvidencePoll(jobId: string) {
  if (!isSupabaseConfigured()) throw new RenderAccessError("Persistent storage is not configured.", 503);
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new RenderAccessError("Open a private workspace to retrieve evidence.", 401);
  const { data: job, error } = await supabase
    .from("youcam_evidence_job")
    .select("id, revision_id, feature, task_id, status, attempt_count, result_path, result_hash, template_id, template_title, updated_at")
    .eq("id", jobId)
    .eq("requested_by", userData.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!job) throw new RenderAccessError("Evidence job not found.", 404);
  return { supabase, job };
}

export async function completeEvidenceJob(input: {
  jobId: string;
  attemptNumber: number;
  resultPath: string;
  resultHash: string;
}) {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc("complete_youcam_evidence_job", {
    p_job_id: input.jobId,
    p_attempt_number: input.attemptNumber,
    p_result_path: input.resultPath,
    p_result_hash: input.resultHash,
  });
  if (result.error) throw result.error;
  return result.data === true;
}
