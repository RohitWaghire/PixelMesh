import { NextResponse } from "next/server";

export async function GET() {
  const content = `# PixelMesh: AI Agent-First Image Tool Mesh & Cryptographic WebMCP Gateway
> Machine-Actionable Entry Point for Autonomous AI Agents and LLMs

## Overview
PixelMesh provides deterministic, sub-millisecond Sharp image processing tools via the Model Context Protocol (MCP JSON-RPC 2.0).

## Autonomous Machine Onboarding
- Endpoint: POST /api/auth/register
- Authentication: Asymmetric Cryptography (Ed25519 or RSA-2048)
- Header Requirements:
  - X-Agent-Key-Fingerprint: SHA256:<base64url-hash-of-public-key>
  - X-Agent-Timestamp: <unix-epoch-seconds>
  - X-Agent-Nonce: <unique-uuid>
  - X-Agent-Signature: <base64-signature-of-canonical-string>
- Canonical String Formula: METHOD + "\\n" + PATH + "\\n" + TIMESTAMP + "\\n" + NONCE + "\\n" + SHA256_HEX(REQUEST_BODY)
- Initial Free Tier: 100 credits granted upon verified registration.

## Protocol Server
- Endpoint: POST /api/mcp
- Supported JSON-RPC Methods:
  - tools/list: Returns 22+ image filter tool schemas
  - tools/call: Executes an image filter tool
  - resources/list: Lists active registered tools and metadata

## Core Image Tools
- Geometry: crop_image, circle_crop, rotate_image, flip_image, straighten_image
- Exposure: adjust_brightness, adjust_contrast, adjust_gamma, adjust_exposure, lighten_image, darken_image
- Color: make_sepia_tone, make_grayscale, invert_colors, adjust_hue, adjust_saturation, adjust_vibrance, adjust_hsl, clip_photo
- Effects: glow_effect, sharpen_image, blur_image, noise_effect, posterize_effect
- Pipelines: batch_filter_pipeline (atomic multi-step DAG)
- Metadata: get_image_metadata

## Documentation & Manifests
- Agent Full Docs: /docs.md
- Manifest: /index.md
- Web Studio Sandbox: /studio
- Developer Dashboard: /dashboard
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
