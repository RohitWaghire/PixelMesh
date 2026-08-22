import { NextResponse } from "next/server";
import { FILTER_TOOLS_CATALOG } from "@/lib/image/tools-catalog";

export async function GET() {
  const geometryTools = FILTER_TOOLS_CATALOG.filter(t => t.category === "geometry").map(t => t.id).join(", ");
  const exposureTools = FILTER_TOOLS_CATALOG.filter(t => t.category === "exposure").map(t => t.id).join(", ");
  const colorTools = FILTER_TOOLS_CATALOG.filter(t => t.category === "color").map(t => t.id).join(", ");
  const effectsTools = FILTER_TOOLS_CATALOG.filter(t => t.category === "effects").map(t => t.id).join(", ");

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
- Geometry: ${geometryTools}
- Exposure: ${exposureTools}
- Color: ${colorTools}
- Effects: ${effectsTools}
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
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
