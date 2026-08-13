import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasValidMaintenanceAuthorization,
  hasValidMaintenanceSecret,
} from "../lib/intake-maintenance";

test("maintenance secrets enforce the documented safe header bounds", () => {
  const minimum = "a".repeat(32);
  assert.equal(hasValidMaintenanceSecret(minimum), true);
  assert.equal(hasValidMaintenanceSecret("a".repeat(31)), false);
  assert.equal(hasValidMaintenanceSecret("a".repeat(4_089)), true);
  assert.equal(hasValidMaintenanceSecret("a".repeat(4_090)), false);
  assert.equal(hasValidMaintenanceSecret("a".repeat(31) + " "), false);
  assert.equal(hasValidMaintenanceSecret("a".repeat(31) + "é"), false);
  assert.equal(hasValidMaintenanceSecret(undefined), false);
  assert.equal(
    hasValidMaintenanceAuthorization("Bearer short", "short"),
    false,
  );
});

test("health and maintenance routes reject weak configured secrets", () => {
  const health = readFileSync(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8",
  );
  const maintenance = readFileSync(
    new URL("../app/api/maintenance/intake-cleanup/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    health,
    /!hasValidMaintenanceSecret\(process\.env\.CRON_SECRET\)/,
  );
  assert.match(
    maintenance,
    /!hasValidMaintenanceSecret\(cronSecret\)/,
  );
});
