import sharp from "sharp";
import { FilterResult, ImageMetadata, PipelineOperation } from "./types";
import * as geometry from "./filters/geometry";
import * as exposure from "./filters/exposure";
import * as color from "./filters/color";
import * as effects from "./filters/effects";

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB High-Res limit

export function parseBase64Image(dataUriOrBase64: string): { buffer: Buffer; mimeType: string } {
  if (!dataUriOrBase64 || typeof dataUriOrBase64 !== "string") {
    throw new Error("Invalid image input: base64 string is required.");
  }

  let mimeType = "image/png";
  let base64Data = dataUriOrBase64;

  if (dataUriOrBase64.startsWith("data:")) {
    const match = dataUriOrBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }
  }

  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed 50MB limit.`);
  }

  return { buffer, mimeType };
}

export function formatBase64Result(buffer: Buffer, format: string): string {
  const mime = format === "jpeg" || format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export async function processSingleFilter(
  inputBase64: string,
  tool: string,
  params: Record<string, any> = {},
  outputFormat?: string
): Promise<FilterResult> {
  const startTime = performance.now();
  const { buffer } = parseBase64Image(inputBase64);

  let image = sharp(buffer);
  const metadata = await image.metadata();

  switch (tool) {
    // Geometry
    case "crop_image":
      image = await geometry.applyCrop(image, params as any, metadata);
      break;
    case "circle_crop":
      image = await geometry.applyCircleCrop(image, params as any, metadata);
      break;
    case "flip_image":
      image = await geometry.applyFlip(image, params.direction || "horizontal");
      break;
    case "rotate_image":
      image = await geometry.applyRotate(image, Number(params.degrees || 90), params.background);
      break;
    case "straighten_photo":
      image = await geometry.applyStraighten(image, Number(params.angle || 0));
      break;

    // Tonal & Exposure
    case "adjust_brightness":
      image = await exposure.applyBrightness(image, Number(params.factor ?? 20));
      break;
    case "lighten_photo":
      image = await exposure.applyLighten(image, Number(params.amount ?? 30));
      break;
    case "darken_photo":
      image = await exposure.applyDarken(image, Number(params.amount ?? 30));
      break;
    case "change_exposure":
      image = await exposure.applyExposure(image, Number(params.stops ?? 1));
      break;
    case "adjust_contrast":
      image = await exposure.applyContrast(image, Number(params.factor ?? 20));
      break;
    case "change_image_gamma":
      image = await exposure.applyGamma(image, Number(params.gamma ?? 1.4));
      break;

    // Color & Saturation
    case "grayscale_image":
      image = await color.applyGrayscale(image);
      break;
    case "color_photo_to_bw":
      image = await color.applyBwThreshold(image, Number(params.threshold ?? 128));
      break;
    case "make_sepia_tone":
      image = await color.applySepia(image, Number(params.intensity ?? 80));
      break;
    case "invert_colors":
      image = await color.applyInvert(image);
      break;
    case "shift_hue":
      image = await color.applyHueShift(image, Number(params.degrees ?? 90));
      break;
    case "change_saturation":
      image = await color.applySaturation(image, Number(params.factor ?? 30));
      break;
    case "adjust_vibrance":
      image = await color.applyVibrance(image, Number(params.factor ?? 30));
      break;
    case "hsl_adjustment":
      image = await color.applyHsl(image, params);
      break;
    case "clip_color_values":
      image = await color.applyClipColors(image, params.min, params.max);
      break;

    // Effects & Styling
    case "sharpen_image":
      image = await effects.applySharpen(image, params);
      break;
    case "blur_image":
      image = await effects.applyBlur(image, Number(params.sigma ?? 3));
      break;
    case "add_noise":
      image = await effects.applyNoise(image, Number(params.intensity ?? 20), metadata);
      break;
    case "posterize_effect":
      image = await effects.applyPosterize(image, Number(params.levels ?? 4));
      break;
    case "glow_effect":
      image = await effects.applyGlow(image, Number(params.intensity ?? 50), Number(params.radius ?? 10), metadata);
      break;

    default:
      throw new Error(`Unknown filter tool: ${tool}`);
  }

  const targetFormat = outputFormat || metadata.format || "png";
  if (targetFormat === "jpeg" || targetFormat === "jpg") {
    image = image.jpeg({ quality: 90 });
  } else if (targetFormat === "webp") {
    image = image.webp({ quality: 90 });
  } else {
    image = image.png();
  }

  const outputBuffer = await image.toBuffer();
  const outMeta = await sharp(outputBuffer).metadata();
  const duration = performance.now() - startTime;

  return {
    imageBase64: formatBase64Result(outputBuffer, targetFormat),
    metadata: {
      width: outMeta.width,
      height: outMeta.height,
      format: outMeta.format,
      space: outMeta.space,
      channels: outMeta.channels,
      sizeBytes: outputBuffer.length
    },
    executionTimeMs: Math.round(duration * 10) / 10
  };
}

export async function processPipeline(
  inputBase64: string,
  operations: PipelineOperation[],
  outputFormat?: string
): Promise<FilterResult> {
  const startTime = performance.now();
  let currentBase64 = inputBase64;
  let finalMeta: ImageMetadata = {};

  for (const op of operations) {
    const res = await processSingleFilter(currentBase64, op.tool, op.params);
    currentBase64 = res.imageBase64;
    finalMeta = res.metadata;
  }

  const duration = performance.now() - startTime;
  return {
    imageBase64: currentBase64,
    metadata: finalMeta,
    executionTimeMs: Math.round(duration * 10) / 10
  };
}
