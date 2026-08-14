import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sample = readFileSync(new URL("../app/components/SampleCutCard.tsx", import.meta.url), "utf8");
const createPage = readFileSync(new URL("../app/create/page.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../app/components/CutCardEntry.tsx", import.meta.url), "utf8");
const legacyJudge = readFileSync(new URL("../app/judge/page.tsx", import.meta.url), "utf8");
const legacyDemo = readFileSync(new URL("../app/demo/page.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const icon = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");

test("the ready sample is a clearly labelled, no-write Cut Card journey", () => {
  assert.match(sample, /Sample Cut Card/);
  assert.match(sample, /Nothing uploaded or saved/);
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
  assert.match(sample, /108 de-identified 1&ndash;2-star tailoring complaints/);
  assert.match(sample, /bounded negative-sample finding, not prevalence/);
});

test("one Cut Card entry opens the working sample and offers one dedicated private creation action", () => {
  assert.match(home, /href="\/create">Create a Cut Card/);
  assert.doesNotMatch(home, /Enter Judge Mode|href="\/judge"/);
  assert.match(createPage, /<CutCardEntry \/>/);
  assert.match(entry, /<SampleCutCard \/>/);
  assert.match(sample, /Create with my photos/);
  assert.match(sample, /Ready to create your own Cut Card\?/);
  assert.match(sample, /isolated private workspace\. No account needed/);
  assert.match(sample, /private-creation-banner/);
  assert.doesNotMatch(sample, /Replace sample with my photos|Use my photos/);
  assert.match(sample, /GuestWorkspaceButton/);
  assert.match(sample, /scrollIntoView/);
  assert.match(sample, /prefers-reduced-motion/);
  assert.match(sample, /ref=\{stageRef\}/);
  assert.doesNotMatch(entry, /How would you like to start\?|setSource/);
  assert.doesNotMatch(createPage, /login\?next=/);
  assert.match(legacyJudge, /redirect\("\/create\?source=sample"\)/);
  assert.match(legacyDemo, /redirect\("\/create\?source=sample"\)/);
});
test("the homepage release sequence stays inside one responsive content grid", () => {
  assert.match(home, /className="process-inner"/);
  assert.match(home, /Three keys before the cut/);
  assert.match(globalCss, /\.process-inner\{width:min\(100%,1120px\);margin:0 auto\}/);
  assert.match(globalCss, /\.steps\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(globalCss, /\.steps article\{[^}]*100vw/);
  assert.match(globalCss, /@media\(max-width:800px\)[^{]*\{[^}]*\.process-section/);
});
test("judge-facing entry copy and mobile navigation remain accessible", () => {
  assert.match(home, /mean\{" "\}<br\/>/);
  assert.match(home, /intent\.\{" "\}<br\/>/);
  assert.doesNotMatch(home, /â/);
  assert.match(sample, /className="judge-mobile-controls"/);
  assert.match(globalCss, /\.judge-mobile-controls\{display:none\}/);
  assert.match(globalCss, /\.sample-workspace \.judge-mobile-controls\{position:sticky/);
  assert.match(globalCss, /\.sample-workspace \.judge-explainer>\.judge-controls\{display:none\}/);
  assert.match(icon, /<svg[^>]+viewBox="0 0 64 64"/);
});
