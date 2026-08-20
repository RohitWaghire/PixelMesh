export interface FilterToolDef {
  id: string;
  name: string;
  category: "geometry" | "exposure" | "color" | "effects";
  iconName: string;
  description: string;
  defaultParams: Record<string, any>;
  paramControls: {
    key: string;
    label: string;
    type: "slider" | "select" | "number";
    min?: number;
    max?: number;
    step?: number;
    options?: { label: string; value: any }[];
  }[];
}

export const FILTER_TOOLS_CATALOG: FilterToolDef[] = [
  // Geometry
  {
    id: "crop_image",
    name: "Crop Image",
    category: "geometry",
    iconName: "Crop",
    description: "Crop image to exact rectangle boundary (x, y, width, height)",
    defaultParams: { left: 0, top: 0, width: 400, height: 400 },
    paramControls: [
      { key: "left", label: "Left (X)", type: "number", min: 0, max: 4000, step: 10 },
      { key: "top", label: "Top (Y)", type: "number", min: 0, max: 4000, step: 10 },
      { key: "width", label: "Width", type: "number", min: 50, max: 4000, step: 10 },
      { key: "height", label: "Height", type: "number", min: 50, max: 4000, step: 10 }
    ]
  },
  {
    id: "circle_crop",
    name: "Circle Crop",
    category: "geometry",
    iconName: "CheckCircle",
    description: "Create a circular avatar or badge crop with alpha mask",
    defaultParams: { radius: 200 },
    paramControls: [
      { key: "radius", label: "Radius (px)", type: "slider", min: 50, max: 1000, step: 10 }
    ]
  },
  {
    id: "flip_image",
    name: "Flip Image",
    category: "geometry",
    iconName: "Plus",
    description: "Mirror image horizontally or vertically",
    defaultParams: { direction: "horizontal" },
    paramControls: [
      {
        key: "direction",
        label: "Flip Direction",
        type: "select",
        options: [
          { label: "Horizontal", value: "horizontal" },
          { label: "Vertical", value: "vertical" }
        ]
      }
    ]
  },
  {
    id: "rotate_image",
    name: "Rotate Image",
    category: "geometry",
    iconName: "RotateCw",
    description: "Rotate image with dynamic auto-fit canvas bounds",
    defaultParams: { degrees: 90 },
    paramControls: [
      { key: "degrees", label: "Angle (Degrees)", type: "slider", min: -180, max: 180, step: 5 }
    ]
  },
  {
    id: "straighten_photo",
    name: "Straighten Photo Online",
    category: "geometry",
    iconName: "ImageIcon",
    description: "Micro-angle alignment correction (-15° to +15°)",
    defaultParams: { angle: 5 },
    paramControls: [
      { key: "angle", label: "Alignment Angle", type: "slider", min: -15, max: 15, step: 0.5 }
    ]
  },

  // Tonal & Exposure
  {
    id: "adjust_brightness",
    name: "Adjust Brightness in Image",
    category: "exposure",
    iconName: "Sun",
    description: "Modify overall image illumination factor",
    defaultParams: { factor: 30 },
    paramControls: [
      { key: "factor", label: "Brightness Factor", type: "slider", min: -100, max: 100, step: 5 }
    ]
  },
  {
    id: "lighten_photo",
    name: "Lighten Photo",
    category: "exposure",
    iconName: "ImageIcon",
    description: "Gently lift shadow and midtone brightness",
    defaultParams: { amount: 30 },
    paramControls: [
      { key: "amount", label: "Lighten Amount", type: "slider", min: 0, max: 100, step: 5 }
    ]
  },
  {
    id: "darken_photo",
    name: "Darken Photo",
    category: "exposure",
    iconName: "ImageIcon",
    description: "Deepen illumination across all channels",
    defaultParams: { amount: 30 },
    paramControls: [
      { key: "amount", label: "Darken Amount", type: "slider", min: 0, max: 100, step: 5 }
    ]
  },
  {
    id: "change_exposure",
    name: "Change Exposure on Photo",
    category: "exposure",
    iconName: "Sliders",
    description: "Photographic exposure compensation in stops (-5 to +5)",
    defaultParams: { stops: 1.0 },
    paramControls: [
      { key: "stops", label: "Exposure Stops", type: "slider", min: -5, max: 5, step: 0.2 }
    ]
  },
  {
    id: "adjust_contrast",
    name: "Adjust Contrast of Image",
    category: "exposure",
    iconName: "Contrast",
    description: "Control tonal slope and dynamic range separation",
    defaultParams: { factor: 30 },
    paramControls: [
      { key: "factor", label: "Contrast Factor", type: "slider", min: -100, max: 100, step: 5 }
    ]
  },
  {
    id: "change_image_gamma",
    name: "Change Image Gamma",
    category: "exposure",
    iconName: "ImageIcon",
    description: "Non-linear gamma curve adjustment (0.1 to 3.0)",
    defaultParams: { gamma: 1.4 },
    paramControls: [
      { key: "gamma", label: "Gamma Value", type: "slider", min: 0.2, max: 3.0, step: 0.1 }
    ]
  },

  // Color & Saturation
  {
    id: "grayscale_image",
    name: "Grayscale Image",
    category: "color",
    iconName: "Contrast",
    description: "Convert image to pure luminance grayscale",
    defaultParams: {},
    paramControls: []
  },
  {
    id: "color_photo_to_bw",
    name: "Color Photo To B&W Image",
    category: "color",
    iconName: "ImageIcon",
    description: "High-contrast binary black & white threshold",
    defaultParams: { threshold: 128 },
    paramControls: [
      { key: "threshold", label: "B&W Threshold", type: "slider", min: 10, max: 245, step: 5 }
    ]
  },
  {
    id: "make_sepia_tone",
    name: "Make Sepia Tone Photo",
    category: "color",
    iconName: "ImageIcon",
    description: "Classic warm vintage photographic tint",
    defaultParams: { intensity: 80 },
    paramControls: [
      { key: "intensity", label: "Sepia Intensity", type: "slider", min: 0, max: 100, step: 5 }
    ]
  },
  {
    id: "invert_colors",
    name: "Invert Image (Colors)",
    category: "color",
    iconName: "MinusCircle",
    description: "Invert RGB chromatic channels",
    defaultParams: {},
    paramControls: []
  },
  {
    id: "shift_hue",
    name: "Shift Hue of Image",
    category: "color",
    iconName: "ImageIcon",
    description: "Rotate color wheel spectrum (-180° to +180°)",
    defaultParams: { degrees: 90 },
    paramControls: [
      { key: "degrees", label: "Hue Rotation Degrees", type: "slider", min: -180, max: 180, step: 10 }
    ]
  },
  {
    id: "change_saturation",
    name: "Change Saturation of Image",
    category: "color",
    iconName: "ImageIcon",
    description: "Scale color purity and chromatic richness",
    defaultParams: { factor: 40 },
    paramControls: [
      { key: "factor", label: "Saturation Factor", type: "slider", min: -100, max: 100, step: 5 }
    ]
  },
  {
    id: "adjust_vibrance",
    name: "Adjust Vibrance of Image",
    category: "color",
    iconName: "ImageIcon",
    description: "Boost muted tones while protecting skin highlights",
    defaultParams: { factor: 40 },
    paramControls: [
      { key: "factor", label: "Vibrance Factor", type: "slider", min: -100, max: 100, step: 5 }
    ]
  },
  {
    id: "clip_color_values",
    name: "Clip Photo (Color Values)",
    category: "color",
    iconName: "ImageIcon",
    description: "Clamp color values between minimum and maximum bounds",
    defaultParams: { min: 20, max: 235 },
    paramControls: [
      { key: "min", label: "Min Value", type: "slider", min: 0, max: 120, step: 5 },
      { key: "max", label: "Max Value", type: "slider", min: 130, max: 255, step: 5 }
    ]
  },
  {
    id: "hsl_adjustment",
    name: "HSL Adjustment in Image",
    category: "color",
    iconName: "Contrast",
    description: "Fine-tune Hue, Saturation, and Lightness simultaneously",
    defaultParams: { hue: 0, saturation: 20, lightness: 10 },
    paramControls: [
      { key: "hue", label: "Hue Shift", type: "slider", min: -180, max: 180, step: 10 },
      { key: "saturation", label: "Saturation", type: "slider", min: -100, max: 100, step: 5 },
      { key: "lightness", label: "Lightness", type: "slider", min: -100, max: 100, step: 5 }
    ]
  },

  // Effects & Styling
  {
    id: "sharpen_image",
    name: "Sharpen Image",
    category: "effects",
    iconName: "Zap",
    description: "Enhance edge clarity and micro-contrast",
    defaultParams: { sigma: 2.0 },
    paramControls: [
      { key: "sigma", label: "Sharpen Sigma", type: "slider", min: 0.5, max: 8.0, step: 0.5 }
    ]
  },
  {
    id: "blur_image",
    name: "Blur Image",
    category: "effects",
    iconName: "EyeOff",
    description: "Gaussian smoothing filter across all channels",
    defaultParams: { sigma: 5.0 },
    paramControls: [
      { key: "sigma", label: "Blur Sigma", type: "slider", min: 0.5, max: 30.0, step: 0.5 }
    ]
  },
  {
    id: "add_noise",
    name: "Add noise to Image",
    category: "effects",
    iconName: "ImageIcon",
    description: "Inject film grain texture overlay",
    defaultParams: { intensity: 25 },
    paramControls: [
      { key: "intensity", label: "Grain Intensity", type: "slider", min: 5, max: 100, step: 5 }
    ]
  },
  {
    id: "posterize_effect",
    name: "Posterize Effect in Photo",
    category: "effects",
    iconName: "ImageIcon",
    description: "Quantize colors into stylized artistic poster steps",
    defaultParams: { levels: 4 },
    paramControls: [
      { key: "levels", label: "Posterize Steps", type: "slider", min: 2, max: 16, step: 1 }
    ]
  },
  {
    id: "glow_effect",
    name: "Glow Effect in Photo",
    category: "effects",
    iconName: "Sparkles",
    description: "Luminous bloom highlights via composite blend",
    defaultParams: { intensity: 60, radius: 12 },
    paramControls: [
      { key: "intensity", label: "Glow Intensity", type: "slider", min: 10, max: 100, step: 5 },
      { key: "radius", label: "Bloom Radius", type: "slider", min: 2, max: 30, step: 2 }
    ]
  }
];
