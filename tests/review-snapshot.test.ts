import assert from "node:assert/strict";
import test from "node:test";

import {
  parseFrozenReviewSnapshot,
  shortSnapshotProof,
} from "../lib/review-snapshot";

const identity = {
  shopId: "11111111-1111-4111-8111-111111111111",
  briefId: "22222222-2222-4222-8222-222222222222",
  revisionId: "33333333-3333-4333-8333-333333333333",
};

function snapshot() {
  return {
    schema_version: "patternproof-review-v2",
    shop: { id: identity.shopId, name: "Studio" },
    brief: { id: identity.briefId, customer_label: "Private client" },
    revision: {
      id: identity.revisionId,
      version: 2,
      reference_path: `${identity.shopId}/${identity.briefId}/${identity.revisionId}/reference.jpg`,
      render_path: `${identity.shopId}/${identity.briefId}/${identity.revisionId}/render-${"a".repeat(64)}.jpg`,
      reference_sha256: "b".repeat(64),
      render_sha256: "a".repeat(64),
      category: "dresses",
      created_at: "2026-08-03T12:00:00.000Z",
    },
    requirements: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        label: "Keep the neckline high",
        note: null,
        feasibility: { status: "as_shown", tailor_note: null },
      },
    ],
    annotations: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        author_role: "tailor",
        anchor_x: 0.5,
        anchor_y: 0.25,
        body: "Seam ends here.",
        created_at: "2026-08-03T12:05:00.000Z",
      },
    ],
    consent: {
      scope: "visual-intent preview and Cut Card approval",
      rights_confirmed: true,
      body_processing_confirmed: true,
      policy_version: "2026-08-02",
      granted_at: "2026-08-03T11:55:00.000Z",
    },
  };
}

test("parses every customer-visible field in the frozen snapshot", () => {
  const parsed = parseFrozenReviewSnapshot(snapshot(), identity);
  assert.equal(parsed?.shop.name, "Studio");
  assert.equal(parsed?.revision.version, 2);
  assert.equal(parsed?.requirements[0]?.feasibility?.status, "as_shown");
  assert.equal(parsed?.annotations[0]?.body, "Seam ends here.");
  assert.equal(parsed?.consent.policy_version, "2026-08-02");
});

test("rejects a snapshot copied across brief or revision boundaries", () => {
  assert.equal(
    parseFrozenReviewSnapshot(snapshot(), { ...identity, briefId: crypto.randomUUID() }),
    undefined,
  );
  const changed = snapshot();
  changed.revision.id = crypto.randomUUID();
  assert.equal(parseFrozenReviewSnapshot(changed, identity), undefined);
});

test("rejects malformed visible decisions, annotations, and consent", () => {
  const badDecision = snapshot();
  badDecision.requirements[0]!.feasibility.status = "maybe";
  assert.equal(parseFrozenReviewSnapshot(badDecision, identity), undefined);

  const badAnnotation = snapshot();
  badAnnotation.annotations[0]!.anchor_x = 2;
  assert.equal(parseFrozenReviewSnapshot(badAnnotation, identity), undefined);

  const badConsent = snapshot();
  badConsent.consent.body_processing_confirmed = false;
  assert.equal(parseFrozenReviewSnapshot(badConsent, identity), undefined);
});

test("rejects a hidden or mismatched image fingerprint", () => {
  const changed = snapshot();
  changed.revision.render_sha256 = "not-a-digest";
  assert.equal(parseFrozenReviewSnapshot(changed, identity), undefined);
});

test("formats a non-secret proof fingerprint", () => {
  assert.equal(shortSnapshotProof("abcdef1234567890".padEnd(64, "0")), "abcdef-123456-789000");
  assert.equal(shortSnapshotProof("not-a-digest"), "unavailable");
});