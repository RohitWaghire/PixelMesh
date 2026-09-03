# PixelMesh Technical Documentation for AI Agents & WebMCP Evaluators

## WebMCP In-Browser Implementation (OpenAI WebMCP Challenge)
PixelMesh implements the W3C / Chrome WebMCP standard allowing browser agents (Chrome 149+, ChatGPT in-app browser, Claude, Codex) to discover and execute image processing tools directly on the webpage.

- **Host Interface**: navigator.modelContext and document.modelContext
- **Studio URL**: /studio
- **Authentication**: Zero keys required for in-browser WebMCP testing.
- **Available WebMCP Tools (30+)**:
  1. `crop_image`: Crop image to exact rectangle boundary (left, top, width, height)
  2. `circle_crop`: Create a circular avatar or badge crop with alpha mask
  3. `flip_image`: Mirror image horizontally or vertically
  4. `rotate_image`: Rotate image with dynamic auto-fit canvas bounds
  5. `straighten_photo`: Micro-angle alignment correction (-15° to +15°)
  6. `adjust_brightness`: Modify overall image illumination factor
  7. `lighten_photo`: Targeted shadow and mid-tone lift
  8. `darken_photo`: Controlled highlight dampening
  9. `adjust_exposure`: Linear photographic exposure scale
  10. `adjust_contrast`: Dynamic range expansion/compression
  11. `adjust_gamma`: Non-linear power-law luminance adjustment
  12. `grayscale_photo`: Rec. 601 / ITU-R luminance desaturation
  13. `color_photo_to_bw`: High-contrast black and white transformation
  14. `make_sepia_tone`: Warm vintage sepia tint
  15. `invert_image`: Spectral color reversal
  16. `shift_hue`: 360° chromatic phase rotation
  17. `adjust_saturation`: Vibrancy & color purity modulation
  18. `adjust_vibrance`: Skin-tone safe saturation enhancement
  19. `clip_photo`: Hard pixel ceiling/floor clamping
  20. `hsl_adjustment`: Fine-grain hue/saturation/lightness balancing
  21. `sharpen_image`: High-frequency convolution edge enhancement
  22. `blur_image`: Gaussian spatial smoothing
  23. `noise_filter`: Controlled film grain injection
  24. `posterize_photo`: Tonal quantization & color banding
  25. `glow_effect`: Soft diffusion bloom effect
  26. `inspect_image`: Read active canvas metadata (dimensions, channels, format)
  27. `load_preset_image`: Load photography sample preset or external image URL
  28. `set_comparison_slider`: Adjust before/after split slider and zoom
  29. `undo_canvas_action`: Revert most recent filter or reset canvas
  30. `export_canvas_image`: Export processed image as base64 data URL
  31. `apply_filter`: Generic filter dispatcher
  32. `build_filter_pipeline`: Atomic multi-step pipeline DAG

## Backend JSON-RPC MCP Server (/api/mcp)
For external programmatic agents (Claude Desktop, Cursor, Python, Node):
- Endpoint: POST /api/mcp
- Cryptographic Auth: Ed25519 / RSA asymmetric signature
- Headers: X-Agent-Key-Fingerprint, X-Agent-Timestamp, X-Agent-Nonce, X-Agent-Signature
