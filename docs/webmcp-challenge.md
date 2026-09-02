# WebMCP Challenge Submission Notes

This document is the working submission record for the OpenAI WebMCP Challenge. Replace the two release placeholders after deployment and video publication; do not submit this document with unresolved placeholders.

## Release Checklist

- [ ] Live URL: `REPLACE_WITH_PUBLIC_LIVE_URL`
- [x] Public repository: `https://github.com/RohitWaghire/PixelMesh`
- [x] Open-source license: repository-root `LICENSE` (MIT)
- [x] English testing instructions: README judge path below
- [ ] Public YouTube demo under three minutes with spoken audio
- [ ] Verify the live URL in ChatGPT's in-app browser
- [ ] Verify the live URL in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`
- [ ] Keep the submitted live project free to access through judging

## Judge Testing Instructions

1. Open the deployed URL and append `/studio`.
2. Use ChatGPT's in-app browser, or Chrome 149+ with the WebMCP testing flag enabled and the browser relaunched.
3. Ask the agent: `Load the Cyberpunk Portrait preset, apply make_sepia_tone with intensity 0.65, move the comparison slider to 65, then inspect the image.`
4. Confirm the agent uses the four named WebMCP tools and that the visible canvas, comparison slider, and activity history update.

No login or credentials are required for the Studio smoke test. The Studio processing route is rate-limited and accepts images up to 10 MB. The backend `/api/mcp` route is a separate signed JSON-RPC interface documented in the main README.

If the activity panel identifies the host as `Polyfill`, WebMCP is not enabled in the current browser. That fallback is useful for local development, but the challenge test must use a native WebMCP host.

## Submission Description Draft

### Why WebMCP fits

Image editing is a stateful visual workflow. An agent can see the same canvas as the person, but asking it to operate a conventional editor requires brittle clicks, coordinate guesses, and repeated DOM interpretation. PixelMesh exposes the meaningful operations directly: load an image, apply a named filter, compose a pipeline, inspect metadata, adjust the comparison view, undo, and export.

### User experience

The person keeps the visual editor and can watch every agent action. The agent receives named tools with JSON schemas and concise descriptions instead of inferring controls from pixels. Results return to the same canvas, so the person can review the before/after image, inspect the pipeline, and continue manually.

### Human and agent collaboration

A person can upload or choose a source image, ask an agent for a transformation, tune the result with the sliders, and undo or reset the agent's work. The agent can inspect dimensions and pipeline history before suggesting the next operation. This shared, stateful loop is difficult to achieve reliably through generic browser actuation alone.

### Implementation

`/studio` registers eight imperative WebMCP tools through `document.modelContext`: `apply_filter`, `crop_canvas`, `build_filter_pipeline`, `inspect_image`, `load_preset_image`, `set_comparison_slider`, `undo_canvas_action`, and `export_canvas_image`. Tool definitions use native `inputSchema` and `annotations` metadata, while the local polyfill provides deterministic fallback testing. Every tool calls the same React canvas adapter used by the visible UI. The activity panel records registration, execution, failure, duration, caller, and structured result data.

## Existing Work vs. WebMCP Work

The repository's existing foundation includes the Sharp image engine, signed agent gateway, MCP JSON-RPC endpoint, credit metering, queues, storage adapters, and the human-facing Studio shell. The WebMCP extension was added during the challenge submission period, after August 25, 2026, and is identifiable in the public history:

- `2a417fff` on 2026-08-31: add Studio WebMCP integration.
- `22860da2` on 2026-08-31: serialize canvas mutations and restore undo state.
- `819e1f8b` on 2026-08-31: queue canvas resets and compose pipelines.
- `d2809979` on 2026-08-31: keep viewport and undo state serialized.
- `fa8cef01` on 2026-08-31: reconcile viewport and queued reset state.

These commits add the client-side tool catalog, native WebMCP registration boundary, declarative form annotations, simulator/debugging surface, cancellation handling, execution telemetry, and serialized canvas mutation behavior.

## Official References

- [Challenge rules](https://webmcp.devpost.com/rules)
- [Challenge resources](https://webmcp.devpost.com/resources)
- [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp)
- [WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
