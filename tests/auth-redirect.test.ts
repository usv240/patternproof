import assert from "node:assert/strict";
import test from "node:test";

import { safePostAuthPath } from "../lib/security/app-origin";

test("post-auth redirects stay inside owner brief routes", () => {
  assert.equal(safePostAuthPath("/brief"), "/brief");
  assert.equal(safePostAuthPath("/brief/new"), "/brief/new");
  assert.equal(
    safePostAuthPath("/brief/018f7f6e-7b3a-7cc4-8b39-3a5e40b8bead"),
    "/brief/018f7f6e-7b3a-7cc4-8b39-3a5e40b8bead",
  );
});

test("post-auth redirects reject external, ambiguous, and query-bearing paths", () => {
  for (const candidate of [
    "https://evil.example",
    "//evil.example",
    "/brief/new?next=https://evil.example",
    "/brief/../privacy",
    "/brief\\new",
    "javascript:alert(1)",
    null,
  ]) {
    assert.equal(safePostAuthPath(candidate), "/brief");
  }
});
