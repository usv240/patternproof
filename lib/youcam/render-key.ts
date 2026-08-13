import { createHash } from "node:crypto";

export const YOUCAM_RENDER_API_VERSION = "cloth-v3";
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function normalizedImagePairHash(bodySha256: string, referenceSha256: string): string {
  if (!SHA256_HEX.test(bodySha256) || !SHA256_HEX.test(referenceSha256)) {
    throw new Error("Canonical image hashes are missing or invalid.");
  }
  return createHash("sha256")
    .update(`patternproof-render-input-v1:${bodySha256}:${referenceSha256}`, "utf8")
    .digest("hex");
}
