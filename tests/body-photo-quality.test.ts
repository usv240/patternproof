import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  assertNormalizedBodyPhotoQuality,
  validateBodyPhotoQuality,
  type BodyPhotoGarmentCategory,
} from "../lib/images/body-photo-quality";

test("the clean T4 body-photo profile passes the dress policy", () => {
  assert.equal(
    validateBodyPhotoQuality(
      { width: 1024, height: 1536, grayscaleMean: 173.4 },
      "dresses",
    ),
    null,
  );
});

test("the poor T4 body-photo profile is rejected as too dark", () => {
  assert.equal(
    validateBodyPhotoQuality(
      { width: 844, height: 900, grayscaleMean: 61.6 },
      "dresses",
    )?.code,
    "dark",
  );
});

test("body photos enforce the official long- and short-edge minimums", () => {
  assert.equal(
    validateBodyPhotoQuality(
      { width: 383, height: 900, grayscaleMean: 150 },
      "dresses",
    )?.code,
    "resolution",
  );
  assert.equal(
    validateBodyPhotoQuality(
      { width: 384, height: 512, grayscaleMean: 70 },
      "dresses",
    ),
    null,
  );
});

test("full-look categories require a 1.2 portrait ratio", () => {
  const categories: BodyPhotoGarmentCategory[] = ["bottoms", "dresses", "one-pieces"];
  for (const category of categories) {
    assert.equal(
      validateBodyPhotoQuality(
        { width: 844, height: 900, grayscaleMean: 173.4 },
        category,
      )?.code,
      "framing",
    );
    assert.equal(
      validateBodyPhotoQuality(
        { width: 500, height: 600, grayscaleMean: 173.4 },
        category,
      ),
      null,
    );
  }
});

test("tops allow a 0.9 portrait ratio but reject wider crops", () => {
  assert.equal(
    validateBodyPhotoQuality(
      { width: 1000, height: 900, grayscaleMean: 150 },
      "tops",
    ),
    null,
  );
  assert.equal(
    validateBodyPhotoQuality(
      { width: 1000, height: 899, grayscaleMean: 150 },
      "tops",
    )?.code,
    "framing",
  );
});

test("Sharp inspection measures normalized pixels before applying policy", async () => {
  const bytes = await sharp({
    create: { width: 384, height: 512, channels: 3, background: "#787878" },
  })
    .jpeg()
    .toBuffer();
  const metrics = await assertNormalizedBodyPhotoQuality(
    { bytes, width: 384, height: 512 },
    "dresses",
  );

  assert.equal(metrics.width, 384);
  assert.equal(metrics.height, 512);
  assert.ok(metrics.grayscaleMean >= 119 && metrics.grayscaleMean <= 121);
});
