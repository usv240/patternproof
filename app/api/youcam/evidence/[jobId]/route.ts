import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import {
  abortEvidenceAttempt,
  authorizeEvidencePoll,
  completeEvidenceJob,
} from "../../../../../lib/youcam/evidence-authorization";
import { getEvidenceTask, type EvidenceFeature } from "../../../../../lib/youcam/evidence-client";
import {
  signedEvidenceResult,
  storeEvidenceResult,
} from "../../../../../lib/youcam/evidence-rehost";
import { RenderAccessError } from "../../../../../lib/youcam/authorization";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RUNNING_MS = 10 * 60 * 1_000;
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    if (!uuid.test(jobId)) return json({ error: "Invalid evidence job." }, 400);
    const { job } = await authorizeEvidencePoll(jobId);
    const admin = createSupabaseAdminClient();
    if (job.status === "success") {
      if (!job.result_path) throw new Error("Completed evidence path is missing.");
      return json({
        status: "success",
        feature: job.feature,
        resultUrl: await signedEvidenceResult(admin, String(job.result_path)),
      });
    }
    if (job.status === "error" || job.status === "timeout") return json({ status: job.status, feature: job.feature });
    if (!job.task_id) return json({ status: "pending", feature: job.feature }, 202);

    const updatedAt = Date.parse(String(job.updated_at));
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > MAX_RUNNING_MS) {
      await abortEvidenceAttempt(job.id, job.attempt_count, "Vendor task timed out");
      return json({ status: "timeout", feature: job.feature });
    }

    const feature = job.feature as EvidenceFeature;
    const result = await getEvidenceTask(feature, String(job.task_id));
    if (result.status === "success") {
      if (!result.resultUrl) throw new Error("Successful YouCam evidence task had no result URL.");
      const stored = await storeEvidenceResult({
        supabase: admin,
        revisionId: String(job.revision_id),
        feature,
        vendorUrl: result.resultUrl,
      });
      try {
        const completed = await completeEvidenceJob({
          jobId: job.id,
          attemptNumber: job.attempt_count,
          resultPath: stored.resultPath,
          resultHash: stored.resultHash,
        });
        if (!completed) throw new Error("Evidence completion fence rejected the result.");
      } catch (error) {
        await admin.storage.from("brief-images").remove([stored.resultPath]);
        throw error;
      }
      return json({
        status: "success",
        feature,
        resultUrl: await signedEvidenceResult(admin, stored.resultPath),
      });
    }
    if (result.status === "error") {
      await abortEvidenceAttempt(job.id, job.attempt_count, "YouCam reported an evidence error");
    }
    return json({ status: result.status, feature }, result.status === "error" ? 200 : 202);
  } catch (error) {
    if (error instanceof RenderAccessError) return json({ error: error.message }, error.status);
    console.error("YouCam evidence poll failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "We could not retrieve this YouCam evidence." }, 502);
  }
}
