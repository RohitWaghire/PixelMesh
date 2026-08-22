import { NextRequest, NextResponse } from "next/server";
import { telemetryStore } from "@/lib/telemetry/store";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const take = url.searchParams.get("take") ? parseInt(url.searchParams.get("take")!, 10) : 100;
  const skip = url.searchParams.get("skip") ? parseInt(url.searchParams.get("skip")!, 10) : 0;
  const fingerprint = url.searchParams.get("fingerprint") || undefined;
  const status = url.searchParams.get("status") as any || undefined;

  const logs = await telemetryStore.getLogs({ take, skip, fingerprint, status });
  return NextResponse.json({ logs });
}

export async function DELETE() {
  await telemetryStore.clear();
  return NextResponse.json({ success: true, message: "Telemetry logs cleared." });
}
