import { NextRequest, NextResponse } from "next/server";
import { processSingleFilter, processPipeline } from "@/lib/image/engine";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limiter";
import { FILTER_TOOLS_CATALOG } from "@/lib/image/tools-catalog";

const MAX_STUDIO_BASE64_LEN = 14 * 1024 * 1024; // Approx 10MB raw image limit
const MAX_PIPELINE_OPERATIONS = 5;
const VALID_TOOL_IDS = new Set(FILTER_TOOLS_CATALOG.map((t) => t.id));

export async function POST(req: NextRequest) {
  try {
    // 1. IP-Based Sliding Window Rate Limiting (20 requests per 60 seconds)
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimit(`studio:${clientIp}`, 20, 60);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Studio sandbox is limited to 20 operations per minute. Please wait ${rateLimit.resetSeconds}s or connect an AI agent key.`
        },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.resetSeconds.toString(),
            "X-RateLimit-Limit": rateLimit.limit.toString(),
            "X-RateLimit-Remaining": "0"
          }
        }
      );
    }

    const body = await req.json();
    const { image_base64, tool, params = {}, operations, output_format } = body;

    if (!image_base64 || typeof image_base64 !== "string") {
      return NextResponse.json({ error: "Missing required field: image_base64" }, { status: 400 });
    }

    // 2. Strict Payload Size Threshold for Unauthenticated Studio Processing (10MB)
    if (image_base64.length > MAX_STUDIO_BASE64_LEN) {
      return NextResponse.json(
        { error: "Payload Too Large: Studio sandbox accepts images up to 10MB. For larger high-res assets, use an authenticated Agent Key." },
        { status: 413 }
      );
    }

    // 3. Multi-Step Pipeline Execution
    if (operations && Array.isArray(operations)) {
      if (operations.length > MAX_PIPELINE_OPERATIONS) {
        return NextResponse.json(
          { error: `Too many pipeline operations: Maximum ${MAX_PIPELINE_OPERATIONS} operations allowed in Studio sandbox.` },
          { status: 400 }
        );
      }

      for (const op of operations) {
        if (!op.tool || !VALID_TOOL_IDS.has(op.tool)) {
          return NextResponse.json(
            { error: `Invalid tool in pipeline: '${op.tool}' is not a recognized filter tool.` },
            { status: 400 }
          );
        }
      }

      const result = await processPipeline(image_base64, operations, output_format);
      return NextResponse.json({ success: true, result });
    }

    // 4. Single Tool Execution
    if (!tool) {
      return NextResponse.json({ error: "Missing required field: tool (or operations array)" }, { status: 400 });
    }

    if (!VALID_TOOL_IDS.has(tool)) {
      return NextResponse.json(
        { error: `Unrecognized filter tool: '${tool}'.` },
        { status: 400 }
      );
    }

    const result = await processSingleFilter(image_base64, tool, params, output_format);
    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Image processing failed" }, { status: 500 });
  }
}
