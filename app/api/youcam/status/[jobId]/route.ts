import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import {
  authorizeRenderPoll,
  RenderAccessError,
} from "../../../../../lib/youcam/authorization";
import { getClothesRender } from "../../../../../lib/youcam/client";
import {
  rehostSuccessfulRender,
  signedStoredRender,
} from "../../../../../lib/youcam/rehost";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RUNNING_MS = 10 * 60 * 1_000;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers: privateHeaders });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    if (!uuid.test(jobId)) return json({ error: "Invalid render job." }, 400);

    const { job } = await authorizeRenderPoll(jobId);
    const admin = createSupabaseAdminClient();

    if (job.status === "success") {
      const resultUrl = await signedStoredRender(admin, job.revision_id);
      return json({ status: "success", resultUrl });
    }
    if (job.status === "error" || job.status === "timeout") {
      return json({ status: job.status });
    }
    if (job.status === "deferred") {
      return json({ status: "retry" });
    }
    if (job.status === "reserved") {
      const lease = Date.parse(String(job.reservation_expires_at));
      if (Number.isFinite(lease) && lease <= Date.now()) {
        return json({ status: "retry" });
      }
      return json({ status: "pending" }, 202);
    }
    if (!job.task_id) {
      return json({ status: "pending" }, 202);
    }

    const updatedAt = Date.parse(String(job.updated_at));
    if (
      Number.isFinite(updatedAt) &&
      Date.now() - updatedAt > MAX_RUNNING_MS
    ) {
      const timedOut = await admin
        .from("render_job")
        .update({ status: "timeout" })
        .eq("id", job.id)
        .eq("status", "running")
        .eq("task_id", job.task_id);
      if (timedOut.error) throw timedOut.error;
      return json({ status: "timeout" });
    }

    const result = await getClothesRender(String(job.task_id));
    let resultUrl: string | null | undefined;

    if (result.status === "success") {
      if (!result.resultUrl) {
        throw new Error("Successful YouCam task had no result URL.");
      }
      resultUrl = await rehostSuccessfulRender({
        supabase: admin,
        revisionId: job.revision_id,
        vendorUrl: result.resultUrl,
      });
      const updated = await admin
        .from("render_job")
        .update({ status: "success" })
        .eq("id", job.id)
        .eq("status", "running")
        .eq("task_id", job.task_id);
      if (updated.error) throw updated.error;
    } else if (result.status === "error") {
      const updated = await admin
        .from("render_job")
        .update({ status: "error" })
        .eq("id", job.id)
        .eq("status", "running")
        .eq("task_id", job.task_id);
      if (updated.error) throw updated.error;
    }

    return json({ status: result.status, resultUrl });
  } catch (error) {
    if (error instanceof RenderAccessError) {
      return json({ error: error.message }, error.status);
    }
    console.error(
      "YouCam render poll failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "We could not retrieve this preview." }, 502);
  }
}
