# 02: Core Image Filter Engine & Direct Studio Playground

**What to build:**
A high-performance native image processing engine using `sharp` covering all 21+ filter tools across Geometry, Tonal, Color, Effects, and Pipeline chaining, paired with an interactive Studio Playground featuring real-time Before/After split sliders and pre-loaded sample photography.

**Blocked by:** 01 (Project Scaffold & Cryptographic Auth Gateway)

**Status:** ready-for-agent

- [ ] Native `sharp` filter engine implementation for all 21+ tools (Crop, Circle Crop, Flip, Rotate with dynamic auto-fit bounds, Straighten, Brightness, Lighten, Darken, Exposure, Contrast, Gamma, Grayscale, B&W, Sepia, Invert, Hue, Saturation, Vibrance, HSL, Color Clip, Sharpen, Blur, Noise, Posterize, Glow with canvas composite blend, and Batch Pipeline)
- [ ] Direct studio processing endpoint (`/api/studio/process`) accepting/returning Base64 image payloads with format auto-preservation
- [ ] Interactive Studio UI with Categorized Tool Sidebar (matching specification)
- [ ] Interactive Center Canvas Viewport with draggable Before/After split comparison slider, zoom, and pan
- [ ] Pre-loaded sample photography (portraits, landscapes, neon cityscape) for instant testing
- [ ] Bottom pipeline timeline DAG for multi-step filter composition with undo/redo
