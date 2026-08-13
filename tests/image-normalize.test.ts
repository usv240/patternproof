import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  ImageValidationError,
  normalizePrivateImage,
} from "../lib/images/normalize";

test("private image normalization decodes, bounds, and removes embedded metadata", async () => {
  const source = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#8da37f" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "must-not-survive" } } })
    .toBuffer();

  const normalized = await normalizePrivateImage(new Blob([source], { type: "image/jpeg" }));
  const metadata = await sharp(normalized.bytes).metadata();

  assert.equal(normalized.contentType, "image/jpeg");
  assert.equal(normalized.width, 640);
  assert.equal(normalized.height, 480);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.iptc, undefined);
});

test("private image normalization rejects forged image content", async () => {
  await assert.rejects(
    normalizePrivateImage(new Blob(["not an image"], { type: "image/png" })),
    ImageValidationError,
  );
});

test("private image normalization rejects unusably small images", async () => {
  const source = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    normalizePrivateImage(new Blob([source], { type: "image/png" })),
    /at least 256/,
  );
});
