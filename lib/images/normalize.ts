
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MIN_EDGE_PIXELS = 256;
const MAX_OUTPUT_EDGE = 2048;

export type NormalizedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  sourceFormat: "jpeg" | "png";
};

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export async function normalizePrivateImage(file: Blob): Promise<NormalizedImage> {
  if (file.size === 0) throw new ImageValidationError("The image is empty.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageValidationError("The image must be 10 MB or smaller.");
  }

  const input = Buffer.from(await file.arrayBuffer());

  try {
    const decoder = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();

    if (metadata.format !== "jpeg" && metadata.format !== "png") {
      throw new ImageValidationError("Only genuine JPG and PNG images are accepted.");
    }
    if (!metadata.width || !metadata.height) {
      throw new ImageValidationError("The image dimensions could not be read.");
    }
    if (metadata.width < MIN_EDGE_PIXELS || metadata.height < MIN_EDGE_PIXELS) {
      throw new ImageValidationError("Use an image at least 256 x 256 pixels.");
    }

    const result = await decoder
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({
        width: MAX_OUTPUT_EDGE,
        height: MAX_OUTPUT_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toColourspace("srgb")
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: result.data,
      contentType: "image/jpeg",
      width: result.info.width,
      height: result.info.height,
      sourceFormat: metadata.format,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("The image could not be decoded safely.");
  }
}
