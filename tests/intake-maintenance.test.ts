import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteExpiredIncompleteDraft,
  hasReadyIntakeSpec,
  hasValidMaintenanceAuthorization,
  isFinalizationActive,
} from "../lib/intake-maintenance";

test("maintenance bearer authentication fails closed", () => {
  const secret = "cron-secret-with-at-least-32-random-characters";
  assert.equal(hasValidMaintenanceAuthorization(`Bearer ${secret}`, secret), true);
  assert.equal(hasValidMaintenanceAuthorization("Bearer wrong-secret", secret), false);
  assert.equal(hasValidMaintenanceAuthorization(secret, secret), false);
  assert.equal(hasValidMaintenanceAuthorization(null, secret), false);
  assert.equal(hasValidMaintenanceAuthorization("Bearer ", secret), false);
  assert.equal(hasValidMaintenanceAuthorization(`Bearer ${secret}`, undefined), false);
});

test("ready intake and active finalization state are detected conservatively", () => {
  const now = new Date("2026-08-02T20:00:00.000Z");
  assert.equal(hasReadyIntakeSpec({ intake_ready_at: "2026-08-02T19:00:00.000Z" }), true);
  assert.equal(hasReadyIntakeSpec({ intake_ready_at: "   " }), false);
  assert.equal(hasReadyIntakeSpec(null), false);
  assert.equal(isFinalizationActive("finalizing", "2026-08-02T19:50:00.000Z", now), true);
  assert.equal(isFinalizationActive("finalizing", "2026-08-02T19:40:00.000Z", now), false);
  assert.equal(isFinalizationActive("issued", "2026-08-02T19:59:00.000Z", now), false);
  assert.equal(isFinalizationActive("finalizing", "invalid", now), true);
});

test("automatic deletion is limited to expired, incomplete draft briefs", () => {
  const now = new Date("2026-08-02T20:00:00.000Z");
  const candidate = {
    now,
    expiresAt: "2026-08-02T19:00:00.000Z",
    status: "draft",
    approvedRevisionId: null,
    ledgerReady: false,
    finalizationActive: false,
    revisions: [{ locked_at: null, garment_spec: {} }],
  };
  assert.equal(canDeleteExpiredIncompleteDraft(candidate), true);
  assert.equal(canDeleteExpiredIncompleteDraft({ ...candidate, status: "awaiting_tailor" }), false);
  assert.equal(canDeleteExpiredIncompleteDraft({ ...candidate, ledgerReady: true }), false);
  assert.equal(canDeleteExpiredIncompleteDraft({ ...candidate, finalizationActive: true }), false);
  assert.equal(
    canDeleteExpiredIncompleteDraft({
      ...candidate,
      revisions: [{ locked_at: null, garment_spec: { intake_ready_at: now.toISOString() } }],
    }),
    false,
  );
  assert.equal(
    canDeleteExpiredIncompleteDraft({
      ...candidate,
      revisions: [{ locked_at: now.toISOString(), garment_spec: {} }],
    }),
    false,
  );
  assert.equal(
    canDeleteExpiredIncompleteDraft({
      ...candidate,
      expiresAt: "2026-08-02T21:00:00.000Z",
    }),
    false,
  );
});
