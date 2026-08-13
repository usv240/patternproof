import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const customer = readFileSync(
  new URL("../app/components/CustomerReview.tsx", import.meta.url),
  "utf8",
);
const approval = readFileSync(
  new URL("../app/api/share/[token]/approve/route.ts", import.meta.url),
  "utf8",
);

test("customer approval requires acknowledgement of every visible adjustment", () => {
  assert.match(customer, /I understand this exact adjustment/);
  assert.match(customer, /adjustmentsAcknowledged/);
  assert.match(customer, /acknowledgedAdjustmentIds: adjustmentRequirements\.map/);
  assert.match(customer, /!ready \|\| !adjustmentsAcknowledged \|\| !confirm/);
});

test("approval derives required adjustments from the frozen server snapshot", () => {
  assert.match(approval, /\.select\("shared_snapshot,/);
  assert.match(approval, /requirement\.feasibility\?\.status === "with_adjustment"/);
  assert.match(approval, /new Set\(acknowledgedAdjustmentIds\)\.size/);
  assert.match(approval, /requiredAdjustments\.some\(\(id, index\) => id !== acknowledged\[index\]\)/);
  assert.match(approval, /Confirm every tailor adjustment before approving/);
});

test("the new comprehension check preserves exact approval retry semantics", () => {
  assert.match(approval, /frozen\.data\.status === "approved"/);
  assert.match(approval, /approved_revision_id === revisionId/);
  assert.match(approval, /idempotent: true/);
});
