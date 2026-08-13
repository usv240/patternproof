import assert from "node:assert/strict";
import test from "node:test";

import {
  isReadyForCustomerApproval,
  type CutCardRevision,
  type Requirement,
} from "../lib/domain";

function makeRevision(
  requirements: Requirement[] = [
    { id: "requirement-1", label: "Square neckline", status: "as_shown" },
  ],
  overrides: Partial<CutCardRevision> = {},
): CutCardRevision {
  return {
    id: "revision-1",
    briefId: "brief-1",
    version: 1,
    referenceUrl: "https://example.test/reference.jpg",
    bodyUrl: "https://example.test/body.jpg",
    renderUrl: "https://example.test/render.jpg",
    requirements,
    locked: false,
    ...overrides,
  };
}

test("a rendered revision with feasible requirements is ready for approval", () => {
  assert.equal(isReadyForCustomerApproval(makeRevision()), true);
  assert.equal(
    isReadyForCustomerApproval(
      makeRevision([
        { id: "requirement-1", label: "Square neckline", status: "as_shown" },
        {
          id: "requirement-2",
          label: "Lower back",
          status: "with_adjustment",
          tailorNote: "Add a concealed support strap.",
        },
      ]),
    ),
    true,
  );
});

test("approval requires a nonblank render URL", () => {
  assert.equal(isReadyForCustomerApproval(makeRevision(undefined, { renderUrl: undefined })), false);
  assert.equal(isReadyForCustomerApproval(makeRevision(undefined, { renderUrl: "" })), false);
  assert.equal(isReadyForCustomerApproval(makeRevision(undefined, { renderUrl: "   " })), false);
});

test("approval requires at least one requirement", () => {
  assert.equal(isReadyForCustomerApproval(makeRevision([])), false);
});

test("approval requires a recognized feasibility status on every requirement", () => {
  assert.equal(
    isReadyForCustomerApproval(makeRevision([{ id: "requirement-1", label: "Square neckline" }])),
    false,
  );
  assert.equal(
    isReadyForCustomerApproval(
      makeRevision([
        { id: "requirement-1", label: "Square neckline", status: "as_shown" },
        { id: "requirement-2", label: "Lower back" },
      ]),
    ),
    false,
  );
  assert.equal(
    isReadyForCustomerApproval(
      makeRevision([
        {
          id: "requirement-1",
          label: "Square neckline",
          status: "unexpected" as Requirement["status"],
        },
      ]),
    ),
    false,
  );
});

test("a not-feasible requirement blocks approval", () => {
  assert.equal(
    isReadyForCustomerApproval(
      makeRevision([
        {
          id: "requirement-1",
          label: "Unsupported construction",
          status: "not_feasible",
          tailorNote: "This cannot be constructed safely.",
        },
      ]),
    ),
    false,
  );
});

test("an adjusted requirement needs a nonblank tailor note", () => {
  for (const tailorNote of [undefined, "", "   "]) {
    assert.equal(
      isReadyForCustomerApproval(
        makeRevision([
          {
            id: "requirement-1",
            label: "Lower back",
            status: "with_adjustment",
            tailorNote,
          },
        ]),
      ),
      false,
    );
  }

  assert.equal(
    isReadyForCustomerApproval(
      makeRevision([
        {
          id: "requirement-1",
          label: "Lower back",
          status: "with_adjustment",
          tailorNote: "  Add a concealed support strap.  ",
        },
      ]),
    ),
    true,
  );
});
