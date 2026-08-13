import sharp from "sharp";

import { ImageValidationError, type NormalizedImage } from "./normalize";

export const BODY_PHOTO_MIN_LONG_EDGE = 512;
export const BODY_PHOTO_MIN_SHORT_EDGE = 384;
export const BODY_PHOTO_MIN_GRAYSCALE_MEAN = 70;
export const BODY_PHOTO_MIN_PORTRAIT_RATIO = 1.2;
export const TOP_BODY_PHOTO_MIN_PORTRAIT_RATIO = 0.9;

const MAX_NORMALIZED_BODY_PIXELS = 2048 * 2048;

export type BodyPhotoGarmentCategory = "tops" | "bottoms" | "dresses" | "one-pieces";

export type BodyPhotoQualityMetrics = {
  width: number;
  height: number;
  grayscaleMean: number;
};

export type BodyPhotoQualityFailure = {
  code: "invalid" | "resolution" | "dark" | "framing";
  message: string;
};

export function isBodyPhotoGarmentCategory(
  value: unknown,
): value is BodyPhotoGarmentCategory {
  return value === "tops"
    || value === "bottoms"
    || value === "dresses"
    || value === "one-pieces";
}

/** Pure policy evaluation. Pixel inspection is kept outside so every boundary is unit-testable. */
export function validateBodyPhotoQuality(
  metrics: BodyPhotoQualityMetrics,
  category: BodyPhotoGarmentCategory,
): BodyPhotoQualityFailure | null {
  const { width, height, grayscaleMean } = metrics;
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(grayscaleMean)
    || width <= 0
    || height <= 0
  ) {
    return {
      code: "invalid",
      message: "The customer photo quality could not be measured. Choose a different photo.",
    };
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge < BODY_PHOTO_MIN_LONG_EDGE || shortEdge < BODY_PHOTO_MIN_SHORT_EDGE) {
    return {
      code: "resolution",
      message: "Use a larger customer photo: at least 512 px on the long side and 384 px on the short side.",
    };
  }

  if (grayscaleMean < BODY_PHOTO_MIN_GRAYSCALE_MEAN) {
    return {
      code: "dark",
      message: "The customer photo is too dark for a reliable preview. Retake it in brighter, even light so the person is clearly visible.",
    };
  }

  const portraitRatio = height / width;
  const minimumRatio = category === "tops"
    ? TOP_BODY_PHOTO_MIN_PORTRAIT_RATIO
    : BODY_PHOTO_MIN_PORTRAIT_RATIO;
  if (portraitRatio < minimumRatio) {
    return {
      code: "framing",
      message: category === "tops"
        ? "For a top preview, use a taller photo showing the face, shoulders, and torso (height must be at least 0.9 times the width)."
        : "For this garment, use a portrait photo showing the full person (height must be at least 1.2 times the width).",
    };
  }

  return null;
}

export async function assertNormalizedBodyPhotoQuality(
  image: Pick<NormalizedImage, "bytes" | "width" | "height">,
  category: BodyPhotoGarmentCategory,
): Promise<BodyPhotoQualityMetrics> {
  let grayscaleMean: number;
  try {
    const stats = await sharp(image.bytes, {
      failOn: "error",
      limitInputPixels: MAX_NORMALIZED_BODY_PIXELS,
      sequentialRead: true,
    })
      .greyscale()
      .stats();
    const measuredMean = stats.channels[0]?.mean;
    if (typeof measuredMean !== "number" || !Number.isFinite(measuredMean)) {
      throw new Error("Grayscale mean missing");
    }
    grayscaleMean = measuredMean;
  } catch {
    throw new ImageValidationError(
      "The customer photo quality could not be measured. Choose a different photo.",
    );
  }

  const metrics = { width: image.width, height: image.height, grayscaleMean };
  const failure = validateBodyPhotoQuality(metrics, category);
  if (failure) throw new ImageValidationError(failure.message);
  return metrics;
}
