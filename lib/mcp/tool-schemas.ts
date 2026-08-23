export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

export const MCP_IMAGE_TOOLS: MCPToolDefinition[] = [
  {
    name: "crop_image",
    description: "Crop an image to an exact rectangular bounding box.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 data URI or raw base64 string of the image" },
        image_key: { type: "string", description: "Direct storage object key (e.g. raw/2026/08/asset.png)" },
        image_url: { type: "string", description: "Remote public HTTP/HTTPS image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional return format (base64 data URI, storage key, or presigned URL)" },
        left: { type: "number", description: "X coordinate of top-left corner (px)", default: 0 },
        top: { type: "number", description: "Y coordinate of top-left corner (px)", default: 0 },
        width: { type: "number", description: "Width of cropped rectangle (px)" },
        height: { type: "number", description: "Height of cropped rectangle (px)" },
        output_format: { type: "string", enum: ["png", "jpeg", "webp"], description: "Optional output format" }
      },
      required: ["image_base64", "width", "height"]
    }
  },
  {
    name: "circle_crop",
    description: "Crop an image into a circle avatar with an alpha transparency mask.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        radius: { type: "number", description: "Circle radius in px" },
        centerX: { type: "number", description: "Center X coordinate (default image center)" },
        centerY: { type: "number", description: "Center Y\ coordinate (default image center)" }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "flip_image",
    description: "Mirror an image horizontally or vertically.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        direction: { type: "string", enum: ["horizontal", "vertical"], description: "Flip axis" }
      },
      required: ["image_base64", "direction"]
    }
  },
  {
    name: "rotate_image",
    description: "Rotate an image by arbitrary degrees with auto-fitting dynamic canvas bounds.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        degrees: { type: "number", description: "Rotation angle in degrees" },
        background: { type: "string", description: "Background fill color for non-alpha images (e.g. #000000)" }
      },
      required: ["image_base64", "degrees"]
    }
  },
  {
    name: "straighten_photo",
    description: "Perform micro-angle rotation and crop straightening (-15 to +15 deg).",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        angle: { type: "number", description: "Straightening angle (-15 to +15)" }
      },
      required: ["image_base64", "angle"]
    }
  },
  {
    name: "adjust_brightness",
    description: "Modify the brightness of an image.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        factor: { type: "number", description: "Brightness factor (-100 to 100)" }
      },
      required: ["image_base64", "factor"]
    }
  },
  {
    name: "lighten_photo",
    description: "Increase midtone and shadow brightness.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        amount: { type: "number", description: "Lighten amount (0 to 100)" }
      },
      required: ["image_base64", "amount"]
    }
  },
  {
    name: "darken_photo",
    description: "Deepen photo illumination and shadow levels.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        amount: { type: "number", description: "Darken amount (0 to 100)" }
      },
      required: ["image_base64", "amount"]
    }
  },
  {
    name: "change_exposure",
    description: "Photographic exposure compensation in stops (-5 to +5).",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        stops: { type: "number", description: "Exposure stops (-5 to +5)" }
      },
      required: ["image_base64", "stops"]
    }
  },
  {
    name: "adjust_contrast",
    description: "Adjust tonal contrast and dynamic range curve.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        factor: { type: "number", description: "Contrast factor (-100 to 100)" }
      },
      required: ["image_base64", "factor"]
    }
  },
  {
    name: "change_image_gamma",
    description: "Apply non-linear gamma curve adjustment (0.1 to 3.0).",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        gamma: { type: "number", description: "Gamma value (0.1 to 3.0)" }
      },
      required: ["image_base64", "gamma"]
    }
  },
  {
    name: "grayscale_image",
    description: "Convert image to single-channel luminance grayscale.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "color_photo_to_bw",
    description: "Convert photo to high-contrast binary black and white with a threshold.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        threshold: { type: "number", description: "B&W threshold level (0 to 255)", default: 128 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "make_sepia_tone",
    description: "Apply warm vintage sepia photographic tint matrix.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        intensity: { type: "number", description: "Sepia intensity (0 to 100)", default: 80 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "invert_colors",
    description: "Invert all chromatic RGB color values.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "shift_hue",
    description: "Shift chromatic hue angle around the 360° color wheel.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        degrees: { type: "number", description: "Degrees to rotate hue (-180 to 180)" }
      },
      required: ["image_base64", "degrees"]
    }
  },
  {
    name: "change_saturation",
    description: "Scale color saturation and chromatic richness.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        factor: { type: "number", description: "Saturation factor (-100 to 100)" }
      },
      required: ["image_base64", "factor"]
    }
  },
  {
    name: "adjust_vibrance",
    description: "Increase saturation in muted regions while preserving skin tones.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        factor: { type: "number", description: "Vibrance factor (-100 to 100)" }
      },
      required: ["image_base64", "factor"]
    }
  },
  {
    name: "clip_color_values",
    description: "Clip and remap minimum/maximum color values.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        min: { type: "number", description: "Minimum floor value (0 to 255)", default: 15 },
        max: { type: "number", description: "Maximum ceiling value (0 to 255)", default: 240 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "hsl_adjustment",
    description: "Simultaneously adjust Hue, Saturation, and Lightness.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        hue: { type: "number", description: "Hue rotation in degrees" },
        saturation: { type: "number", description: "Saturation factor (-100 to 100)" },
        lightness: { type: "number", description: "Lightness factor (-100 to 100)" }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "sharpen_image",
    description: "Sharpen edges and enhance fine micro-detail.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        sigma: { type: "number", description: "Sharpen sigma radius", default: 1.5 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "blur_image",
    description: "Apply gaussian blur smoothing.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        sigma: { type: "number", description: "Gaussian blur sigma", default: 5 }
      },
      required: ["image_base64", "sigma"]
    }
  },
  {
    name: "add_noise",
    description: "Inject film grain texture overlay.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        intensity: { type: "number", description: "Grain intensity (0 to 100)", default: 25 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "posterize_effect",
    description: "Quantize colors into discrete poster steps.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        levels: { type: "number", description: "Quantization levels (2 to 32)", default: 4 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "glow_effect",
    description: "Apply luminous bloom highlights via blurred composite blend.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        intensity: { type: "number", description: "Glow intensity (0 to 100)", default: 50 },
        radius: { type: "number", description: "Bloom radius in px", default: 10 }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "get_image_metadata",
    description: "Inspect image dimensions, format, space, channels, and size bytes without modifying pixels.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" }
      },
      required: ["image_base64"]
    }
  },
  {
    name: "batch_filter_pipeline",
    description: "Execute a sequential chain of multiple filter operations atomically.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64 image data" },
        image_key: { type: "string", description: "Storage object key" },
        image_url: { type: "string", description: "Remote image URL" },
        return_type: { type: "string", enum: ["base64", "storage", "url"], description: "Optional output format" },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string", description: "Filter tool name" },
              params: { type: "object", description: "Parameters for this filter tool" }
            },
            required: ["tool"]
          },
          description: "Ordered array of filter operations to apply sequentially"
        }
      },
      required: ["image_base64", "operations"]
    }
  }
];
