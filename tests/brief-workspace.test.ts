import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isStrictUuid,
  parseFeasibilityInput,
  parseRequirementInput,
} from "../lib/brief-workspace";

test("workspace identifiers require canonical RFC UUIDs", () => {
  assert.equal(isStrictUuid("9f910c6f-a99c-4a23-861d-a4a8fd85e15f"), true);
  assert.equal(isStrictUuid("9F910C6F-A99C-4A23-861D-A4A8FD85E15F"), true);

  for (const value of [
    undefined,
    "",
    "9f910c6fa99c4a23861da4a8fd85e15f",
    "00000000-0000-0000-0000-000000000000",
    "9f910c6f-a99c-4a23-061d-a4a8fd85e15f",
    "9f910c6f-a99c-4a23-861d-a4a8fd85e15f/requirements",
  ]) {
    assert.equal(isStrictUuid(value), false);
  }
});

test("requirement input is normalized and length-limited", () => {
  assert.deepEqual(
    parseRequirementInput({ label: "  Square\n neckline  ", note: "  Keep the edge crisp.  " }),
    {
      ok: true,
      value: { label: "Square neckline", note: "Keep the edge crisp." },
    },
  );
  assert.deepEqual(parseRequirementInput({ label: "Boat neck" }), {
    ok: true,
    value: { label: "Boat neck", note: null },
  });

  for (const value of [
    null,
    [],
    {},
    { label: "   " },
    { label: 42 },
    { label: "x".repeat(121) },
    { label: "Valid", note: "x".repeat(1_001) },
    { label: "Valid", note: null },
  ]) {
    assert.equal(parseRequirementInput(value).ok, false);
  }
});

test("adjustments require a nonblank, bounded tailor note", () => {
  assert.deepEqual(
    parseFeasibilityInput({
      status: "with_adjustment",
      tailorNote: "  Add a concealed support strap.  ",
    }),
    {
      ok: true,
      value: {
        status: "with_adjustment",
        tailorNote: "Add a concealed support strap.",
      },
    },
  );
  assert.deepEqual(parseFeasibilityInput({ status: "as_shown" }), {
    ok: true,
    value: { status: "as_shown", tailorNote: null },
  });
  assert.deepEqual(parseFeasibilityInput({ status: "not_feasible" }), {
    ok: true,
    value: { status: "not_feasible", tailorNote: null },
  });

  for (const value of [
    null,
    {},
    { status: "unknown" },
    { status: "with_adjustment" },
    { status: "with_adjustment", tailorNote: "   " },
    { status: "with_adjustment", tailorNote: "x".repeat(1_001) },
    { status: "not_feasible", tailorNote: null },
  ]) {
    assert.equal(parseFeasibilityInput(value).ok, false);
  }
});
test("feasibility writes preserve the column-level privilege boundary", () => {
  const route = readFileSync(
    new URL(
      "../app/api/brief/[briefId]/requirements/[requirementId]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(route, /\.upsert\(/);
  assert.match(route, /\.insert\(\{[\s\S]*requirement_id:[\s\S]*\.\.\.decision/);
  assert.match(route, /\.update\(decision\)[\s\S]*\.eq\("requirement_id"/);
});