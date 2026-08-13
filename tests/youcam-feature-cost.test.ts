import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  fileURLToPath(new URL("../scripts/youcam-feature-cost.mjs", import.meta.url)),
  "utf8",
);

test("feature-cost validation pages the official endpoint without exposing credentials", () => {
  assert.match(
    script,
    /https:\/\/yce-api-01\.makeupar\.com\/s2s\/v2\.0\/credit\/feature-cost/,
  );
  assert.match(script, /url\.searchParams\.set\("starting_token", startingToken\)/);
  assert.match(script, /Authorization: "Bearer " \+ process\.env\.YOUCAM_API_KEY/);
  assert.doesNotMatch(script, /console\.(?:log|info|debug|warn)/);
  assert.doesNotMatch(script, /JSON\.stringify\(process\.env/);
  assert.doesNotMatch(
    script,
    /process\.(?:stdout|stderr)\.write\([^;]*YOUCAM_API_KEY/,
  );
  assert.equal(script.match(/process\.stdout\.write/g)?.length, 1);
});

test("feature-cost validation emits only Clothes-matching SKU entries", () => {
  assert.match(
    script,
    /const entries = skus\.filter\(\(entry\) =>[\s\S]*JSON\.stringify\(entry\)\.toLowerCase\(\)\.includes\("cloth"\)/,
  );
  assert.match(script, /JSON\.stringify\(\{ clothes_feature_costs: entries \}/);
  assert.doesNotMatch(script, /JSON\.stringify\(\{ skus \}/);
});
