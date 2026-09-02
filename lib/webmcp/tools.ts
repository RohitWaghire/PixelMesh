/**
 * PixelMesh WebMCP Studio Tool Catalog & Canvas Adapters
 * 
 * Exposes 8 granular image manipulation, comparison, inspection, and export tools
 * onto document.modelContext adhering to the W3C WebMCP draft specification,
 * prompt character budgets (<500 char tool desc, <150 char param desc),
 * security hints, and AbortSignal cancellation.
 * 
 * @module lib/webmcp/tools
 */

import type {
  ModelContext,
  ModelContextTool,
  RegisteredTool,
  ToolExecuteCallbackOptions,
} from "./types";
import { WebMCPError, WebMCPExecutionError, WebMCPValidationError } from "./types";
import type { ImageMetadata } from "../image/types";
import { FILTER_TOOLS_CATALOG } from "../image/tools-catalog";

// ============================================================================
// 1. Adapter & Result Types
// ============================================================================

export interface StudioPipelineOperation {
  tool: string;
  params?: Record<string, any>;
}

export interface StudioProcessResult {
  processedImage: string;
  metadata: ImageMetadata;
  executionTimeMs: number;
}

export interface StudioCropResult {
  processedImage: string;
  metadata: ImageMetadata;
  executionTimeMs?: number;
}

export interface StudioUndoResult {
  remainingSteps: number;
  restored: boolean;
  activeImage?: string | null;
}

export interface StudioExportResult {
  imageBase64: string;
  format: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface StudioInspectionResult {
  hasImage: boolean;
  isModified: boolean;
  dimensions: {
    width?: number;
    height?: number;
  };
  format?: string;
  channels?: number;
  colorSpace?: string;
  sizeBytes?: number;
  pipelineLength: number;
  pipelineSteps: Array<{ tool: string; params: any }>;
  sliderPosition: number;
  zoomLevel: number;
}

/**
 * StudioCanvasAdapter decouples WebMCP tool execution callbacks
 * from React component state and network API endpoints.
 */
export interface StudioCanvasAdapter {
  getImage(): string | null;
  getOriginalImage(): string | null;
  getMetadata(): ImageMetadata | null;
  getPipelineSteps(): Array<{ tool: string; params: any }>;
  getSliderPos(): number;
  getZoom(): number;

  applyFilter(
    tool: string,
    params: Record<string, any>,
    signal?: AbortSignal
  ): Promise<StudioProcessResult>;

  cropImage(
    left: number,
    top: number,
    width: number,
    height: number,
    signal?: AbortSignal
  ): Promise<StudioCropResult>;

  buildPipeline(
    operations: Array<{ tool: string; params?: any }>,
    signal?: AbortSignal,
    outputFormat?: string
  ): Promise<StudioProcessResult>;

  loadPreset(
    presetIndex?: number,
    imageUrl?: string,
    signal?: AbortSignal
  ): Promise<void>;

  setSlider(pos: number, zoom?: number): void;

  undoAction(action: "undo_last" | "reset_all"): StudioUndoResult;

  exportImage(
    format?: string,
    quality?: number
  ): Promise<StudioExportResult>;
}

// ============================================================================
// 2. Safe Execution Helper
// ============================================================================

async function safeExecute<T>(
  toolName: string,
  options: ToolExecuteCallbackOptions | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (options?.signal?.aborted) {
    const reason = options.signal.reason;
    const msg = typeof reason === "string" ? reason : reason?.message || "The operation was aborted.";
    if (typeof DOMException !== "undefined") {
      throw new DOMException(msg, "AbortError");
    }
    const err = new Error(msg);
    err.name = "AbortError";
    throw err;
  }

  try {
    return await fn();
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw err;
    }
    if (err instanceof WebMCPError) {
      throw err;
    }
    throw new WebMCPExecutionError(
      err?.message || `Execution failed in tool "${toolName}"`,
      toolName,
      err
    );
  }
}

// ============================================================================
// 3. Tool Catalog Generator Functions
// ============================================================================

export const VALID_CATALOG_TOOL_IDS = FILTER_TOOLS_CATALOG.map((t) => t.id);
export const VALID_IMAGE_TOOL_IDS = VALID_CATALOG_TOOL_IDS;

/**
 * 1. apply_filter: Applies a photographic filter from the PixelMesh catalog.
 */
export function createApplyFilterTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "apply_filter",
    description: "Applies a photographic filter from the PixelMesh catalog to the active canvas image with configurable parameters.",
    readOnlyHint: false,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: "Filter tool ID (e.g. grayscale_image, adjust_brightness, blur_image, sharpen_image, invert_colors).",
          enum: VALID_CATALOG_TOOL_IDS,
        },
        params: {
          type: "object",
          description: "Key-value configuration parameters tailored to the selected filter tool.",
          default: {},
        },
        output_format: {
          type: "string",
          description: "Output format for the processed image (png, jpeg, webp).",
          enum: ["png", "jpeg", "webp"],
          default: "png",
        },
      },
      required: ["tool"],
    },
    execute: async (params: { tool: string; params?: Record<string, any>; output_format?: string }, options) => {
      return safeExecute("apply_filter", options, async () => {
        if (!adapter.getImage() && !adapter.getOriginalImage()) {
          throw new WebMCPValidationError("No image is currently loaded in the studio canvas", "image");
        }
        return await adapter.applyFilter(params.tool, params.params || {}, options?.signal);
      });
    },
  };
}

/**
 * 2. crop_canvas: Crops the active canvas image to a rectangular pixel region.
 */
export function createCropCanvasTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "crop_canvas",
    description: "Crops the active canvas image to a specified rectangular region (left, top, width, height) in pixels.",
    readOnlyHint: false,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        left: {
          type: "number",
          description: "X-coordinate of the top-left crop box origin in pixels.",
          minimum: 0,
          default: 0,
        },
        top: {
          type: "number",
          description: "Y-coordinate of the top-left crop box origin in pixels.",
          minimum: 0,
          default: 0,
        },
        width: {
          type: "number",
          description: "Width of the crop rectangle in pixels.",
          minimum: 1,
        },
        height: {
          type: "number",
          description: "Height of the crop rectangle in pixels.",
          minimum: 1,
        },
      },
      required: ["width", "height"],
    },
    execute: async (params: { left?: number; top?: number; width: number; height: number }, options) => {
      return safeExecute("crop_canvas", options, async () => {
        if (!adapter.getImage() && !adapter.getOriginalImage()) {
          throw new WebMCPValidationError("No image is currently loaded in the studio canvas", "image");
        }
        const left = params.left ?? 0;
        const top = params.top ?? 0;
        return await adapter.cropImage(left, top, params.width, params.height, options?.signal);
      });
    },
  };
}

/**
 * 3. build_filter_pipeline: Multi-step atomic pipeline execution.
 */
export function createBuildFilterPipelineTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "build_filter_pipeline",
    description: "Executes an atomic multi-step filter pipeline on the active canvas image in sequential order.",
    readOnlyHint: false,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          description: "Array of filter operations to apply sequentially (up to 5 operations).",
          items: {
            type: "object",
            description: "Filter operation containing tool ID and parameters map.",
            properties: {
              tool: {
                type: "string",
                description: "Filter tool ID from catalog.",
              },
              params: {
                type: "object",
                description: "Parameters object for the filter operation.",
              },
            },
            required: ["tool"],
          },
        },
        output_format: {
          type: "string",
          description: "Output format for the final pipeline image.",
          enum: ["png", "jpeg", "webp"],
          default: "png",
        },
      },
      required: ["operations"],
    },
    execute: async (params: { operations: Array<{ tool: string; params?: any }>; output_format?: string }, options) => {
      return safeExecute("build_filter_pipeline", options, async () => {
        if (!adapter.getImage() && !adapter.getOriginalImage()) {
          throw new WebMCPValidationError("No image is currently loaded in the studio canvas", "image");
        }
        if (!params.operations || !Array.isArray(params.operations) || params.operations.length === 0) {
          throw new WebMCPValidationError("Pipeline operations array cannot be empty", "operations");
        }
        if (params.operations.length > 5) {
          throw new WebMCPValidationError("Pipeline cannot exceed maximum of 5 operations", "operations");
        }
        return await adapter.buildPipeline(params.operations, options?.signal, params.output_format);
      });
    },
  };
}

/**
 * 4. inspect_image: Speculative query of image dimensions, format, channels, and pipeline history.
 */
export function createInspectImageTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "inspect_image",
    description: "Inspects the active canvas image metadata (dimensions, format, channels, color space, size, and pipeline history).",
    readOnlyHint: true,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        include_history: {
          type: "boolean",
          description: "Whether to include full pipeline history steps in the response.",
          default: true,
        },
      },
    },
    execute: async (params: { include_history?: boolean } = {}, options) => {
      return safeExecute("inspect_image", options, async () => {
        const image = adapter.getImage();
        const origImage = adapter.getOriginalImage();
        const meta = adapter.getMetadata();
        const steps = adapter.getPipelineSteps();
        const slider = adapter.getSliderPos();
        const zoom = adapter.getZoom();

        const result: StudioInspectionResult = {
          hasImage: !!(image || origImage),
          isModified: !!(image && image !== origImage),
          dimensions: {
            width: meta?.width,
            height: meta?.height,
          },
          format: meta?.format,
          channels: meta?.channels,
          colorSpace: meta?.space,
          sizeBytes: meta?.sizeBytes,
          pipelineLength: steps.length,
          pipelineSteps: params.include_history !== false ? steps : [],
          sliderPosition: slider,
          zoomLevel: zoom,
        };

        return result;
      });
    },
  };
}

/**
 * 5. load_preset_image: Loads a sample photograph preset or remote image URL.
 */
export function createLoadPresetImageTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "load_preset_image",
    description: "Loads a sample photography preset or custom remote image URL into the visual studio canvas.",
    readOnlyHint: false,
    untrustedContentHint: true,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        preset_index: {
          type: "integer",
          description: "Sample preset index (0: Cyberpunk Portrait, 1: Golden Hour Landscape, 2: Architectural Studio).",
          minimum: 0,
          maximum: 2,
        },
        image_url: {
          type: "string",
          description: "External image URL to load directly into the studio canvas.",
        },
      },
    },
    execute: async (params: { preset_index?: number; image_url?: string } = {}, options) => {
      return safeExecute("load_preset_image", options, async () => {
        if (params.preset_index === undefined && !params.image_url) {
          throw new WebMCPValidationError("Must specify either preset_index (0-2) or image_url", "preset_index");
        }
        await adapter.loadPreset(params.preset_index, params.image_url, options?.signal);
        return { success: true, loaded: true };
      });
    },
  };
}

/**
 * 6. set_comparison_slider: Adjusts comparison slider and canvas zoom.
 */
export function createSetComparisonSliderTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "set_comparison_slider",
    description: "Adjusts the visual before/after split comparison slider position (0-100) and canvas zoom level (0.5-3.0).",
    readOnlyHint: false,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        position: {
          type: "number",
          description: "Split slider percentage between 0 (original) and 100 (processed).",
          minimum: 0,
          maximum: 100,
          default: 50,
        },
        zoom: {
          type: "number",
          description: "Canvas viewport zoom scaling factor between 0.5 and 3.0.",
          minimum: 0.5,
          maximum: 3.0,
        },
      },
      required: ["position"],
    },
    execute: async (params: { position: number; zoom?: number }, options) => {
      return safeExecute("set_comparison_slider", options, async () => {
        adapter.setSlider(params.position, params.zoom);
        return {
          sliderPosition: params.position,
          zoom: params.zoom ?? adapter.getZoom(),
        };
      });
    },
  };
}

/**
 * 7. undo_canvas_action: Multi-step undo or reset.
 */
export function createUndoCanvasActionTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "undo_canvas_action",
    description: "Reverts the most recent canvas filter operation or resets the canvas back to the original source image.",
    readOnlyHint: false,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Undo action type: 'undo_last' removes last filter step, 'reset_all' restores original image.",
          enum: ["undo_last", "reset_all"],
          default: "undo_last",
        },
      },
    },
    execute: async (params: { action?: "undo_last" | "reset_all" } = {}, options) => {
      return safeExecute("undo_canvas_action", options, async () => {
        const actionType = params.action || "undo_last";
        const result = adapter.undoAction(actionType);
        return {
          action: actionType,
          remainingSteps: result.remainingSteps,
          restored: result.restored,
        };
      });
    },
  };
}

/**
 * 8. export_canvas_image: Exports image as Base64 data URI.
 */
export function createExportCanvasImageTool(adapter: StudioCanvasAdapter): ModelContextTool {
  return {
    name: "export_canvas_image",
    description: "Exports the current canvas image as a base64 data URI with configurable format and compression quality.",
    readOnlyHint: true,
    untrustedContentHint: false,
    destructiveHint: false,
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Export image format (png, jpeg, webp).",
          enum: ["png", "jpeg", "webp"],
          default: "png",
        },
        quality: {
          type: "number",
          description: "Compression quality percentage between 1 and 100.",
          minimum: 1,
          maximum: 100,
          default: 90,
        },
      },
    },
    execute: async (params: { format?: string; quality?: number } = {}, options) => {
      return safeExecute("export_canvas_image", options, async () => {
        if (!adapter.getImage() && !adapter.getOriginalImage()) {
          throw new WebMCPValidationError("No image is currently loaded to export", "image");
        }
        return await adapter.exportImage(params.format, params.quality);
      });
    },
  };
}

// ============================================================================
// 4. Primary Factory Functions
// ============================================================================

/**
 * Creates an array of all 8 Studio WebMCP tools bound to a StudioCanvasAdapter.
 * 
 * @param adapter StudioCanvasAdapter implementing canvas state queries and mutations.
 * @returns Array of ModelContextTool definitions ready for registration.
 */
export function createStudioWebMCPTools(adapter: StudioCanvasAdapter): ModelContextTool[] {
  const tools = [
    createApplyFilterTool(adapter),
    createCropCanvasTool(adapter),
    createBuildFilterPipelineTool(adapter),
    createInspectImageTool(adapter),
    createLoadPresetImageTool(adapter),
    createSetComparisonSliderTool(adapter),
    createUndoCanvasActionTool(adapter),
    createExportCanvasImageTool(adapter),
  ];

  // Keep the local simulator's alias while exposing the native WebMCP shape.
  return tools.map((tool) => ({
    ...tool,
    inputSchema: tool.parameters,
    annotations: {
      readOnlyHint: tool.readOnlyHint,
      untrustedContentHint: tool.untrustedContentHint,
      destructiveHint: tool.destructiveHint,
    },
  }));
}

/**
 * Registers all 8 Studio WebMCP tools onto a ModelContext instance (e.g. document.modelContext).
 * 
 * @param context Target ModelContext instance.
 * @param adapter StudioCanvasAdapter implementing canvas state queries and mutations.
 * @returns Array of RegisteredTool handles with unregister() capability.
 */
export function registerStudioWebMCPTools(
  context: ModelContext,
  adapter: StudioCanvasAdapter
): RegisteredTool[] {
  const tools = createStudioWebMCPTools(adapter);
  return tools.map((tool) => context.registerTool(tool));
}
