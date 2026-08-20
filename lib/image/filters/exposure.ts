import sharp from "sharp";

export async function applyBrightness(image: sharp.Sharp, factor: number) {
  // factor: -100 to 100 -> multiplier: 0.0 to 2.0 (1.0 is neutral)
  const multiplier = Math.max(0, 1 + (factor / 100));
  return image.modulate({ brightness: multiplier });
}

export async function applyLighten(image: sharp.Sharp, amount: number) {
  // amount: 0 to 100 -> brightness 1.0 to 2.0
  const multiplier = 1 + (Math.max(0, Math.min(100, amount)) / 100);
  return image.modulate({ brightness: multiplier });
}

export async function applyDarken(image: sharp.Sharp, amount: number) {
  // amount: 0 to 100 -> brightness 1.0 to 0.0
  const multiplier = Math.max(0, 1 - (Math.max(0, Math.min(100, amount)) / 100));
  return image.modulate({ brightness: multiplier });
}

export async function applyExposure(image: sharp.Sharp, stops: number) {
  // Exposure compensation: 2^stops multiplier (stops -5 to +5)
  const clampedStops = Math.max(-5, Math.min(5, stops));
  const multiplier = Math.pow(2, clampedStops);
  return image.modulate({ brightness: multiplier });
}

export async function applyContrast(image: sharp.Sharp, factor: number) {
  // factor: -100 to 100. Use linear slope calculation
  // slope = 1 + (factor / 100) * 1.5, offset = 128 * (1 - slope)
  const normalized = Math.max(-100, Math.min(100, factor)) / 100;
  const slope = Math.max(0.1, 1 + normalized * 1.5);
  const offset = 128 * (1 - slope);
  return image.linear(slope, offset);
}

export async function applyGamma(image: sharp.Sharp, gamma: number) {
  // gamma: 0.1 to 3.0 (default 1.0)
  const clampedGamma = Math.max(0.1, Math.min(3.0, gamma || 1.0));
  return image.gamma(clampedGamma);
}
