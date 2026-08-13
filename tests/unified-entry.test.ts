import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sample = readFileSync(new URL("../app/components/SampleCutCard.tsx", import.meta.url), "utf8");
const createPage = readFileSync(new URL("../app/create/page.tsx", import.meta.url), "utf8");
const legacyJudge = readFileSync(new URL("../app/judge/page.tsx", import.meta.url), "utf8");
const legacyDemo = readFileSync(new URL("../app/demo/page.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the ready sample is a clearly labelled, no-write Cut Card journey", () => {
  assert.match(sample, /Ready sample · interactive Cut Card/);
  assert.match(sample, /Nothing here writes to a customer record or makes a billable YouCam request/);
  assert.match(sample, /Recorded YouCam Clothes VTO V3 result/);
  assert.match(sample, /not a fit, construction, measurement, fabric, or final-appearance guarantee/);
  assert.doesNotMatch(sample, /fetch\(|XMLHttpRequest|request\.json/);
});

test("the sample exposes all six differentiated workflow stages", () => {
  for (const label of [
    "Private intent",
    "YouCam evidence",
    "Human veto",
    "Revision replay",
    "Consent to cut",
    "Privacy exit",
  ]) {
    assert.match(sample, new RegExp(label, "i"));
  }
  assert.match(sample, /CutReadinessPassport/);
  assert.match(sample, /Byte-identical SHA-256/);
  assert.match(sample, /108 de-identified 1–2-star tailoring complaints/);
  assert.match(sample, /bounded negative-sample finding, not prevalence/);
});

test("one Cut Card entry offers sample photos or consent-bound private photos", () => {
  assert.match(home, /href="\/create">Create a Cut Card/);
  assert.doesNotMatch(home, /Enter Judge Mode|href="\/judge"/);
  assert.match(createPage, /Use sample photos/);
  assert.match(createPage, /Use my photos/);
  assert.match(createPage, /No sign-in · no database writes · no API spend/);
  assert.match(createPage, /Consent first · normalized private uploads · bounded API use/);
  assert.match(createPage, /signedIn\s*\?\s*"\/brief\/new"/);
  assert.match(createPage, /"\/login\?next=%2Fbrief%2Fnew"/);
  assert.match(legacyJudge, /redirect\("\/create#workspace"\)/);
  assert.match(legacyDemo, /redirect\("\/create#workspace"\)/);
});

test("the homepage release sequence stays inside one responsive content grid", () => {
  assert.match(home, /className="process-inner"/);
  assert.match(home, /Three keys before the cut/);
  assert.match(globalCss, /\.process-inner\{width:min\(100%,1120px\);margin:0 auto\}/);
  assert.match(globalCss, /\.steps\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(globalCss, /\.steps article\{[^}]*100vw/);
  assert.match(globalCss, /@media\(max-width:800px\)[^{]*\{[^}]*\.process-section/);
});