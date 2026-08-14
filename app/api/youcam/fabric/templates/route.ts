import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { listFabricTemplates } from "../../../../../lib/youcam/evidence-client";

export const runtime = "nodejs";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, max-age=300",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await supabase.auth.getUser();
    if (user.error || !user.data.user) {
      return NextResponse.json({ error: "Open a private workspace first." }, { status: 401, headers });
    }
    const result = await listFabricTemplates();
    return NextResponse.json({ templates: result.templates }, { headers });
  } catch (error) {
    console.error("Fabric template retrieval failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Fabric directions are temporarily unavailable." }, { status: 502, headers });
  }
}
