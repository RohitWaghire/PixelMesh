import sharp from "sharp";
import { GeometryParams } from "../types";

export async function applyCrop(image: sharp.Sharp, params: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }, meta: sharp.Metadata) {
  const left = Math.max(0, Math.floor(params.x ?? params.left ?? 0));
  const top = Math.max(0, Math.floor(params.y ?? params.top ?? 0));
  const maxW = (meta.width || 1000) - left;
  const maxH = (meta.height || 1000) - top;

  const width = Math.min(maxW, Math.max(1, Math.floor(params.width || maxW)));
  const height = Math.min(maxH, Math.max(1, Math.floor(params.height || maxH)));

  return image.extract({ left, top, width, height });
}

export async function applyCircleCrop(image: sharp.Sharp, params: { radius?: number; centerX?: number; centerY?: number; background?: string }, meta: sharp.Metadata) {
  const imgWidth = meta.width || 500;
  const imgHeight = meta.height || 500;

  const centerX = params.centerX ?? Math.floor(imgWidth / 2);
  const centerY = params.centerY ?? Math.floor(imgHeight / 2);
  const maxPossibleRadius = Math.min(centerX, centerY, imgWidth - centerX, imgHeight - centerY);
  const radius = Math.min(maxPossibleRadius, Math.max(1, params.radius ?? Math.floor(Math.min(imgWidth, imgHeight) / 2)));

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
    const bgSvg = Buffer.from(
      `<svg width="${diameter}" height="${diameter}"><rect width="${diameter}" height="${diameter}" fill="${params.background}"/></svg>`
    );
    const maskedBuffer = await result.png().toBuffer();
    result = sharp(bgSvg).composite([{ input: maskedBuffer, blend: "over" }]);
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
