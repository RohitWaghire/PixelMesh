import sharp from "sharp";
import crypto from "crypto";
import { Readable } from "stream";
import { FilterResult, ImageMetadata, PipelineOperation } from "./types";
import { storageClient } from "../storage/client";
import { ImageInputParams, ResolvedImageInput } from "../storage/types";
import * as geometry from "./filters/geometry";
import * as exposure from "./filters/exposure";
import * as color from "./filters/color";
import * as effects from "./filters/effects";

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB High-Res limit

/**
 * Parses inline base64 string or data URI into Buffer and mimeType
 */
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

/**
 * Formats image buffer as data URI
 */
export function formatBase64Result(buffer: Buffer, format: string): string {
  const mime = format === "jpeg" || format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Resolves image input from base64, storage object key, or remote HTTP URL
 */
export async function resolveInputImage(
  input: string | ImageInputParams | any
): Promise<ResolvedImageInput> {
  if (!input) {
    throw new Error("Invalid image input: one of 'image_base64', 'image_key', or 'image_url' is required.");
  }

  // Handle string input
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("data:") || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("raw/") && !trimmed.startsWith("processed/"))) {
      try {
        const { buffer, mimeType } = parseBase64Image(trimmed);
        return { buffer, mimeType, sourceType: "base64" };
      } catch (err: any) {
        if (trimmed.includes("/") || trimmed.includes(".")) {
          // Fall through to storage key check
        } else {
          throw err;
        }
      }
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const res = await fetch(trimmed);
      if (!res.ok) {
        throw new Error(`Failed to fetch image from URL: ${trimmed} (${res.status} ${res.statusText})`);
      }
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(`Remote image size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed 50MB limit.`);
      }
      const mimeType = res.headers.get("content-type") || "image/png";
      return { buffer, mimeType, sourceType: "url", sourceUrl: trimmed };
    }

    // Storage key string
    const buffer = await storageClient.getObjectBuffer(trimmed);
    return { buffer, mimeType: "image/png", sourceType: "storage", sourceKey: trimmed };
  }

  // Handle object input
  const base64Str = input.image_base64 || input.imageBase64;
  const storageKey = input.image_key || input.imageKey;
  const imageUrl = input.image_url || input.imageUrl;

  if (base64Str) {
    const { buffer, mimeType } = parseBase64Image(base64Str);
    return { buffer, mimeType, sourceType: "base64" };
  }

  if (storageKey) {
    const buffer = await storageClient.getObjectBuffer(storageKey);
    return { buffer, mimeType: "image/png", sourceType: "storage", sourceKey: storageKey };
  }

  if (imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch image from URL: ${imageUrl} (${res.status} ${res.statusText})`);
    }
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Remote image size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed 50MB limit.`);
    }
    const mimeType = res.headers.get("content-type") || "image/png";
    return { buffer, mimeType, sourceType: "url", sourceUrl: imageUrl };
  }

  throw new Error("Invalid image input: one of 'image_base64', 'image_key', or 'image_url' is required.");
}

/**
 * Resolves a readable stream for the image input directly into Sharp pipeline
 */
export async function resolveInputStream(
  input: string | ImageInputParams | any
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; sourceType: "base64" | "storage" | "url" }> {
  if (typeof input === "object" && (input.image_key || input.imageKey)) {
    const key = input.image_key || input.imageKey;
    const stream = await storageClient.getObjectStream(key);
    return { stream, mimeType: "image/png", sourceType: "storage" };
  }

  const resolved = await resolveInputImage(input);
  return {
    stream: Readable.from(resolved.buffer),
    mimeType: resolved.mimeType,
    sourceType: resolved.sourceType
  };
}

/**
 * Stores output image directly to object storage and returns keys/urls
 */
export async function formatStorageResult(params: {
  buffer: Buffer;
  format?: string;
  key?: string;
  prefix?: string;
  contentType?: string;
}): Promise<{
  image_key: string;
  imageKey: string;
  image_url: string;
  imageUrl: string;
  public_url: string;
  publicUrl: string;
  size_bytes: number;
  sizeBytes: number;
}> {
  const { buffer, format = "png", prefix = "processed", contentType } = params;

  let key = params.key;
  if (!key) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    key = `${prefix}/${year}/${month}/${day}/pm_${uuid}.${format}`;
  }

  const mime = contentType || (format === "jpeg" || format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png");
  const putRes = await storageClient.putObject({
    key,
    body: buffer,
    contentType: mime
  });

  return {
    image_key: putRes.key,
    imageKey: putRes.key,
    image_url: putRes.publicUrl,
    imageUrl: putRes.publicUrl,
    public_url: putRes.publicUrl,
    publicUrl: putRes.publicUrl,
    size_bytes: putRes.sizeBytes,
    sizeBytes: putRes.sizeBytes
  };
}

/**
 * Processes a single filter operation on an image
 */
export async function processSingleFilter(
  input: string | ImageInputParams | any,
  tool: string,
  params: Record<string, any> = {},
  outputFormat?: string,
  returnType?: "base64" | "storage" | "url"
): Promise<FilterResult> {
  const startTime = performance.now();
  const resolved = await resolveInputImage(input);

  let image = sharp(resolved.buffer);
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

  const base64Result = formatBase64Result(outputBuffer, targetFormat);
  const effectiveReturnType = returnType || (typeof input === "object" ? input.return_type || input.returnType : undefined);

  const filterResult: FilterResult = {
    imageBase64: base64Result,
    image_base64: base64Result,
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

  if (effectiveReturnType === "storage" || effectiveReturnType === "url") {
    const stored = await formatStorageResult({
      buffer: outputBuffer,
      format: targetFormat
    });
    filterResult.imageKey = stored.image_key;
    filterResult.image_key = stored.image_key;
    filterResult.imageUrl = stored.image_url;
    filterResult.image_url = stored.image_url;
    filterResult.publicUrl = stored.public_url;
    filterResult.public_url = stored.public_url;
  }

  return filterResult;
}

/**
 * Processes a sequence of pipeline filter operations on an image
 */
export async function processPipeline(
  input: string | ImageInputParams | any,
  operations: PipelineOperation[],
  outputFormat?: string,
  returnType?: "base64" | "storage" | "url"
): Promise<FilterResult> {
  const startTime = performance.now();
  const effectiveReturnType = returnType || (typeof input === "object" ? input.return_type || input.returnType : undefined);
  let currentInput: any = input;
  let finalMeta: ImageMetadata = {};
  let lastResult: FilterResult | null = null;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const isLast = i === operations.length - 1;
    const res = await processSingleFilter(
      currentInput,
      op.tool,
      op.params,
      isLast ? outputFormat : undefined,
      isLast ? effectiveReturnType : "base64"
    );
    currentInput = res.imageBase64;
    finalMeta = res.metadata;
    lastResult = res;
  }

  const duration = performance.now() - startTime;
  return {
    imageBase64: lastResult?.imageBase64 || "",
    image_base64: lastResult?.image_base64 || lastResult?.imageBase64 || "",
    imageKey: lastResult?.imageKey,
    image_key: lastResult?.image_key,
    imageUrl: lastResult?.imageUrl,
    image_url: lastResult?.image_url,
    publicUrl: lastResult?.publicUrl,
    public_url: lastResult?.public_url,
    metadata: finalMeta,
    executionTimeMs: Math.round(duration * 10) / 10
  };
}
