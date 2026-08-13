import assert from "node:assert/strict";
import test from "node:test";
import { buildPilotReport, parsePilotRecords } from "../lib/pilot-metrics";

const records = [
  { recordId: "B-001", studioCode: "SHOP-01", phase: "baseline", completed: true, clarificationCycles: 3, agreementMinutes: 30, preCutChange: false, postApprovalChange: true, expectationRelatedRework: true, customerConfidence: 2, tailorConfidence: 3 },
  { recordId: "B-002", studioCode: "SHOP-01", phase: "baseline", completed: false, clarificationCycles: 4, agreementMinutes: null, preCutChange: false, postApprovalChange: false, expectationRelatedRework: false, customerConfidence: null, tailorConfidence: 2 },
  { recordId: "P-001", studioCode: "SHOP-01", phase: "patternproof", completed: true, clarificationCycles: 1, agreementMinutes: 12, preCutChange: true, postApprovalChange: false, expectationRelatedRework: false, customerConfidence: 5, tailorConfidence: 4 },
  { recordId: "P-002", studioCode: "SHOP-02", phase: "patternproof", completed: true, clarificationCycles: 1, agreementMinutes: 18, preCutChange: false, postApprovalChange: false, expectationRelatedRework: false, customerConfidence: 4, tailorConfidence: 5 },
];

test("pilot parser rejects unsupported fields so personal data cannot drift into the dataset", () => {
  assert.throws(() => parsePilotRecords([{ ...records[0], customerName: "Do not collect" }]), /unsupported fields.*personal data/i);
});
test("pilot parser rejects duplicate records and inconsistent incomplete rows", () => {
  assert.throws(() => parsePilotRecords([records[0], records[0]]), /Duplicate recordId/);
  assert.throws(() => parsePilotRecords([{ ...records[1], agreementMinutes: 10 }]), /cannot have agreementMinutes when incomplete/);
});
test("pilot report produces reproducible descriptive phase metrics", () => {
  const report = buildPilotReport(parsePilotRecords(records));
  assert.equal(report.status, "descriptive_only");
  assert.equal(report.records, 4);
  assert.equal(report.studios, 2);
  assert.equal(report.baseline.completionRate, 0.5);
  assert.equal(report.patternproof.completionRate, 1);
  assert.equal(report.baseline.medianClarificationCycles, 3.5);
  assert.equal(report.patternproof.medianAgreementMinutes, 15);
  assert.equal(report.descriptiveDifference.completionRatePoints, 0.5);
  assert.equal(report.descriptiveDifference.medianClarificationCycles, -2.5);
  assert.equal(report.descriptiveDifference.medianAgreementMinutes, -15);
  assert.match(report.caveat, /does not establish causality/i);
});
test("pilot report requires both phases", () => {
  assert.throws(() => buildPilotReport(parsePilotRecords(records.slice(0, 2))), /at least one baseline and one PatternProof record/);
});
