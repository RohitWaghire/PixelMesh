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

import dns from "dns";

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB High-Res limit

/**
 * Validates whether an IP address is a private, link-local, or loopback address (SSRF defense)
 */
export function isPrivateOrBlockedIp(ip: string): boolean {
  if (!ip) return true;

  // IPv6 mapped IPv4
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }

  // IPv6 checks
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // Link-local fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // Unique local fc00::/7
    return false;
  }

  // IPv4 checks
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 172.16.0.0/12 (Private 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation / Test)
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a >= 224) return true;

  return false;
}

/**
 * Resolves DNS records with a strict timeout guard to prevent slow-DNS stalls
 */
function resolveDnsWithTimeout(
  hostname: string,
  timeoutMs: number = 3000
): Promise<dns.LookupAddress[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DNS resolution timed out after ${Math.round(timeoutMs / 1000)}s for '${hostname}'`));
    }, timeoutMs);

    dns.lookup(hostname, { all: true }, (err, addresses) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(addresses || []);
    });
  });
}

/**
 * Validates that a remote URL is safe from SSRF attacks by resolving DNS with timeout and blocking private subnets
 */
export async function validateSafeRemoteUrl(urlString: string, timeoutMs: number = 3000): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL format: ${urlString}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol '${parsed.protocol}'. Only http: and https: are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Hostname string checks
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "169.254.169.254" ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error(`SSRF Violation: Hostname '${hostname}' is a restricted private or metadata host.`);
  }

  // Preflight DNS resolution to check resolved IP addresses against private subnets with timeout
  try {
    const records = await resolveDnsWithTimeout(hostname, timeoutMs);
    if (!records || records.length === 0) {
      throw new Error(`DNS resolution failed for hostname '${hostname}'`);
    }

    for (const record of records) {
      if (isPrivateOrBlockedIp(record.address)) {
        throw new Error(
          `SSRF Violation: Hostname '${hostname}' resolved to blocked private/internal IP '${record.address}'.`
        );
      }
    }
  } catch (err: any) {
    if (err.message?.includes("SSRF Violation") || err.message?.includes("timed out")) {
      throw err;
    }
    // If DNS resolution fails, reject the URL
    throw new Error(`Failed to resolve host '${hostname}': ${err.message}`);
  }

  return parsed;
}

import http from "http";
import https from "https";

/**
 * Socket-level DNS lookup callback that validates resolved IPs against private CIDRs
 * and pins the verified IP directly to the socket connection (preventing DNS rebinding SSRF)
 */
function secureDnsLookup(
  hostname: string,
  options: any,
  callback: (err: Error | null, address?: string, family?: number) => void
): void {
  // Hostname string checks before DNS resolution
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === "localhost" ||
    lowerHost.endsWith(".localhost") ||
    lowerHost.endsWith(".local") ||
    lowerHost.endsWith(".internal") ||
    lowerHost === "169.254.169.254" ||
    lowerHost === "metadata.google.internal"
  ) {
    return callback(new Error(`SSRF Violation: Hostname '${hostname}' is a restricted private or metadata host.`));
  }

  let isHandled = false;
  const dnsTimer = setTimeout(() => {
    if (isHandled) return;
    isHandled = true;
    callback(new Error(`DNS resolution timed out for '${hostname}'`));
  }, 3000);

  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (isHandled) return;
    isHandled = true;
    clearTimeout(dnsTimer);

    if (err) return callback(err);
    if (!addresses || addresses.length === 0) {
      return callback(new Error(`DNS resolution failed for hostname '${hostname}'`));
    }

    for (const record of addresses) {
      if (isPrivateOrBlockedIp(record.address)) {
        return callback(
          new Error(`SSRF Violation: Hostname '${hostname}' resolved to blocked private/internal IP '${record.address}'.`)
        );
      }
    }

    // Pin the verified public IP address directly to the outgoing socket
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * Executes an HTTP/HTTPS request with socket-level DNS pinning and streaming byte/time bounds
 */
function makePinnedHttpRequest(
  targetUrl: URL,
  maxSizeBytes: number,
  timeoutMs: number = 15000,
  inactivityTimeoutMs: number = 5000
): Promise<{ buffer: Buffer; mimeType: string; statusCode: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    let totalBytes = 0;
    const chunks: Buffer[] = [];
    let isSettled = false;

    let activeRes: http.IncomingMessage | null = null;

    const cleanup = () => {
      clearTimeout(masterTimer);
      clearTimeout(inactivityTimer);
    };

    const fail = (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      try { activeRes?.destroy(); } catch {}
      try { req.destroy(); } catch {}
      reject(err);
    };

    // Master Wall-Clock Deadline across entire request (headers + body stream)
    const masterTimer = setTimeout(() => {
      fail(new Error(`Remote image fetch timed out after ${Math.round(timeoutMs / 1000)} seconds (${targetUrl.toString()})`));
    }, timeoutMs);

    // Inactivity / Slowloris Timer between chunks
    let inactivityTimer = setTimeout(() => {
      fail(new Error(`Remote image stream stalled (no data received for ${Math.round(inactivityTimeoutMs / 1000)} seconds)`));
    }, inactivityTimeoutMs);

    const resetInactivityTimer = () => {
      clearTimeout(inactivityTimer);
      if (!isSettled) {
        inactivityTimer = setTimeout(() => {
          fail(new Error(`Remote image stream stalled (no data received for ${Math.round(inactivityTimeoutMs / 1000)} seconds)`));
        }, inactivityTimeoutMs);
      }
    };

    const req = transport.request(
      targetUrl,
      {
        method: "GET",
        lookup: secureDnsLookup as any,
        headers: {
          "User-Agent": "PixelMesh-ImageEngine/1.0",
          Accept: "image/png,image/jpeg,image/webp,image/avif,image/*;q=0.9"
        }
      },
      (res) => {
        activeRes = res;
        resetInactivityTimer();

        const statusCode = res.statusCode || 0;

        // Handle Redirects
        if (statusCode >= 300 && statusCode < 400) {
          const location = res.headers.location;
          cleanup();
          isSettled = true;
          try { res.destroy(); } catch {}
          try { req.destroy(); } catch {}
          return resolve({
            buffer: Buffer.alloc(0),
            mimeType: "",
            statusCode,
            location
          });
        }

        if (statusCode < 200 || statusCode >= 300) {
          return fail(new Error(`Failed to fetch image from URL: ${targetUrl.toString()} (${statusCode} ${res.statusMessage || ""})`));
        }

        const contentLength = res.headers["content-length"];
        if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
          return fail(
            new Error(
              `Remote image size (${(parseInt(contentLength, 10) / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed ${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB limit.`
            )
          );
        }

        const mimeType = res.headers["content-type"] || "image/png";

        res.on("data", (chunk: Buffer) => {
          resetInactivityTimer();
          totalBytes += chunk.length;
          if (totalBytes > maxSizeBytes) {
            return fail(
              new Error(
                `Remote image size (${(totalBytes / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed ${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB limit.`
              )
            );
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          if (isSettled) return;
          isSettled = true;
          cleanup();
          resolve({
            buffer: Buffer.concat(chunks),
            mimeType,
            statusCode
          });
        });

        res.on("error", (err) => fail(err));
      }
    );

    req.on("error", (err) => fail(err));
    req.end();
  });
}

/**
 * Safely fetches a remote image with socket-level DNS pinning, redirect bounds,
 * cumulative wall-clock stream deadlines, and chunk-by-chunk stream capping.
 */
export async function fetchSafeRemoteImage(
  urlString: string,
  maxSizeBytes: number = MAX_IMAGE_SIZE_BYTES,
  overallTimeoutMs: number = 15000
): Promise<{ buffer: Buffer; mimeType: string }> {
  let currentUrl = urlString;
  let redirectCount = 0;
  const MAX_REDIRECTS = 3;
  const overallDeadline = Date.now() + overallTimeoutMs;

  while (true) {
    const remainingMs = overallDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Remote image fetch timed out: exceeded total ${Math.round(overallTimeoutMs / 1000)}s deadline across redirects (${currentUrl})`);
    }

    const dnsTimeout = Math.min(3000, remainingMs);
    const parsed = await validateSafeRemoteUrl(currentUrl, dnsTimeout);
    const result = await makePinnedHttpRequest(parsed, maxSizeBytes, remainingMs);

    // Handle Redirects with per-hop validation
    if (result.statusCode >= 300 && result.statusCode < 400) {
      if (!result.location) {
        throw new Error(`Redirect response (${result.statusCode}) missing Location header from ${currentUrl}`);
      }

      redirectCount++;
      if (redirectCount > MAX_REDIRECTS) {
        throw new Error(`Too many redirects (exceeded maximum of ${MAX_REDIRECTS} redirects)`);
      }

      currentUrl = new URL(result.location, currentUrl).toString();
      continue;
    }

    if (!result.buffer || result.buffer.length === 0) {
      throw new Error(`Remote image response from ${currentUrl} contained 0 bytes.`);
    }

    return { buffer: result.buffer, mimeType: result.mimeType };
  }
}

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
  const norm = (format || "png").toLowerCase();
  const mime =
    norm === "jpeg" || norm === "jpg"
      ? "image/jpeg"
      : norm === "webp"
      ? "image/webp"
      : norm === "avif"
      ? "image/avif"
      : "image/png";
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
      const { buffer, mimeType } = await fetchSafeRemoteImage(trimmed);
      return { buffer, mimeType, sourceType: "url", sourceUrl: trimmed };
    }

    // Storage key string
    const buffer = await storageClient.getObjectBuffer(trimmed);
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Storage image size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed 50MB limit.`);
    }
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
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Storage image size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed 50MB limit.`);
    }
    return { buffer, mimeType: "image/png", sourceType: "storage", sourceKey: storageKey };
  }

  if (imageUrl) {
    const { buffer, mimeType } = await fetchSafeRemoteImage(imageUrl);
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

  const targetFormat = (outputFormat || metadata.format || "png").toLowerCase();
  if (targetFormat === "jpeg" || targetFormat === "jpg") {
    image = image.jpeg({ quality: 90 });
  } else if (targetFormat === "webp") {
    image = image.webp({ quality: 90 });
  } else if (targetFormat === "avif") {
    image = image.avif({ quality: 80 });
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
    inputSizeBytes: resolved.buffer.length,
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
  let originalInputSizeBytes = 0;

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
    if (i === 0 && res.inputSizeBytes) {
      originalInputSizeBytes = res.inputSizeBytes;
    }
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
    inputSizeBytes: originalInputSizeBytes || lastResult?.inputSizeBytes,
    metadata: finalMeta,
    executionTimeMs: Math.round(duration * 10) / 10
  };
}
