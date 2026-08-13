import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const judge = readFileSync(new URL("../app/components/JudgeMode.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/judge/page.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Judge Mode is a clearly labelled, no-write guided product story", () => {
  assert.match(judge, /synthetic, no-write walkthrough/);
  assert.match(judge, /Recorded YouCam Clothes VTO V3 result/);
  assert.match(judge, /not a fit, construction, measurement, fabric, or final-appearance guarantee/);
  assert.doesNotMatch(judge, /fetch\(|XMLHttpRequest|request\.json/);
});

test("Judge Mode exposes all six differentiated workflow stages", () => {
  for (const label of [
    "Private intent",
    "YouCam evidence",
    "Human veto",
    "Revision replay",
    "Consent to cut",
    "Privacy exit",
  ]) {
    assert.match(judge, new RegExp(label, "i"));
  }
  assert.match(judge, /CutReadinessPassport/);
  assert.match(judge, /Byte-identical SHA-256/);
  assert.match(judge, /108 de-identified 1–2-star tailoring complaints/);
  assert.match(judge, /bounded negative-sample finding, not prevalence/);
});

test("the public entry path foregrounds Judge Mode and immutable evidence", () => {
  assert.match(home, /href="\/judge">Enter Judge Mode/);
  assert.match(page, /href="\/proof">Evidence/);
  assert.match(page, /href="\/s\/demo-olive">Public Cut Card/);
});
