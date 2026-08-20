import { NextRequest, NextResponse } from "next/server";
import { processSingleFilter, processPipeline } from "@/lib/image/engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image_base64, tool, params = {}, operations, output_format } = body;

    if (!image_base64) {
      return NextResponse.json({ error: "Missing required field: image_base64" }, { status: 400 });
    }

    if (operations && Array.isArray(operations)) {
      const result = await processPipeline(image_base64, operations, output_format);
      return NextResponse.json({ success: true, result });
    }

    if (!tool) {
      return NextResponse.json({ error: "Missing required field: tool (or operations array)" }, { status: 400 });
    }

    const result = await processSingleFilter(image_base64, tool, params, output_format);
    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Image processing failed" }, { status: 500 });
  }
}
