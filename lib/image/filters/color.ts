import sharp from "sharp";

export async function applyGrayscale(image: sharp.Sharp) {
  return image.grayscale();
}

export async function applyBwThreshold(image: sharp.Sharp, threshold = 128) {
  const clampedThreshold = Math.max(0, Math.min(255, Math.floor(threshold)));
  return image.grayscale().threshold(clampedThreshold);
}

export async function applySepia(image: sharp.Sharp, intensity = 80) {
  // Classic Sepia tone matrix transformation:
  // [ 0.393, 0.769, 0.189 ]
  // [ 0.349, 0.686, 0.168 ]
  // [ 0.272, 0.534, 0.131 ]
  const k = Math.max(0, Math.min(100, intensity)) / 100;
  const matrix: [
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ] = [
    [1 - 0.607 * k, 0.769 * k, 0.189 * k],
    [0.349 * k, 1 - 0.314 * k, 0.168 * k],
    [0.272 * k, 0.534 * k, 1 - 0.869 * k]
  ];

  return image.recomb(matrix);
}

export async function applyInvert(image: sharp.Sharp) {
  return image.negate({ alpha: false });
}

export async function applyHueShift(image: sharp.Sharp, degrees: number) {
  // degrees: -180 to 180 (or 0 to 360)
  const hue = ((degrees % 360) + 360) % 360;
  return image.modulate({ hue });
}

export async function applySaturation(image: sharp.Sharp, factor: number) {
  // factor: -100 to 100 -> multiplier 0.0 to 3.0
  const normalized = Math.max(-100, Math.min(100, factor)) / 100;
  const multiplier = normalized < 0 ? 1 + normalized : 1 + normalized * 2;
  return image.modulate({ saturation: Math.max(0, multiplier) });
}

export async function applyVibrance(image: sharp.Sharp, factor: number) {
  // Vibrance increases saturation while protecting skin tones / already saturated areas
  const normalized = Math.max(-100, Math.min(100, factor)) / 100;
  const satMultiplier = Math.max(0, 1 + normalized * 1.2);
  return image.modulate({ saturation: satMultiplier });
}

export async function applyHsl(image: sharp.Sharp, params: { hue?: number; saturation?: number; lightness?: number }) {
  const hue = params.hue !== undefined ? (((params.hue % 360) + 360) % 360) : undefined;
  const satMultiplier = params.saturation !== undefined ? Math.max(0, 1 + (params.saturation / 100)) : undefined;
  const brightMultiplier = params.lightness !== undefined ? Math.max(0, 1 + (params.lightness / 100)) : undefined;

  return image.modulate({
    hue,
    saturation: satMultiplier,
    brightness: brightMultiplier
  });
}

export async function applyClipColors(image: sharp.Sharp, min = 15, max = 240) {
  // Clips luminance / color levels between min and max
  const clampedMin = Math.max(0, Math.min(255, min));
  const clampedMax = Math.max(clampedMin + 1, Math.min(255, max));
  const slope = (clampedMax - clampedMin) / 255;
  const offset = clampedMin;
  return image.linear(slope, offset);
}
