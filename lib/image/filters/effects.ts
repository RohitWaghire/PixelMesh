import sharp from "sharp";
import crypto from "crypto";

export async function applySharpen(image: sharp.Sharp, params?: { sigma?: number; flat?: number; jagged?: number }) {
  const sigma = Math.max(0.3, Math.min(10, params?.sigma ?? 1.5));
  const flat = params?.flat ?? 1.0;
  const jagged = params?.jagged ?? 2.0;
  return image.sharpen({ sigma, m1: flat, m2: jagged });
}

export async function applyBlur(image: sharp.Sharp, sigma = 3) {
  const clampedSigma = Math.max(0.3, Math.min(100, sigma || 3));
  return image.blur(clampedSigma);
}

export async function applyNoise(image: sharp.Sharp, intensity = 20, meta: sharp.Metadata) {
  const width = meta.width || 800;
  const height = meta.height || 600;
  const clampedIntensity = Math.max(1, Math.min(100, intensity));

  // Generate synthetic noise buffer using fast native C++ random fill
  const pixelCount = width * height;
  const noiseBuf = Buffer.alloc(pixelCount);
  crypto.randomFillSync(noiseBuf);

  const factor = (clampedIntensity / 100);
  for (let i = 0; i < pixelCount; i++) {
    // Map raw 0-255 byte around 128 midpoint with intensity scaling
    noiseBuf[i] = Math.max(0, Math.min(255, Math.round(128 + (noiseBuf[i] - 128) * factor)));
  }

  const noiseSharp = sharp(noiseBuf, {
    raw: { width, height, channels: 1 }
  });

  const noisePng = await noiseSharp.png().toBuffer();

  return image.composite([{
    input: noisePng,
    blend: "overlay"
  }]);
}

export async function applyPosterize(image: sharp.Sharp, levels = 4) {
  // Quantize color depth into discrete steps (levels 2 to 32)
  const clampedLevels = Math.max(2, Math.min(32, Math.floor(levels || 4)));
  const step = 255 / (clampedLevels - 1);

  // Custom posterization lookup table
  const lut = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.round(i / step) * step);
  }

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i++) {
    // Preserve alpha channel if 4 channels
    if (info.channels === 4 && (i + 1) % 4 === 0) continue;
    data[i] = lut[data[i]];
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  });
}

export async function applyGlow(image: sharp.Sharp, intensity = 50, radius = 10, meta: sharp.Metadata) {
  // Luminous bloom overlay:
  // 1. Clone source and blur heavily with high radius
  // 2. Modulate brightness according to intensity
  // 3. Composite blurred layer with screen/lighten blend mode
  const clampedIntensity = Math.max(1, Math.min(100, intensity)) / 100;
  const blurRadius = Math.max(1, Math.min(50, radius || 10));

  const cloneBuf = await image.clone().png().toBuffer();

  const glowLayer = await sharp(cloneBuf)
    .blur(blurRadius)
    .modulate({ brightness: 1 + clampedIntensity * 1.5 })
    .png()
    .toBuffer();

  return sharp(cloneBuf).composite([{
    input: glowLayer,
    blend: "screen"
  }]);
}
