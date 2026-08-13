import "server-only";

import {
  isCanonicalRevisionAssetPath,
  revisionStoragePrefix,
} from "./security/storage-path";
import { createSupabaseAdminClient } from "./supabase/server";

const BUCKET = "brief-images";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type CleanupClaim = {
  erasure_id: string;
  shop_id: string;
  brief_id: string;
  revision_id: string;
  body_path: string;
  claim_id: string;
};

async function finish(
  admin: AdminClient,
  claim: CleanupClaim,
  succeeded: boolean,
  error?: string,
): Promise<boolean> {
  const result = await admin.rpc("complete_body_photo_erasure", {
    p_erasure_id: claim.erasure_id,
    p_claim_id: claim.claim_id,
    p_succeeded: succeeded,
    p_error: error ?? null,
  });
  if (result.error) {
    console.error("Body-photo erasure completion failed", result.error.message);
    return false;
  }
  return result.data === true;
}

export async function runBodyPhotoErasureCleanup(
  admin: AdminClient,
  limit = 25,
): Promise<{ processed: number; erased: number; retryRequired: number }> {
  const claimResult = await admin.rpc("claim_body_photo_erasure_cleanup", {
    p_limit: limit,
  });
  if (claimResult.error) throw claimResult.error;

  let processed = 0;
  let erased = 0;
  let retryRequired = 0;
  for (const claim of (claimResult.data ?? []) as CleanupClaim[]) {
    processed += 1;
    const prefix = revisionStoragePrefix(
      claim.shop_id,
      claim.brief_id,
      claim.revision_id,
    );
    if (!prefix || !isCanonicalRevisionAssetPath(claim.body_path, prefix, "body")) {
      retryRequired += 1;
      await finish(admin, claim, false, "Erasure path failed canonical validation.");
      continue;
    }

    const removal = await admin.storage.from(BUCKET).remove([claim.body_path]);
    const completed = await finish(
      admin,
      claim,
      !removal.error,
      removal.error ? "Body-photo object cleanup requires retry." : undefined,
    );
    if (!removal.error && completed) erased += 1;
    else retryRequired += 1;
  }

  return { processed, erased, retryRequired };
}
