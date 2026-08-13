import assert from "node:assert/strict";
import test from "node:test";

import {
  isCanonicalRevisionAssetPath,
  revisionStoragePrefix,
} from "../lib/security/storage-path";

const shop = "11111111-1111-4111-8111-111111111111";
const brief = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";

test("revision assets are bound to canonical owner identifiers", () => {
  const prefix = revisionStoragePrefix(shop, brief, revision);
  assert.equal(prefix, `${shop}/${brief}/${revision}`);
  assert.equal(isCanonicalRevisionAssetPath(`${prefix}/body.jpg`, prefix!, "body"), true);
  assert.equal(
    isCanonicalRevisionAssetPath(`${prefix}/reference.jpg`, prefix!, "reference"),
    true,
  );
  assert.equal(
    isCanonicalRevisionAssetPath(`${prefix}/render-${"a".repeat(64)}.jpg`, prefix!, "render"),
    true,
  );
});

test("cross-revision and legacy random render paths are rejected", () => {
  const prefix = revisionStoragePrefix(shop, brief, revision)!;
  assert.equal(
    isCanonicalRevisionAssetPath(`${shop}/${brief}/${shop}/reference.jpg`, prefix, "reference"),
    false,
  );
  assert.equal(
    isCanonicalRevisionAssetPath(`${prefix}/render-random.jpg`, prefix, "render"),
    false,
  );
});

test("noncanonical identifiers cannot form an asset prefix", () => {
  assert.equal(revisionStoragePrefix("../other-shop", brief, revision), undefined);
});
