import assert from "node:assert/strict";
import test from "node:test";

import { normalizedImagePairHash } from "../lib/youcam/render-key";

test("render image-pair hash follows the database reservation contract", () => {
  assert.equal(
    normalizedImagePairHash("a".repeat(64), "b".repeat(64)),
    "10a1ab86abba7597f800d0c84719af8bc20307fd14b2c00f783ccb61fd392e0b",
  );
});

test("render image-pair hash is order-sensitive", () => {
  assert.notEqual(
    normalizedImagePairHash("a".repeat(64), "b".repeat(64)),
    normalizedImagePairHash("b".repeat(64), "a".repeat(64)),
  );
});

test("render image-pair hash rejects missing canonical hashes", () => {
  assert.throws(() => normalizedImagePairHash("not-a-hash", "b".repeat(64)));
});
