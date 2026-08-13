import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_BUCKET_BYTES,
  hasExpectedPrivateImageBucket,
  hasValidPrivacyContact,
  hasValidYouCamResultHosts,
} from "../lib/release-readiness";

test("release host allowlist accepts exact and leading-wildcard DNS hosts", () => {
  assert.equal(
    hasValidYouCamResultHosts("yce-us.s3-accelerate.amazonaws.com"),
    true,
  );
  assert.equal(
    hasValidYouCamResultHosts("yce-us.s3-accelerate.amazonaws.com, *.vendor.example"),
    true,
  );
});

test("release host allowlist rejects empty, URL, port, and bare wildcard values", () => {
  assert.equal(hasValidYouCamResultHosts(undefined), false);
  assert.equal(hasValidYouCamResultHosts("*"), false);
  assert.equal(hasValidYouCamResultHosts("https://vendor.example"), false);
  assert.equal(hasValidYouCamResultHosts("vendor.example:443"), false);
  assert.equal(hasValidYouCamResultHosts("localhost"), false);
});

test("release privacy contact must be a plausible email address", () => {
  assert.equal(hasValidPrivacyContact("privacy@example.org"), true);
  assert.equal(hasValidPrivacyContact("not-an-email"), false);
  assert.equal(hasValidPrivacyContact(undefined), false);
});

test("release image bucket must remain private and exactly constrained", () => {
  const ready = {
    public: false,
    file_size_limit: EXPECTED_BUCKET_BYTES,
    allowed_mime_types: ["image/png", "image/jpeg"],
  };
  assert.equal(hasExpectedPrivateImageBucket(ready), true);
  assert.equal(hasExpectedPrivateImageBucket({ ...ready, public: true }), false);
  assert.equal(
    hasExpectedPrivateImageBucket({ ...ready, file_size_limit: null }),
    false,
  );
  assert.equal(
    hasExpectedPrivateImageBucket({ ...ready, allowed_mime_types: ["image/jpeg"] }),
    false,
  );
  assert.equal(
    hasExpectedPrivateImageBucket({
      ...ready,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    }),
    false,
  );
});

test("health readiness invokes the exact private-bucket contract", () => {
  const health = readFileSync(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(health, /!hasExpectedPrivateImageBucket\(bucket\.data\)/);
});