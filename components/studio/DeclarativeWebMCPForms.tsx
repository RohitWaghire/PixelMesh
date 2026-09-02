"use client";

import React from "react";
import type { ModelContext } from "@/lib/webmcp/types";

declare module "react" {
  interface FormHTMLAttributes<T> extends React.HTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean;
  }

  interface HTMLAttributes<T> {
    toolparamdescription?: string;
  }
}

export interface DeclarativeWebMCPFormsProps {
  context?: ModelContext | null;
}

/**
 * DeclarativeWebMCPForms
 * 
 * Standard semantic `<form toolname="..." tooldescription="...">` annotations
 * adhering to the W3C WebMCP draft specification and Chrome Labs declarative standards.
 * 
 * AI agents scraping or navigating the browser DOM can discover all 8 studio tools
 * directly from standard HTML forms, input parameter tags, and validation attributes.
 */
export default function DeclarativeWebMCPForms({ context }: DeclarativeWebMCPFormsProps) {
  const handleDeclarativeSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const toolName = form.getAttribute("toolname");
    if (!toolName) return;

    const formData = new FormData(form);
    const params: Record<string, any> = {};

    formData.forEach((value, key) => {
      if (typeof value === "string") {
        try {
          // Attempt to parse JSON values (e.g. for objects or arrays)
          if (value.startsWith("{") || value.startsWith("[")) {
            params[key] = JSON.parse(value);
          } else if (value === "true") {
            params[key] = true;
          } else if (value === "false") {
            params[key] = false;
          } else if (!isNaN(Number(value)) && value.trim() !== "") {
            params[key] = Number(value);
          } else {
            params[key] = value;
          }
        } catch {
          params[key] = value;
        }
      }
    });

    const targetContext =
      context || (typeof document !== "undefined" ? (document as any).modelContext : null);

    if (targetContext && typeof targetContext.executeTool === "function") {
      try {
        await targetContext.executeTool(toolName, params, { caller: "declarative:form" });
      } catch (err) {
        console.error(`Failed executing declarative tool "${toolName}":`, err);
      }
    }
  };

  return (
    <div
      className="sr-only"
      aria-hidden="true"
      data-webmcp-declarative="true"
      data-webmcp-catalog="pixelmesh-studio"
    >
      {/* 1. apply_filter */}
      <form
        toolname="apply_filter"
        tooldescription="Applies a photographic filter from the PixelMesh catalog to the active canvas image with configurable parameters."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <input
          name="tool"
          type="text"
          required
          toolparamdescription="Filter tool identifier from the PixelMesh catalog (e.g. make_sepia_tone, change_exposure, glow_effect)."
        />
        <input
          name="params"
          type="text"
          toolparamdescription="JSON dictionary of numeric or string parameter arguments matching the filter parameter controls."
        />
        <select name="output_format" toolparamdescription="Desired output image format ('png', 'jpeg', or 'webp').">
          <option value="png">png</option>
          <option value="jpeg">jpeg</option>
          <option value="webp">webp</option>
        </select>
        <button type="submit">Apply Filter</button>
      </form>

      {/* 2. crop_canvas */}
      <form
        toolname="crop_canvas"
        tooldescription="Crops the active canvas image to a specified rectangular region (left, top, width, height) in pixels."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <input
          name="left"
          type="number"
          min={0}
          defaultValue={0}
          toolparamdescription="X-coordinate in pixels of the crop region origin top-left corner."
        />
        <input
          name="top"
          type="number"
          min={0}
          defaultValue={0}
          toolparamdescription="Y-coordinate in pixels of the crop region origin top-left corner."
        />
        <input
          name="width"
          type="number"
          min={1}
          required
          toolparamdescription="Width in pixels of the cropped rectangular region."
        />
        <input
          name="height"
          type="number"
          min={1}
          required
          toolparamdescription="Height in pixels of the cropped rectangular region."
        />
        <button type="submit">Crop Canvas</button>
      </form>

      {/* 3. build_filter_pipeline */}
      <form
        toolname="build_filter_pipeline"
        tooldescription="Executes an atomic multi-step filter pipeline on the active canvas image in sequential order."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <input
          name="operations"
          type="text"
          required
          toolparamdescription="Array of filter step operations (1 to 5 items) to execute sequentially on the active image."
        />
        <select name="output_format" toolparamdescription="Desired output image format ('png', 'jpeg', or 'webp').">
          <option value="png">png</option>
          <option value="jpeg">jpeg</option>
          <option value="webp">webp</option>
        </select>
        <button type="submit">Build Filter Pipeline</button>
      </form>

      {/* 4. inspect_image */}
      <form
        toolname="inspect_image"
        tooldescription="Inspects the active canvas image metadata (dimensions, format, channels, color space, size, and pipeline history)."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <input
          name="include_history"
          type="checkbox"
          defaultChecked
          toolparamdescription="Whether to include the full chronological array of pipeline filter operations."
        />
        <button type="submit">Inspect Image</button>
      </form>

      {/* 5. load_preset_image */}
      <form
        toolname="load_preset_image"
        tooldescription="Loads a sample photography preset or custom remote image URL into the visual studio canvas."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <input
          name="preset_index"
          type="number"
          min={0}
          max={2}
          toolparamdescription="Index of standard sample photo (0: Neon Cyberpunk, 1: Golden Hour, 2: Architectural Studio)."
        />
        <input
          name="image_url"
          type="url"
          toolparamdescription="Direct HTTP/HTTPS URL of an external image to load into the canvas."
        />
        <button type="submit">Load Preset Image</button>
      </form>

      {/* 6. set_comparison_slider */}
      <form
        toolname="set_comparison_slider"
        tooldescription="Adjusts the visual before/after split comparison slider position (0-100) and canvas zoom level (0.5-3.0)."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <input
          name="position"
          type="number"
          min={0}
          max={100}
          defaultValue={50}
          required
          toolparamdescription="Percentage position (0-100) for the before/after split divider line."
        />
        <input
          name="zoom"
          type="number"
          min={0.5}
          max={3.0}
          step={0.1}
          toolparamdescription="Visual magnification zoom multiplier for the canvas viewport (0.5 to 3.0)."
        />
        <button type="submit">Set Comparison Slider</button>
      </form>

      {/* 7. undo_canvas_action */}
      <form
        toolname="undo_canvas_action"
        tooldescription="Reverts the most recent canvas filter operation or resets the canvas back to the original source image."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <select
          name="action"
          toolparamdescription="Undo mode: 'undo_last' removes only the most recent step; 'reset_all' reverts to original source."
        >
          <option value="undo_last">undo_last</option>
          <option value="reset_all">reset_all</option>
        </select>
        <button type="submit">Undo Canvas Action</button>
      </form>

      {/* 8. export_canvas_image */}
      <form
        toolname="export_canvas_image"
        tooldescription="Exports the current canvas image as a base64 data URI with configurable format and compression quality."
        toolautosubmit
        onSubmit={handleDeclarativeSubmit}
      >
        <select
          name="format"
          toolparamdescription="Compression and encoding format for the exported image ('png', 'jpeg', or 'webp')."
        >
          <option value="png">png</option>
          <option value="jpeg">jpeg</option>
          <option value="webp">webp</option>
        </select>
        <input
          name="quality"
          type="number"
          min={1}
          max={100}
          defaultValue={90}
          toolparamdescription="Compression quality percentage between 1 and 100."
        />
        <button type="submit">Export Canvas Image</button>
      </form>
    </div>
  );
}
