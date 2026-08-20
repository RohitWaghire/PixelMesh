export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  space?: string;
  channels?: number;
  depth?: string;
  density?: number;
  hasAlpha?: boolean;
  sizeBytes?: number;
}

export interface FilterResult {
  imageBase64: string;
  metadata: ImageMetadata;
  executionTimeMs: number;
}

export interface GeometryParams {
  crop?: { left: number; top: number; width: number; height: number };
  circleCrop?: { radius?: number; centerX?: number; centerY?: number; background?: string };
  flip?: "horizontal" | "vertical";
  rotate?: { degrees: number; background?: string };
  straighten?: { angle: number };
}

export interface ExposureParams {
  brightness?: number; // -100 to 100
  lighten?: number;    // 0 to 100
  darken?: number;     // 0 to 100
  exposure?: number;   // -5 to +5 stops
  contrast?: number;   // -100 to 100
  gamma?: number;      // 0.1 to 3.0
}

export interface ColorParams {
  grayscale?: boolean;
  bwThreshold?: number; // 0 to 255
  sepia?: number;       // 0 to 100
  invert?: boolean;
  hueShift?: number;    // -180 to 180
  saturation?: number;  // -100 to 100
  vibrance?: number;    // -100 to 100
  hsl?: { hue?: number; saturation?: number; lightness?: number };
  clip?: { min?: number; max?: number };
}

export interface EffectParams {
  sharpen?: { sigma?: number; flat?: number; jagged?: number };
  blur?: { sigma: number };
  noise?: { intensity: number }; // 0 to 100
  posterize?: { levels: number }; // 2 to 32
  glow?: { intensity: number; radius?: number };
}

export interface PipelineOperation {
  tool: string;
  params: Record<string, any>;
}
