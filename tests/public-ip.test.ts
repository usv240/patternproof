import assert from "node:assert/strict";
import test from "node:test";

import { isPrivateNetworkAddress } from "../lib/security/public-ip";

test("public IPv4 and IPv6 addresses are not rejected by mixed-family rules", () => {
  assert.equal(isPrivateNetworkAddress("99.84.116.231"), false);
  assert.equal(isPrivateNetworkAddress("2606:4700:4700::1111"), false);
});

test("private, loopback, and mapped addresses remain blocked", () => {
  for (const address of [
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:99.84.116.231",
  ]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
});