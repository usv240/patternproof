import { NextResponse } from "next/server";

import { hasValidMaintenanceSecret } from "../../../lib/intake-maintenance";
import {
  hasExpectedPrivateImageBucket,
  hasValidPrivacyContact,
  hasValidYouCamResultHosts,
} from "../../../lib/release-readiness";
import {
  createSupabaseAdminClient,
  isSupabaseConfigured,
} from "../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  const resultHostsReady = process.env.NODE_ENV !== "production"
    || hasValidYouCamResultHosts(process.env.YOUCAM_RESULT_HOSTS);
  const privacyContactReady = process.env.NODE_ENV !== "production"
    || hasValidPrivacyContact(process.env.PRIVACY_CONTACT_EMAIL);
  if (
    !isSupabaseConfigured() ||
    !process.env.YOUCAM_API_KEY ||
    !hasValidMaintenanceSecret(process.env.CRON_SECRET) ||
    !resultHostsReady ||
    !privacyContactReady
  ) {
    return NextResponse.json(
      { status: "not_ready" },
      { status: 503, headers },
    );
  }

  try {
    const admin = createSupabaseAdminClient();
    const [release, bucket] = await Promise.all([
      admin
        .from("patternproof_release")
        .select("migration")
        .eq("singleton", true)
        .eq("migration", 24)
        .maybeSingle(),
      admin.storage.getBucket("brief-images"),
    ]);
    if (
      release.error ||
      !release.data ||
      bucket.error ||
      !bucket.data ||
      !hasExpectedPrivateImageBucket(bucket.data)
    ) {
      throw release.error ?? bucket.error ?? new Error("Latest schema or private bucket missing");
    }
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (error) {
    console.error(
      "Readiness check failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { status: "not_ready" },
      { status: 503, headers },
    );
  }
}
