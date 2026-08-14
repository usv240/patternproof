import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePrivateImage } from "../images/normalize";
import { isPrivateNetworkAddress } from "../security/public-ip";
import { revisionStoragePrefix } from "../security/storage-path";
import type { EvidenceFeature } from "./evidence-client";
import {
  cancelResponseBody,
  readBoundedResponseBlob,
  ResponseBodyLimitError,
} from "./bounded-response";

const MAX_RESULT_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function allowedResultHost(hostname: string): boolean {
  const patterns = (process.env.YOUCAM_RESULT_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return process.env.NODE_ENV !== "production";
  return patterns.some((pattern) => pattern.startsWith("*.")
    ? hostname.endsWith(pattern.slice(1)) && hostname !== pattern.slice(2)
    : hostname === pattern);
}

async function safeVendorUrl(value: string): Promise<URL> {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const address = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (
    url.protocol !== "https:" || url.username || url.password ||
    (url.port && url.port !== "443") || hostname === "localhost" ||
    hostname.endsWith(".localhost") || isPrivateNetworkAddress(address) ||
    !allowedResultHost(hostname)
  ) throw new Error("Vendor result URL failed network safety checks.");
  if (!isIP(address)) {
    const resolved = await lookup(address, { all: true, verbatim: true });
    if (resolved.length === 0 || resolved.some((entry) => isPrivateNetworkAddress(entry.address))) {
      throw new Error("Vendor result host resolved to a non-public address.");
    }
  }
  return url;
}

async function downloadVendorResult(
  value: string,
  feature: EvidenceFeature,
): Promise<{ blob: Blob; contentType: string }> {
  let url = await safeVendorUrl(value);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Vendor result redirected too many times.");
      url = await safeVendorUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Evidence download failed with HTTP ${response.status}.`);
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    const accepted = feature === "approved_motion"
      ? contentType === "video/mp4"
      : contentType === "image/jpeg" || contentType === "image/png";
    if (!accepted) {
      await cancelResponseBody(response);
      throw new Error("Vendor result had an unsupported media type.");
    }
    try {
      return { blob: await readBoundedResponseBlob(response, MAX_RESULT_BYTES), contentType };
    } catch (error) {
      if (error instanceof ResponseBodyLimitError) throw new Error("Vendor result exceeded size limit.");
      throw error;
    }
  }
  throw new Error("Vendor result could not be downloaded.");
}

export async function storeEvidenceResult(input: {
  supabase: SupabaseClient;
  revisionId: string;
  feature: EvidenceFeature;
  vendorUrl: string;
}) {
  const { data: revision, error: revisionError } = await input.supabase
    .from("revision")
    .select("id, brief_id")
    .eq("id", input.revisionId)
    .single();
  if (revisionError) throw revisionError;
  const { data: brief, error: briefError } = await input.supabase
    .from("brief")
    .select("shop_id")
    .eq("id", revision.brief_id)
    .single();
  if (briefError) throw briefError;
  const prefix = revisionStoragePrefix(String(brief.shop_id), String(revision.brief_id), String(revision.id));
  if (!prefix) throw new Error("Evidence storage ownership path is invalid.");

  const downloaded = await downloadVendorResult(input.vendorUrl, input.feature);
  let bytes: Uint8Array;
  let contentType: string;
  let suffix: string;
  if (input.feature === "approved_motion") {
    bytes = new Uint8Array(await downloaded.blob.arrayBuffer());
    contentType = "video/mp4";
    suffix = "mp4";
  } else {
    const normalized = await normalizePrivateImage(downloaded.blob);
    bytes = normalized.bytes;
    contentType = normalized.contentType;
    suffix = "jpg";
  }
  const resultHash = createHash("sha256").update(bytes).digest("hex");
  const stem = input.feature === "background_removal"
    ? "reference-clean"
    : input.feature === "fabric_vto" ? "fabric" : "motion";
  const resultPath = `${prefix}/${stem}-${resultHash}.${suffix}`;

  const uploaded = await input.supabase.storage.from("brief-images").upload(resultPath, bytes, {
    contentType,
    cacheControl: "0",
    upsert: true,
  });
  if (uploaded.error) throw uploaded.error;
  return { resultPath, resultHash };
}

export async function signedEvidenceResult(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  const signed = await supabase.storage.from("brief-images").createSignedUrl(path, 5 * 60);
  if (signed.error || !signed.data) throw signed.error ?? new Error("Stored evidence URL missing");
  return signed.data.signedUrl;
}
