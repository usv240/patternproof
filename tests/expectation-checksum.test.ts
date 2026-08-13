import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateExpectationChecksum } from "../lib/expectation-checksum";

test("all three independent keys are required to release cutting", () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const result = evaluateExpectationChecksum({
      visualEvidence: Boolean(mask & 1),
      craftDecision: Boolean(mask & 2),
      customerConsent: Boolean(mask & 4),
    });
    assert.equal(result.completed, Number(Boolean(mask & 1)) + Number(Boolean(mask & 2)) + Number(Boolean(mask & 4)));
    assert.equal(result.released, mask === 7);
  }
});

test("the gate assigns one independent holder to each key", () => {
  const result = evaluateExpectationChecksum({
    visualEvidence: true,
    craftDecision: true,
    customerConsent: true,
  });
  assert.deepEqual(result.keys.map((key) => key.holder), ["YouCam", "Tailor", "Customer"]);
  assert.equal(new Set(result.keys.map((key) => key.id)).size, 3);
});

test("the visible interlock communicates both physical release states", () => {
  const component = readFileSync(
    new URL("../app/components/ExpectationChecksum.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /Expectation Checksum/);
  assert.match(component, /DO NOT CUT/);
  assert.match(component, /CUT RELEASED/);
  assert.match(component, /SHA-256/);
});

test("tailor, customer, and Judge Mode share the same interlock component", () => {
  for (const path of [
    "../app/components/TailorWorkspace.tsx",
    "../app/components/CustomerReview.tsx",
    "../app/components/JudgeMode.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /ExpectationChecksum/);
    assert.match(source, /evaluateExpectationChecksum/);
  }
});
