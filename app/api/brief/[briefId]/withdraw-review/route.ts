import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  BRIEF_IMAGE_BUCKET,
  isStrictUuid,
  PRIVATE_NO_STORE_HEADERS,
} from "../../../../../lib/brief-workspace";
import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";
import {
  isCanonicalRevisionAssetPath,
  revisionStoragePrefix,
} from "../../../../../lib/security/storage-path";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4_096;

type CloneReservation = {
  clone_id: string;
  clone_state: string;
  source_revision_id: string;
  target_revision_id: string;
  target_issuance_id: string;
  source_body_path: string;
  source_reference_path: string;
  target_body_path: string;
  target_reference_path: string;
  reservation_expires_at: string;
};

type CloneCommit = {
  committed: boolean;
  brief_id: string;
  source_revision_id: string;
  target_revision_id: string;
  target_issuance_id: string;
  target_version: number;
  ready_at: string;
};

function json(payload: object, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validReservation(
  value: CloneReservation,
  input: { briefId: string; shopId: string; sourceRevisionId: string },
): boolean {
  if (
    !isStrictUuid(value.clone_id) ||
    !isStrictUuid(value.source_revision_id) ||
    !isStrictUuid(value.target_revision_id) ||
    !isStrictUuid(value.target_issuance_id) ||
    value.source_revision_id !== input.sourceRevisionId ||
    value.target_revision_id === value.source_revision_id
  ) {
    return false;
  }

  const sourcePrefix = revisionStoragePrefix(
    input.shopId,
    input.briefId,
    value.source_revision_id,
  );
  const targetPrefix = revisionStoragePrefix(
    input.shopId,
    input.briefId,
    value.target_revision_id,
  );
  return Boolean(
    sourcePrefix &&
      targetPrefix &&
      isCanonicalRevisionAssetPath(value.source_body_path, sourcePrefix, "body") &&
      isCanonicalRevisionAssetPath(
        value.source_reference_path,
        sourcePrefix,
        "reference",
      ) &&
      isCanonicalRevisionAssetPath(value.target_body_path, targetPrefix, "body") &&
      isCanonicalRevisionAssetPath(
        value.target_reference_path,
        targetPrefix,
        "reference",
      ),
  );
}

async function abandonClone(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  reservation: CloneReservation,
  message: string,
) {
  const aborted = await admin.rpc("abort_review_revision_clone", {
    p_clone_id: reservation.clone_id,
    p_error: message.slice(0, 1000),
  });
  if (aborted.error) {
    console.error("Review clone abort failed", aborted.error.message);
    return;
  }
  if (aborted.data !== true) {
    // A concurrent request may already have committed this reservation. Never
    // delete target objects unless database truth moved it into cleanup.
    return;
  }

  const removal = await admin.storage
    .from(BRIEF_IMAGE_BUCKET)
    .remove([reservation.target_body_path, reservation.target_reference_path]);
  if (removal.error) {
    console.error("Review clone immediate cleanup failed", removal.error.message);
  }
}

async function commitClone(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  reservation: CloneReservation,
  hashes: { body: string; reference: string },
) {
  return admin
    .rpc("commit_review_revision_clone", {
      p_clone_id: reservation.clone_id,
      p_body_sha256: hashes.body,
      p_reference_sha256: hashes.reference,
    })
    .maybeSingle();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) {
  if (!hasTrustedMutationOrigin(request)) {
    return json({ error: "Untrusted request origin." }, 403);
  }
  if (!isSupabaseConfigured()) {
    return json({ error: "Customer review is not configured yet." }, 503);
  }

  const { briefId } = await params;
  if (!isStrictUuid(briefId)) return json({ error: "Brief not found." }, 404);

  let input: { reason?: unknown };
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES) as typeof input;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Revision request is too large." }, 413);
    }
    return json({ error: "Explain what must change." }, 400);
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 5 || reason.length > 1_000) {
    return json({ error: "Explain the change in 5 to 1000 characters." }, 400);
  }

  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
  let reservation: CloneReservation | undefined;
  let commitAttempted = false;
  let commitConfirmedFailed = false;

  try {
    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return json({ error: "Sign in to revise this review." }, 401);
    }

    const owned = await supabase
      .from("brief")
      .select("id, shop_id, status, shared_revision_id, approved_revision_id")
      .eq("id", briefId)
      .maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return json({ error: "Brief not found." }, 404);
    if (
      owned.data.status !== "awaiting_customer" ||
      !isStrictUuid(owned.data.shop_id) ||
      !isStrictUuid(owned.data.shared_revision_id) ||
      owned.data.approved_revision_id
    ) {
      return json({ error: "This brief has no active customer review to revise." }, 409);
    }

    admin = createSupabaseAdminClient();
    const reserved = await admin
      .rpc("reserve_review_revision_clone", {
        p_owner_id: userResult.data.user.id,
        p_brief_id: briefId,
        p_reason: reason,
      })
      .maybeSingle();
    if (reserved.error) {
      if (["42501", "55000", "P0001"].includes(reserved.error.code ?? "")) {
        return json({ error: "The customer review changed. Refresh and try again." }, 409);
      }
      throw reserved.error;
    }
    if (!reserved.data) throw new Error("Review clone reservation missing");
    reservation = reserved.data as CloneReservation;

    if (reservation.clone_state === "cleaning") {
      return json({ error: "An expired revision copy is being cleaned. Try again shortly." }, 409);
    }
    if (
      reservation.clone_state !== "reserved" ||
      !validReservation(reservation, {
        briefId,
        shopId: owned.data.shop_id,
        sourceRevisionId: owned.data.shared_revision_id,
      })
    ) {
      throw new Error("Review clone reservation failed identity checks.");
    }

    const expiresAt = Date.parse(reservation.reservation_expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 5_000) {
      await abandonClone(admin, reservation, "Review clone reservation expired before copy.");
      return json({ error: "The revision copy expired. Try again." }, 409);
    }

    const [sourceBody, sourceReference] = await Promise.all([
      admin.storage.from(BRIEF_IMAGE_BUCKET).download(reservation.source_body_path),
      admin.storage
        .from(BRIEF_IMAGE_BUCKET)
        .download(reservation.source_reference_path),
    ]);
    if (
      sourceBody.error ||
      sourceReference.error ||
      !sourceBody.data ||
      !sourceReference.data
    ) {
      throw sourceBody.error ??
        sourceReference.error ??
        new Error("Reviewed source images are unavailable.");
    }

    const [bodyBytes, referenceBytes] = await Promise.all([
      sourceBody.data.arrayBuffer().then((value) => Buffer.from(value)),
      sourceReference.data.arrayBuffer().then((value) => Buffer.from(value)),
    ]);
    if (expiresAt <= Date.now() + 1_000) {
      await abandonClone(admin, reservation, "Review clone reservation expired during copy.");
      return json({ error: "The revision copy expired. Try again." }, 409);
    }
    const [bodyStored, referenceStored] = await Promise.all([
      admin.storage
        .from(BRIEF_IMAGE_BUCKET)
        .upload(reservation.target_body_path, bodyBytes, {
          contentType: "image/jpeg",
          cacheControl: "0",
          upsert: true,
        }),
      admin.storage
        .from(BRIEF_IMAGE_BUCKET)
        .upload(reservation.target_reference_path, referenceBytes, {
          contentType: "image/jpeg",
          cacheControl: "0",
          upsert: true,
        }),
    ]);
    if (bodyStored.error || referenceStored.error) {
      throw bodyStored.error ??
        referenceStored.error ??
        new Error("Private revision copy failed.");
    }

    // Hash bytes read back from the exact target keys. This proves that commit
    // publishes only what private Storage actually retained.
    const [targetBody, targetReference] = await Promise.all([
      admin.storage.from(BRIEF_IMAGE_BUCKET).download(reservation.target_body_path),
      admin.storage
        .from(BRIEF_IMAGE_BUCKET)
        .download(reservation.target_reference_path),
    ]);
    if (
      targetBody.error ||
      targetReference.error ||
      !targetBody.data ||
      !targetReference.data
    ) {
      throw targetBody.error ??
        targetReference.error ??
        new Error("Copied images could not be verified.");
    }
    const hashes = {
      body: digest(Buffer.from(await targetBody.data.arrayBuffer())),
      reference: digest(Buffer.from(await targetReference.data.arrayBuffer())),
    };

    commitAttempted = true;
    let committed = await commitClone(admin, reservation, hashes);
    if (committed.error || !committed.data) {
      // The first HTTP response may be lost after a successful database commit.
      // The RPC is idempotent, so one exact retry resolves that ambiguity.
      committed = await commitClone(admin, reservation, hashes);
    }
    if (committed.error || !committed.data) {
      throw committed.error ?? new Error("Revision commit could not be confirmed.");
    }

    const result = committed.data as CloneCommit;
    if (
      result.committed !== true ||
      result.brief_id !== briefId ||
      result.source_revision_id !== reservation.source_revision_id ||
      result.target_revision_id !== reservation.target_revision_id ||
      result.target_issuance_id !== reservation.target_issuance_id ||
      !Number.isInteger(result.target_version) ||
      result.target_version < 2 ||
      typeof result.ready_at !== "string"
    ) {
      commitConfirmedFailed = true;
      await abandonClone(admin, reservation, "Review clone commit was rejected.");
      return json({ error: "The revision copy expired or changed. Try again." }, 409);
    }

    return json({
      revised: true,
      briefId,
      previousRevisionId: result.source_revision_id,
      revisionId: result.target_revision_id,
      version: result.target_version,
      status: "awaiting_tailor",
    });
  } catch (error) {
    if (admin && reservation && (!commitAttempted || commitConfirmedFailed)) {
      await abandonClone(
        admin,
        reservation,
        error instanceof Error ? error.message : "Review clone copy failed.",
      );
    }
    console.error(
      "Review revision clone failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(
      {
        error: commitAttempted && !commitConfirmedFailed
          ? "The revision result could not be confirmed. Refresh before retrying."
          : "We could not create the editable revision.",
      },
      500,
    );
  }
}