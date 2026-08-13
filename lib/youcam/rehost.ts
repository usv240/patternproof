import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePrivateImage } from "../images/normalize";
import {
  isCanonicalRevisionAssetPath,
  revisionStoragePrefix,
} from "../security/storage-path";
import { isPrivateNetworkAddress } from "../security/public-ip";
import {
  cancelResponseBody,
  readBoundedResponseBlob,
  ResponseBodyLimitError,
} from "./bounded-response";

const MAX_RESULT_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function privateIp(hostname: string): boolean {
  return isPrivateNetworkAddress(hostname);
}

function allowedResultHost(hostname: string): boolean {
  const patterns = (process.env.YOUCAM_RESULT_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return process.env.NODE_ENV !== "production";
  return patterns.some((pattern) => (
    pattern.startsWith("*.")
      ? hostname.endsWith(pattern.slice(1)) && hostname !== pattern.slice(2)
      : hostname === pattern
  ));
}

async function safeVendorUrl(value: string): Promise<URL> {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const address = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    privateIp(address) ||
    !allowedResultHost(hostname)
  ) {
    throw new Error("Vendor result URL failed network safety checks.");
  }
  if (!isIP(address)) {
    const resolved = await lookup(address, { all: true, verbatim: true });
    if (resolved.length === 0 || resolved.some((entry) => privateIp(entry.address))) {
      throw new Error("Vendor result host resolved to a non-public address.");
    }
  }
  return url;
}

async function downloadVendorImage(value: string): Promise<Blob> {
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
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error("Vendor result redirected too many times.");
      }
      url = await safeVendorUrl(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Render download failed with HTTP ${response.status}.`);
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0];
    if (contentType !== "image/jpeg" && contentType !== "image/png") {
      await cancelResponseBody(response);
      throw new Error("Vendor result was not a supported image.");
    }
    try {
      return await readBoundedResponseBlob(response, MAX_RESULT_BYTES);
    } catch (error) {
      if (error instanceof ResponseBodyLimitError) {
        throw new Error("Vendor result exceeded size limit.");
      }
      throw error;
    }
  }

  throw new Error("Vendor result could not be downloaded.");
}

async function revisionLocation(
  supabase: SupabaseClient,
  revisionId: string,
  options: { requireUnlocked: boolean },
) {
  const { data: revision, error: revisionError } = await supabase
    .from("revision")
    .select("id, brief_id, render_path, locked_at")
    .eq("id", revisionId)
    .single();
  if (revisionError) throw revisionError;
  if (options.requireUnlocked && revision.locked_at) {
    throw new Error("Approved revision cannot accept a new render.");
  }

  const { data: brief, error: briefError } = await supabase
    .from("brief")
    .select("shop_id, status")
    .eq("id", revision.brief_id)
    .single();
  if (briefError) throw briefError;
  if (
    options.requireUnlocked &&
    ["awaiting_customer", "approved", "archived"].includes(String(brief.status))
  ) {
    throw new Error("A revision under customer review cannot accept a new render.");
  }
  return { ...revision, shopId: String(brief.shop_id) };
}

export async function signedStoredRender(
  supabase: SupabaseClient,
  revisionId: string,
) {
  const location = await revisionLocation(supabase, revisionId, {
    requireUnlocked: false,
  });
  if (!location.render_path) return null;
  const prefix = revisionStoragePrefix(location.shopId, location.brief_id, location.id);
  if (!prefix || !isCanonicalRevisionAssetPath(location.render_path, prefix, "render")) {
    throw new Error("Stored render path failed ownership checks.");
  }
  const { data, error } = await supabase.storage
    .from("brief-images")
    .createSignedUrl(location.render_path, 5 * 60);
  if (error || !data) throw error ?? new Error("Stored render URL missing");
  return data.signedUrl;
}

export async function rehostSuccessfulRender(input: {
  supabase: SupabaseClient;
  revisionId: string;
  vendorUrl: string;
}) {
  const location = await revisionLocation(input.supabase, input.revisionId, {
    requireUnlocked: true,
  });
  if (location.render_path) {
    return signedStoredRender(input.supabase, input.revisionId);
  }

  const vendorBlob = await downloadVendorImage(input.vendorUrl);
  const normalized = await normalizePrivateImage(vendorBlob);
  const renderHash = createHash("sha256").update(normalized.bytes).digest("hex");
  const objectPath =
    `${location.shopId}/${location.brief_id}/${location.id}/render-${renderHash}.jpg`;

  const uploaded = await input.supabase.storage
    .from("brief-images")
    .upload(objectPath, normalized.bytes, {
      contentType: normalized.contentType,
      cacheControl: "0",
      upsert: true,
    });
  if (uploaded.error) throw uploaded.error;

  const updated = await input.supabase
    .from("revision")
    .update({ render_path: objectPath, render_hash: renderHash })
    .eq("id", location.id)
    .is("locked_at", null)
    .is("render_path", null)
    .select("id")
    .maybeSingle();
  if (updated.error) {
    const current = await input.supabase
      .from("revision")
      .select("render_path")
      .eq("id", location.id)
      .maybeSingle();
    if (!current.error && current.data?.render_path === objectPath) {
      return signedStoredRender(input.supabase, input.revisionId);
    }
    if (!current.error) {
      const references = await input.supabase
        .from("revision")
        .select("id", { count: "exact", head: true })
        .eq("render_path", objectPath);
      if (!references.error && (references.count ?? 0) === 0) {
        await input.supabase.storage.from("brief-images").remove([objectPath]);
      }
    }
    throw updated.error;
  }

  if (!updated.data) {
    const current = await input.supabase
      .from("revision")
      .select("render_path")
      .eq("id", location.id)
      .single();
    if (current.error) throw current.error;
    if (current.data.render_path !== objectPath) {
      const references = await input.supabase
        .from("revision")
        .select("id", { count: "exact", head: true })
        .eq("render_path", objectPath);
      if (!references.error && (references.count ?? 0) === 0) {
        await input.supabase.storage.from("brief-images").remove([objectPath]);
      }
    }
  }

  return signedStoredRender(input.supabase, input.revisionId);
}
