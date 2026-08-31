# Spec: PixelMesh (WebMCP Image Studio & Cryptographic Agent Gateway)

Status: ready-for-agent

## Problem Statement

Autonomous AI agents (in Claude Desktop, Cursor, Antigravity, or custom workflows) lack a standardized, cryptographically secure mechanism to perform complex raster image processing (cropping, exposure adjustment, tonal balance, filters, and pipeline chaining). Existing solutions either require brittle shared API tokens with high security blast radius, depend on slow third-party cloud storage, or offer basic black-box wrappers without human-in-the-loop observability or anti-replay defenses.

## Solution

**PixelMesh** provides a unified, full-stack Next.js 15 Model Context Protocol (MCP) server and interactive studio dashboard. Autonomous agents authenticate via **SSH-style Public/Private Key (Ed25519/RSA) cryptographic HTTP signatures**, self-register to claim free processing credits with zero human login/email friction, and execute 21+ high-performance image filter tools natively powered by `sharp`. Human operators inspect live signed requests, audit cryptographic telemetry, manage keyrings, and interactively test or chain tools via a before/after split canvas playground.

## User Stories

1. As an autonomous AI agent, I want to self-register my public key via `/api/auth/register` with a cryptographic proof-of-ownership signature, so that I can immediately receive 100 free credits and start using tools without human login or passwords.
2. As an AI agent, I want to sign my HTTP request headers (`X-Agent-Key-Fingerprint`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature`) with my private key, so that my requests are cryptographically authenticated and immune to tampering.
3. As a developer or agent operator, I want the server to reject expired timestamps (>60s drift) and replayed nonces, so that my agent infrastructure is protected against replay attacks.
4. As an AI agent, I want to call `crop_image` with `(x, y, width, height)` on a Base64 image payload, so that I can crop images precisely.
5. As an AI agent, I want to call `circle_crop` with `(centerX, centerY, radius, background)`, so that I can create circular profile avatars and badges.
6. As an AI agent, I want to call `flip_image` horizontally or vertically, so that I can mirror imagery.
7. As an AI agent, I want to call `rotate_image` with arbitrary angles and have the canvas auto-fit bounds dynamically, so that image corners are never truncated.
8. As an AI agent, I want to call `straighten_photo` to make micro-rotations and alignment corrections.
9. As an AI agent, I want to call `adjust_brightness`, `lighten_photo`, and `darken_photo`, so that I can modify image illumination.
10. As an AI agent, I want to call `change_exposure` with stop values (-5 to +5), so that I can perform photographic exposure compensation.
11. As an AI agent, I want to call `adjust_contrast` and `change_image_gamma`, so that I can control dynamic range and midtone contrast.
12. As an AI agent, I want to call `grayscale_image` and `color_photo_to_bw` with customizable thresholds, so that I can produce monochrome assets.
13. As an AI agent, I want to call `make_sepia_tone`, `invert_colors`, `shift_hue`, `change_saturation`, and `adjust_vibrance`, so that I can execute rich color grading.
14. As an AI agent, I want to call `hsl_adjustment` and `clip_color_values`, so that I can control color channels and luminance clipping.
15. As an AI agent, I want to call `sharpen_image`, `blur_image`, `add_noise`, and `posterize_effect`, so that I can apply stylistic and corrective texture effects.
16. As an AI agent, I want to call `glow_effect`, so that I can apply luminous bloom highlights via canvas compositing.
17. As an AI agent, I want to call `batch_filter_pipeline` with an array of sequential operations, so that I can apply multi-step filter recipes atomically in a single network round-trip.
18. As an AI agent, I want to call `get_image_metadata`, so that I can inspect dimensions, format, channels, and color space prior to applying transformations.
19. As an AI agent, I want invalid tool arguments to return an MCP-standard `isError: true` response with detailed recovery instructions instead of severing the JSON-RPC connection, so that I can autonomously correct my parameters and retry without losing credits.
20. As an AI agent, I want to receive `X-Agent-Credits-Remaining` headers on every response, so that I can monitor my credit consumption velocity.
21. As an agent operator, I want to view all registered agent keys, fingerprints, scopes, and balances in the Key Manager dashboard, so that I have complete visibility over agent access.
22. As an agent operator, I want to top up an agent's credit balance or revoke a compromised key instantly from the dashboard.
23. As a developer, I want to test any filter in the interactive Tool Playground with an interactive Before/After split slider, so that I can visually verify image filter fidelity.
24. As a developer, I want to pick an agent key in the playground to simulate real Ed25519 cryptographic signing, so that I can test the full auth pipeline from the UI.
25. As a developer, I want to monitor the Live Request Inspector to audit incoming signatures, timestamp drift, nonce uniqueness, and execution latency.
26. As a developer, I want a one-click copy button for Claude Desktop and Cursor MCP configuration snippets, so that I can connect external coding agents in seconds.
27. As a developer, I want to run a standalone client script (`scripts/test-agent-client.ts`) that generates an Ed25519 keypair, registers, signs requests, and executes tools end-to-end.

## Implementation Decisions

- **Full-Stack Architecture**: Next.js 15 (App Router) combining the `/api/mcp` JSON-RPC endpoint, `/api/auth/*` registration/keyring endpoints, and the React UI in a single unified codebase.
- **Cryptographic Security Layer**:
  - Node.js built-in `crypto` module implementing Ed25519 and RSA-SHA256 signature verification.
  - Canonical request signing format: `METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + SHA256(BODY)`.
  - In-memory anti-replay cache with a 60-second rolling window.
  - File-backed key storage (`.keys/authorized_keys.json`) with auto-provisioning of an initial Dev Agent keypair on first start.
- **Image Processing Engine**:
  - Native Node.js `sharp` with libvips bindings for sub-millisecond execution.
  - Base64 Data URI input and output transport with a 50MB payload limit.
  - Source format auto-preservation (JPEG/PNG/WebP) with optional `output_format` conversion parameter.
  - Dynamic canvas auto-fitting on rotation to prevent corner clipping.
  - Canvas composition with gaussian blur and screen/lighten blend mode for luminous glow effects.
- **MCP Protocol & Error Handling**:
  - Official `@modelcontextprotocol/sdk` supporting `tools/list`, `tools/call`, and `resources/list`.
  - Tool execution errors return `{ result: { content: [{ type: "text", text: "..." }], isError: true } }` with zero credit deduction.
  - Protocol or cryptographic signature failures return top-level JSON-RPC error codes (`-32001 Unauthorized Signature`, `-32002 Insufficient Credits`).
- **Monetization & Metering**:
  - 100 free credits allocated upon agent self-registration.
  - 1 credit per standard filter; 3 credits per batch pipeline / composite glow operation.
- **UI/UX Design Contract**:
  - Deep cyber dark theme (`#09090b` zinc base, emerald cryptographic badges, amber token counters).
  - 3 primary views: Studio & Playground, Agent Keyring Manager, Live Request Inspector.
  - Interactive Before/After split slider on center canvas.
  - Pre-loaded photography samples for zero-friction testing.

## Testing Decisions

- **Testing Philosophy**: Test external observable behavior across the highest architectural seams rather than internal implementation details.
- **Primary Seams**:
  1. **Cryptographic Gateway Seam (`/api/mcp` and `/api/auth/register`)**:
     - Verify autonomous agent registration issues valid key with 100 credits.
     - Verify valid Ed25519 signature succeeds and deducts 1 credit.
     - Verify tampered body payload returns `-32001 Unauthorized Signature`.
     - Verify timestamp drift > 60s is rejected.
     - Verify replayed nonce is rejected.
     - Verify exhausted balance returns `-32002 Insufficient Credits`.
  2. **Image Filter Engine Seam (`lib/image/engine.ts`)**:
     - Verify all 21+ tools process base64 input and produce valid transformed base64 output with correct dimensions and headers.
     - Verify batch pipeline executes sequential transforms correctly.
     - Verify out-of-bounds parameters return structured `isError: true` without throwing unhandled exceptions.
  3. **End-to-End Client CLI (`scripts/test-agent-client.ts`)**:
     - Full automated round-trip: Generate key -> Self-register -> Sign header -> Call `rotate_image` + `glow_effect` -> Verify returned image.

## Out of Scope

- Multi-tenant cloud user billing / credit card processing via Stripe (handled via simulated dashboard top-up for local/self-hosted deployment).
- Video / animated GIF frame-by-frame processing (pure raster image focus).
- Third-party S3 bucket storage hosting (self-contained Base64 transport).

## Further Notes

- Aligns with ADRs 0001 through 0007 in `docs/adr/`.
- Domain glossary defined in `CONTEXT.md`.
- UI/UX Design Contract defined in `DESIGN.md`.
