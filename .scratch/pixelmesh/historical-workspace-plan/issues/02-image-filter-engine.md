# Issue 02: 21+ Sharp Image Filter Processing Engine

Status: ready-for-agent

## Description
Implement the high-performance native image processing engine using `sharp` covering all 21+ filter tools with base64 transport, format auto-preservation, and MCP-standard error handling.

## Acceptance Criteria
- `lib/image/engine.ts`: Core processing orchestrator handling format detection, metadata inspection, and pipeline dispatch.
- `lib/image/filters/geometry.ts`: `crop_image`, `circle_crop`, `flip_image`, `rotate_image` (with auto-fit dynamic canvas bounds), `straighten_photo`.
- `lib/image/filters/exposure.ts`: `adjust_brightness`, `lighten_photo`, `darken_photo`, `change_exposure`, `adjust_contrast`, `change_image_gamma`.
- `lib/image/filters/color.ts`: `grayscale_image`, `color_photo_to_bw`, `make_sepia_tone`, `invert_colors`, `shift_hue`, `change_saturation`, `adjust_vibrance`, `hsl_adjustment`, `clip_color_values`.
- `lib/image/filters/effects.ts`: `sharpen_image`, `blur_image`, `add_noise`, `posterize_effect`, `glow_effect` (composite canvas screen/lighten blend).
- `lib/image/filters/pipeline.ts`: `batch_filter_pipeline` for atomic multi-step execution.
- Robust parameter validation returning structured `{ isError: true, content: [{ type: "text", text: "..." }] }` on bounds violation.
