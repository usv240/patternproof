import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("magic-link sign-in cannot create uninvited users", () => {
  const source = readFileSync(
    new URL("../app/api/auth/magic-link/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /signInWithOtp\(\{[\s\S]*?options:\s*\{[\s\S]*?shouldCreateUser:\s*false,/,
  );
  assert.doesNotMatch(
    source,
    /Magic-link provider request failed[\s\S]{0,300}(?:status:\s*502|,\s*502\))/,
  );
});
