import sharp from "sharp";
import { GeometryParams } from "../types";

export function sanitizeSvgColor(color: string): string {
  if (!color || typeof color !== "string") return "#00000000";
  const trimmed = color.trim();
  if (trimmed === "transparent") return "#00000000";

  // Strict Hex formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed;
  }
  // Strict Functional CSS color: rgb(), rgba(), hsl(), hsla()
  if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(\s*,\s*[\d.]+%?)?\s*\)$/i.test(trimmed)) {
    return trimmed;
  }
  // Standard alphanumeric named colors without XML/quotes/punctuation
  if (/^[a-zA-Z]{3,20}$/.test(trimmed)) {
    return trimmed;
  }

  // Reject anything containing XML characters (<, >, ", ', &, ;, etc.)
  return "#00000000";
}

export async function applyCrop(image: sharp.Sharp, params: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }, meta: sharp.Metadata) {
  const imgWidth = Math.max(1, meta.width || 1000);
  const imgHeight = Math.max(1, meta.height || 1000);

  const left = Math.min(imgWidth - 1, Math.max(0, Math.floor(params.x ?? params.left ?? 0)));
  const top = Math.min(imgHeight - 1, Math.max(0, Math.floor(params.y ?? params.top ?? 0)));
  const maxW = Math.max(1, imgWidth - left);
  const maxH = Math.max(1, imgHeight - top);

  const width = Math.min(maxW, Math.max(1, Math.floor(params.width || maxW)));
  const height = Math.min(maxH, Math.max(1, Math.floor(params.height || maxH)));

  return image.extract({ left, top, width, height });
}

export async function applyCircleCrop(image: sharp.Sharp, params: { radius?: number; centerX?: number; centerY?: number; background?: string }, meta: sharp.Metadata) {
  const imgWidth = Math.max(1, meta.width || 500);
  const imgHeight = Math.max(1, meta.height || 500);

  const minDimension = Math.min(imgWidth, imgHeight);
  const defaultCenter = Math.floor(minDimension / 2);

  const centerX = Math.min(imgWidth - 1, Math.max(1, Math.floor(params.centerX ?? Math.floor(imgWidth / 2))));
  const centerY = Math.min(imgHeight - 1, Math.max(1, Math.floor(params.centerY ?? Math.floor(imgHeight / 2))));

  const maxPossibleRadius = Math.max(1, Math.min(centerX, centerY, imgWidth - centerX, imgHeight - centerY));
  const requestedRadius = params.radius ? Math.max(1, Math.floor(params.radius)) : maxPossibleRadius;
  const radius = Math.min(maxPossibleRadius, requestedRadius);

  const diameter = radius * 2;
  const cropLeft = Math.max(0, centerX - radius);
  const cropTop = Math.max(0, centerY - radius);

  // Extract bounding square first
  const croppedSquare = image.extract({ left: cropLeft, top: cropTop, width: diameter, height: diameter });

  // Create circular SVG mask
  const circleSvg = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="#ffffff"/></svg>`
  );

  let result = croppedSquare
    .ensureAlpha()
    .composite([{ input: circleSvg, blend: "dest-in" }]);

  if (params.background && params.background !== "transparent" && params.background !== "#00000000") {
    const safeBg = sanitizeSvgColor(params.background);
    if (safeBg !== "#00000000" && safeBg !== "transparent") {
      const bgSvg = Buffer.from(
        `<svg width="${diameter}" height="${diameter}"><rect width="${diameter}" height="${diameter}" fill="${safeBg}"/></svg>`
      );
      const maskedBuffer = await result.png().toBuffer();
      result = sharp(bgSvg).composite([{ input: maskedBuffer, blend: "over" }]);
    }
  }

  return result.png();
}

export async function applyFlip(image: sharp.Sharp, direction: "horizontal" | "vertical") {
  if (direction === "horizontal") {
    return image.flop(); // Horizontal flip
  } else {
    return image.flip(); // Vertical flip
  }
}

export async function applyRotate(image: sharp.Sharp, degrees: number, background = "#00000000") {
  return image.rotate(degrees, { background });
}

export async function applyStraighten(image: sharp.Sharp, angle: number) {
  // Rotate by small degree with transparent background
  return image.rotate(angle, { background: "#00000000" });
}
