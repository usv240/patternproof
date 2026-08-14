import { NextRequest, NextResponse } from "next/server";

import {
  BRIEF_IMAGE_BUCKET,
  isStrictUuid,
  PRIVATE_NO_STORE_HEADERS,
} from "../../../../lib/brief-workspace";
import type { FeasibilityStatus } from "../../../../lib/domain";
import { isSnapshotSha256 } from "../../../../lib/review-snapshot";
import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../../lib/supabase/server";

export const runtime = "nodejs";

type FeasibilityRow = {
  status: FeasibilityStatus;
  tailor_note: string | null;
};

type RequirementRow = {
  id: string;
  label: string;
  note: string | null;
  feasibility: FeasibilityRow | FeasibilityRow[] | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

function firstFeasibility(value: RequirementRow["feasibility"]): FeasibilityRow | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

function publicRequirement(requirement: RequirementRow) {
  const feasibility = firstFeasibility(requirement.feasibility);
  return {
    id: requirement.id,
    label: requirement.label,
    note: requirement.note ?? null,
    ...(feasibility ? { status: feasibility.status } : {}),
    ...(feasibility?.tailor_note ? { tailorNote: feasibility.tailor_note } : {}),
  };
}

async function signedUrl(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const result = await supabase.storage
    .from(BRIEF_IMAGE_BUCKET)
    .createSignedUrl(path, 5 * 60);
  if (result.error || !result.data?.signedUrl) {
    throw result.error ?? new Error("Signed URL missing");
  }
  return result.data.signedUrl;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) {
  const { briefId } = await params;
  if (!isStrictUuid(briefId)) return jsonError("Invalid brief.", 400);
  if (!isSupabaseAuthConfigured()) {
    return jsonError("Private brief storage is not configured yet.", 503);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return jsonError("Sign in to view this brief.", 401);
    }

    const briefResult = await supabase
      .from("brief")
      .select("id, customer_label, status, shared_revision_id, shared_snapshot_sha256")
      .eq("id", briefId)
      .maybeSingle();
    if (briefResult.error) throw briefResult.error;
    if (!briefResult.data) return jsonError("Brief not found.", 404);

    const consentResult = await supabase
      .from("consent")
      .select("rights_confirmed, body_processing_confirmed")
      .eq("brief_id", briefId)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (consentResult.error) throw consentResult.error;

    const revisionQuery = supabase
      .from("revision")
      .select("id, version, locked_at, garment_spec, body_path, reference_path, reference_rescued_path, reference_rescued_hash, render_path, render_hash, fabric_render_path, fabric_render_hash, fabric_template_id, fabric_template_title")
      .eq("brief_id", briefId);
    const sharedRevisionId = typeof briefResult.data.shared_revision_id === "string"
      ? briefResult.data.shared_revision_id
      : null;
    const revisionResult = sharedRevisionId
      ? await revisionQuery.eq("id", sharedRevisionId).maybeSingle()
      : await revisionQuery.order("version", { ascending: false }).limit(1).maybeSingle();
    if (revisionResult.error) throw revisionResult.error;

    const brief = {
      id: String(briefResult.data.id),
      customerLabel: String(briefResult.data.customer_label),
      status: String(briefResult.data.status),
      sharedRevisionId,
      snapshotSha256: isSnapshotSha256(briefResult.data.shared_snapshot_sha256)
        ? briefResult.data.shared_snapshot_sha256
        : null,
      rightsConfirmed: consentResult.data?.rights_confirmed === true &&
        consentResult.data?.body_processing_confirmed === true,
    };
    if (!revisionResult.data) {
      return NextResponse.json(
        { brief, revision: null },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const revision = revisionResult.data;
    const [requirementResult, annotationResult, erasureResult, changeRequestResult, motionResult] = await Promise.all([
      supabase
        .from("requirement")
        .select("id, label, note, feasibility(status, tailor_note)")
        .eq("revision_id", revision.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("annotation")
        .select("id, requirement_id, anchor_x, anchor_y, body, created_at")
        .eq("revision_id", revision.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("body_photo_erasure")
        .select("status, completed_at")
        .eq("revision_id", revision.id)
        .maybeSingle(),
      supabase
        .from("customer_change_request")
        .select("id, revision_id, source_version, snapshot_sha256, reason, state, created_at, resolved_at")
        .eq("brief_id", briefId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("youcam_evidence_job")
        .select("result_path, result_hash")
        .eq("revision_id", revision.id)
        .eq("feature", "approved_motion")
        .eq("status", "success")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (requirementResult.error) throw requirementResult.error;
    if (annotationResult.error) throw annotationResult.error;
    if (erasureResult.error) throw erasureResult.error;
    if (changeRequestResult.error) throw changeRequestResult.error;

    const bodyPath = typeof revision.body_path === "string" ? revision.body_path : null;
    const originalReferencePath = typeof revision.reference_path === "string"
      ? revision.reference_path
      : null;
    const rescuedReferencePath = typeof revision.reference_rescued_path === "string"
      ? revision.reference_rescued_path
      : null;
    const referencePath = rescuedReferencePath ?? originalReferencePath;
    if (!bodyPath || !referencePath || !originalReferencePath) throw new Error("Revision image paths missing");
    const baseRenderPath = typeof revision.render_path === "string" ? revision.render_path : null;
    const fabricRenderPath = typeof revision.fabric_render_path === "string"
      ? revision.fabric_render_path
      : null;
    const renderPath = fabricRenderPath ?? baseRenderPath;
    const motionPath = typeof motionResult.data?.result_path === "string"
      ? motionResult.data.result_path
      : null;
    const bodyErasure = erasureResult.data;
    const [bodyUrl, originalReferenceUrl, referenceUrl, baseRenderUrl, renderUrl, motionUrl] = await Promise.all([
      bodyErasure ? Promise.resolve(null) : signedUrl(supabase, bodyPath),
      signedUrl(supabase, originalReferencePath),
      signedUrl(supabase, referencePath),
      signedUrl(supabase, baseRenderPath),
      signedUrl(supabase, renderPath),
      signedUrl(supabase, motionPath),
    ]);

    return NextResponse.json(
      {
        brief,
        revision: {
          id: String(revision.id),
          version: Number(revision.version),
          lockedAt: typeof revision.locked_at === "string" ? revision.locked_at : null,
          garmentSpec: revision.garment_spec ?? {},
          bodyUrl,
          bodyErasureStatus: bodyErasure ? String(bodyErasure.status) : null,
          bodyErasedAt:
            typeof bodyErasure?.completed_at === "string"
              ? bodyErasure.completed_at
              : null,
          referenceUrl,
          originalReferenceUrl,
          referenceRescued: Boolean(rescuedReferencePath),
          baseRenderUrl,
          renderUrl,
          fabricDirection: fabricRenderPath ? {
            templateId: String(revision.fabric_template_id),
            templateTitle: String(revision.fabric_template_title),
          } : null,
          motionUrl,
          annotations: (annotationResult.data ?? []).map((annotation) => ({
            id: String(annotation.id),
            requirementId:
              typeof annotation.requirement_id === "string" ? annotation.requirement_id : null,
            anchorX: Number(annotation.anchor_x),
            anchorY: Number(annotation.anchor_y),
            body: String(annotation.body),
            createdAt: String(annotation.created_at),
          })),
          requirements: ((requirementResult.data ?? []) as RequirementRow[]).map(
            publicRequirement,
          ),
          changeRequests: (changeRequestResult.data ?? []).map((request) => ({
            id: String(request.id),
            revisionId: String(request.revision_id),
            sourceVersion: Number(request.source_version),
            snapshotSha256: String(request.snapshot_sha256),
            reason: String(request.reason),
            state: String(request.state),
            createdAt: String(request.created_at),
            resolvedAt: typeof request.resolved_at === "string" ? request.resolved_at : null,
          })),
        },
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Owner brief workspace failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not load this brief.", 500);
  }
}
