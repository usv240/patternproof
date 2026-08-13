import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedBrowserOrigin, resolveAppOrigin } from "../lib/security/app-origin";
import { consumeMagicLinkAttempt } from "../lib/security/auth-rate-limit";

test("production auth redirects require a configured HTTPS origin", () => {
  assert.equal(
    resolveAppOrigin({ configuredUrl: "https://patternproof.example/", nodeEnv: "production" }),
    "https://patternproof.example",
  );
  assert.throws(() => resolveAppOrigin({ nodeEnv: "production", requestOrigin: "https://attacker.example" }));
  assert.throws(() => resolveAppOrigin({ configuredUrl: "http://patternproof.example", nodeEnv: "production" }));
  assert.throws(() => resolveAppOrigin({ configuredUrl: "https://patternproof.example/redirect", nodeEnv: "production" }));
});

test("development fallback is restricted to loopback", () => {
  assert.equal(
    resolveAppOrigin({ nodeEnv: "development", requestOrigin: "http://localhost:3000" }),
    "http://localhost:3000",
  );
  assert.throws(() => resolveAppOrigin({ nodeEnv: "development", requestOrigin: "https://preview.example" }));
});

test("browser origin must exactly match the trusted app origin in production", () => {
  assert.equal(isTrustedBrowserOrigin("https://patternproof.example", "https://patternproof.example", "production"), true);
  assert.equal(isTrustedBrowserOrigin("https://evil.example", "https://patternproof.example", "production"), false);
  assert.equal(isTrustedBrowserOrigin(null, "https://patternproof.example", "production"), false);
});

test("magic-link limiter suppresses the fourth request to one email", () => {
  const now = 10_000_000;
  const email = "auth-email-limit@example.test";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.deepEqual(consumeMagicLinkAttempt(`192.0.2.${attempt + 1}`, email, now + attempt), { allowed: true });
  }
  const blocked = consumeMagicLinkAttempt("192.0.2.10", email, now + 3);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.reason, "email");
});

test("magic-link limiter blocks a ninth request from one IP", () => {
  const now = 20_000_000;
  const address = "198.51.100.20";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.deepEqual(consumeMagicLinkAttempt(address, `auth-ip-${attempt}@example.test`, now + attempt), { allowed: true });
  }
  const blocked = consumeMagicLinkAttempt(address, "auth-ip-blocked@example.test", now + 8);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.reason, "ip");
});
