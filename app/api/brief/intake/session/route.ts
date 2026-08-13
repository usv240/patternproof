import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { readBoundedJsonBody, RequestBodyTooLargeError } from "../../../../../lib/security/bounded-json";
import { hasTrustedMutationOrigin } from "../../../../../lib/security/request-origin";
import {
  generateShareToken,
  hashShareToken,
} from "../../../../../lib/security/share-token";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "brief-images";
const MAX_BODY_BYTES = 4_096;
const CATEGORIES = new Set(["tops", "bottoms", "dresses", "one-pieces"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type IntakeSessionRequest = {
  customerLabel?: unknown;
  shopName?: unknown;
  garmentCategory?: unknown;
  bodyProcessingConfirmed?: unknown;
  rightsConfirmed?: unknown;
};

type LedgerCleanupState = {
  id: string;
  raw_cleanup_state: string;
  raw_removed_at: string | null;
};

type Issuance = LedgerCleanupState & {
  state: string;
  raw_body_path: string;
  raw_reference_path: string;
};

type DiscardedLedgerRow = {
  issuance_id: string;
  state: string;
  raw_cleanup_state: string;
  raw_removed_at: string | null;
  cleanup_object_paths: string[];
};

function cleanLabel(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : fallback;
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

async function recordImmediateRemoval(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ledgerRows: LedgerCleanupState[],
  succeeded: boolean,
) {
  const attemptedAt = new Date().toISOString();
  for (const ledger of ledgerRows) {
    if (ledger.raw_cleanup_state === "deleted" || ledger.raw_cleanup_state === "cleaning") {
      continue;
    }
    const update: Record<string, unknown> = {
      raw_cleanup_state: succeeded ? "removed" : "cleanup_required",
      cleanup_attempted_at: attemptedAt,
      last_error: succeeded ? null : "Private object cleanup requires retry.",
    };
    if (succeeded && !ledger.raw_removed_at) update.raw_removed_at = attemptedAt;
    const result = await admin.from("intake_issuance").update(update).eq("id", ledger.id);
    if (result.error) console.error("Intake cleanup state update failed", result.error.message);
  }
}

function cleanupRows(rows: DiscardedLedgerRow[]): LedgerCleanupState[] {
  return rows.map((row) => ({
    id: row.issuance_id,
    raw_cleanup_state: row.raw_cleanup_state,
    raw_removed_at: row.raw_removed_at,
  }));
}

function cleanupPaths(rows: DiscardedLedgerRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.cleanup_object_paths ?? []))];
}

async function removeDiscardedObjects(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  rows: DiscardedLedgerRow[],
) {
  const paths = cleanupPaths(rows);
  const removal = paths.length
    ? await admin.storage.from(BUCKET).remove(paths)
    : { error: null };
  await recordImmediateRemoval(admin, cleanupRows(rows), !removal.error);
}

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  if (!isSupabaseConfigured()) {
    return jsonError("Private brief storage is not configured yet.", 503);
  }

  let input: IntakeSessionRequest;
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES) as IntakeSessionRequest;
  } catch (error) {
    return jsonError(
      error instanceof RequestBodyTooLargeError
        ? "Private upload request is too large."
        : "A valid private upload request is required.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  let briefId: string | undefined;
  let ownerId: string | undefined;
  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;

  try {

    if (input.bodyProcessingConfirmed !== true || input.rightsConfirmed !== true) {
      return jsonError("Both image consent confirmations are required.", 400);
    }

    const category = typeof input.garmentCategory === "string"
      ? input.garmentCategory
      : "dresses";
    if (!CATEGORIES.has(category)) return jsonError("Unsupported garment category.", 400);

    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return jsonError("Sign in as a tailor to create a brief.", 401);
    }

    const shopResult = await supabase
      .rpc("get_or_create_owned_shop", {
        p_name: cleanLabel(input.shopName, "My tailoring studio", 120),
      })
      .single();
    if (shopResult.error || !shopResult.data) {
      throw shopResult.error ?? new Error("Shop missing");
    }

    ownerId = userResult.data.user.id;
    const shopId = String((shopResult.data as { id: string }).id);
    const revisionId = randomUUID();
    const uploadNonce = randomUUID();
    const issuanceId = randomUUID();
    briefId = randomUUID();
    const shareToken = generateShareToken();
    const shareExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    admin = createSupabaseAdminClient();

    const reservationResult = await admin
      .rpc("create_intake_reservation", {
        p_issuance_id: issuanceId,
        p_owner_id: ownerId,
        p_shop_id: shopId,
        p_brief_id: briefId,
        p_revision_id: revisionId,
        p_upload_nonce: uploadNonce,
        p_customer_label: cleanLabel(input.customerLabel, "Customer", 80),
        p_category: category,
        p_share_token_hash: hashShareToken(shareToken),
        p_token_expires_at: shareExpiresAt.toISOString(),
      })
      .single();
    if (reservationResult.error || !reservationResult.data) {
      throw reservationResult.error ?? new Error("Intake reservation missing");
    }
    const reservation = reservationResult.data as {
      accepted: boolean;
      issuance_id: string | null;
      body_path: string | null;
      reference_path: string | null;
      raw_body_path: string | null;
      raw_reference_path: string | null;
    };
    if (!reservation.accepted) {
      briefId = undefined;
      return jsonError("Brief creation limit reached. Try again in an hour.", 429);
    }
    if (
      !reservation.issuance_id
      || !reservation.body_path
      || !reservation.reference_path
      || !reservation.raw_body_path
      || !reservation.raw_reference_path
    ) {
      throw new Error("Intake reservation paths missing");
    }

    const issuance: Issuance = {
      id: reservation.issuance_id,
      state: "reserved",
      raw_cleanup_state: "pending",
      raw_removed_at: null,
      raw_body_path: reservation.raw_body_path,
      raw_reference_path: reservation.raw_reference_path,
    };

    const [bodyUpload, referenceUpload] = await Promise.all([
      admin.storage.from(BUCKET).createSignedUploadUrl(issuance.raw_body_path, { upsert: false }),
      admin.storage.from(BUCKET).createSignedUploadUrl(issuance.raw_reference_path, { upsert: false }),
    ]);
    if (bodyUpload.error || referenceUpload.error || !bodyUpload.data || !referenceUpload.data) {
      throw bodyUpload.error ?? referenceUpload.error ?? new Error("Upload session missing");
    }

    const activated = await admin.rpc("activate_intake_issuance", {
      p_issuance_id: issuance.id,
    });
    if (activated.error || typeof activated.data !== "string") {
      throw activated.error ?? new Error("Intake activation missing");
    }

    return NextResponse.json(
      {
        briefId,
        revisionId,
        expiresAt: activated.data,
        uploads: {
          body: { path: bodyUpload.data.path, token: bodyUpload.data.token },
          reference: { path: referenceUpload.data.path, token: referenceUpload.data.token },
        },
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (admin && ownerId && briefId) {
      const discarded = await admin.rpc("discard_incomplete_intake_draft", {
        p_owner_id: ownerId,
        p_brief_id: briefId,
      });
      if (discarded.error) {
        console.error("Failed intake draft rollback failed", discarded.error.message);
      } else {
        await removeDiscardedObjects(
          admin,
          (discarded.data ?? []) as DiscardedLedgerRow[],
        );
      }
    }
    console.error("Intake session creation failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not start the private upload.", 500);
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return jsonError("Untrusted request origin.", 403);
  if (!isSupabaseConfigured()) return jsonError("Private brief storage is not configured yet.", 503);

  let input: { briefId?: unknown };
  try {
    input = await readBoundedJsonBody(request, MAX_BODY_BYTES) as typeof input;
  } catch (error) {
    return jsonError(
      error instanceof RequestBodyTooLargeError
        ? "Draft cleanup request is too large."
        : "A valid draft cleanup request is required.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  try {
    if (typeof input.briefId !== "string" || !UUID.test(input.briefId)) {
      return jsonError("Invalid brief.", 400);
    }

    const supabase = await createSupabaseServerClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return jsonError("Sign in to discard this draft.", 401);
    }

    const admin = createSupabaseAdminClient();
    const discarded = await admin.rpc("discard_incomplete_intake_draft", {
      p_owner_id: userResult.data.user.id,
      p_brief_id: input.briefId,
    });
    if (discarded.error) throw discarded.error;
    const rows = (discarded.data ?? []) as DiscardedLedgerRow[];
    if (!rows.length) {
      return jsonError("Ready, reviewed, or active intakes cannot be discarded.", 409);
    }

    await removeDiscardedObjects(admin, rows);
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Draft cleanup failed", error instanceof Error ? error.message : "unknown");
    return jsonError("We could not discard the incomplete draft.", 500);
  }
}