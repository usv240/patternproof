import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("render admission validates hosted inputs before reservation and budget", () => {
  const route = readFileSync(
    new URL("../app/api/youcam/render/route.ts", import.meta.url),
    "utf8",
  );
  const signed = route.indexOf("const signed = await signedRenderInputs(authorized)");
  const reserved = route.indexOf("reservation = await reserveAuthorizedRender(");
  const consumed = route.indexOf("await consumeReservedRenderBudget(");
  const vendor = route.indexOf("await createClothesRender(");

  assert.ok(signed >= 0 && signed < reserved);
  assert.ok(reserved < consumed && consumed < vendor);
});

test("local or credential-bearing image URLs fail with an actionable message", () => {
  const authorization = readFileSync(
    new URL("../lib/youcam/authorization.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    authorization,
    /url\.protocol !== "https:" \|\| url\.username \|\| url\.password/,
  );
  assert.match(authorization, /needs hosted HTTPS image storage/);
});