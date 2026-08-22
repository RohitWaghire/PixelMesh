import { NextResponse } from "next/server";

export async function GET() {
  const content = `# PixelMesh Index & Machine Manifest

## Gateway Endpoints
- MCP Protocol Gateway: POST /api/mcp
- Machine Self-Registration: POST /api/auth/register
- Keyring List: GET /api/auth/keys
- Telemetry Logs: GET /api/telemetry/logs

## Interfaces
- Overview: /
- Web Studio Sandbox: /studio
- Developer Dashboard: /dashboard
- API Documentation: /docs

## Machine Discovery
- LLM Overview: /llms.txt
- Agent Docs: /docs.md
- Sitemap: /sitemap.xml
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
