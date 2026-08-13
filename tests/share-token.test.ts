import assert from "node:assert/strict";
import test from "node:test";

import {
  generateShareToken,
  hashShareToken,
  isPlausibleShareToken,
} from "../lib/security/share-token-core";

test("generated share tokens are 256-bit base64url values", () => {
  const tokens = Array.from({ length: 8 }, () => generateShareToken());

  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.equal(token.length, 43);
    assert.equal(isPlausibleShareToken(token), true);
    assert.equal(token.includes("="), false);
  }
});

test("share-token validation rejects malformed values", () => {
  const valid = "A".repeat(43);
  assert.equal(isPlausibleShareToken(valid), true);

  for (const token of [
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}+`,
    `${"A".repeat(42)}/`,
    `${"A".repeat(42)} `,
  ]) {
    assert.equal(isPlausibleShareToken(token), false);
  }
});

test("share tokens are stored as deterministic SHA-256 hashes", () => {
  const token = "A".repeat(43);
  const digest = hashShareToken(token);

  assert.equal(digest, "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
});
