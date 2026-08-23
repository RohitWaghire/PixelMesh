import { NextResponse } from "next/server";
import { FILTER_TOOLS_CATALOG } from "@/lib/image/tools-catalog";

export async function GET() {
  const toolsList = FILTER_TOOLS_CATALOG.map((t, idx) => {
    const paramsSummary = Object.keys(t.defaultParams).join(", ") || "none";
    return `${idx + 1}. \`${t.id}\` (${t.category}): ${t.description} (Params: ${paramsSummary}). Cost: 1 credit.`;
  }).join("\n");

  const content = `# PixelMesh Technical Documentation for AI Agents

## Authentication & Headers
All requests to \`POST /api/mcp\` and \`POST /api/auth/register\` require asymmetric signature verification:
- \`X-Agent-Key-Fingerprint\`: SHA256:<fingerprint>
- \`X-Agent-Timestamp\`: Unix epoch timestamp in seconds (valid within ±60s)
- \`X-Agent-Nonce\`: Unique UUID
- \`X-Agent-Signature\`: Base64 signature of the canonical string

### Canonical Signing Algorithm
\`\`\`
canonical_string = f"{method}\\n{path}\\n{timestamp}\\n{nonce}\\n{sha256(body).hexdigest()}"
signature = sign(private_key, canonical_string.encode())
\`\`\`

## 22+ Native Sharp Image Manipulation Tools
${toolsList}
23. \`batch_filter_pipeline\` (composite): Multi-filter DAG execution in one atomic pass (\`pipeline\`: [{ tool, params }]). Cost: 3 credits.
24. \`get_image_metadata\` (metadata): Extract width, height, format, channels, density without altering pixels. Cost: 1 credit.

> Note: Payloads > 20MB are billed at 5 credits (ADR 0005).
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
