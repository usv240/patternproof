import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCutReadiness } from "../lib/cut-readiness";

test("an incomplete feasibility review is not ready to cut", () => {
  const result = evaluateCutReadiness({
    rightsConfirmed: true,
    previewReady: true,
    requirements: [{ status: null }],
    snapshotFrozen: false,
    customerApproved: false,
  });
  assert.equal(result.state, "not_ready");
  assert.equal(result.completed, 2);
});

test("an infeasible promise blocks readiness even after every decision", () => {
  const result = evaluateCutReadiness({
    rightsConfirmed: true,
    previewReady: true,
    requirements: [{ status: "not_feasible" }],
    snapshotFrozen: false,
    customerApproved: false,
  });
  assert.equal(result.state, "not_ready");
  assert.equal(result.checks.find((check) => check.id === "decisions")?.complete, true);
  assert.equal(result.checks.find((check) => check.id === "feasible")?.complete, false);
});

test("a frozen feasible snapshot waits for customer approval", () => {
  const result = evaluateCutReadiness({
    rightsConfirmed: true,
    previewReady: true,
    requirements: [{ status: "with_adjustment", tailorNote: "Raise neckline 2 cm." }],
    snapshotFrozen: true,
    customerApproved: false,
  });
  assert.equal(result.state, "awaiting_customer");
  assert.equal(result.completed, 5);
});

test("only six satisfied conditions produce CUT READY", () => {
  const result = evaluateCutReadiness({
    rightsConfirmed: true,
    previewReady: true,
    requirements: [{ status: "as_shown" }],
    snapshotFrozen: true,
    customerApproved: true,
  });
  assert.equal(result.state, "cut_ready");
  assert.equal(result.completed, 6);
});


test("a change request blocks cutting and creates an explicit state", () => {
  const result = evaluateCutReadiness({
    rightsConfirmed: true,
    previewReady: true,
    requirements: [{ status: "as_shown" }],
    snapshotFrozen: true,
    customerApproved: false,
    changeRequested: true,
  });
  assert.equal(result.state, "change_requested");
  assert.equal(result.completed, 5);
});
