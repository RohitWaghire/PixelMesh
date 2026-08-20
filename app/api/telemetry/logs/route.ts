import { NextResponse } from "next/server";
import { telemetryStore } from "@/lib/telemetry/store";

export async function GET() {
  return NextResponse.json({
    logs: telemetryStore.getLogs()
  });
}

export async function DELETE() {
  telemetryStore.clear();
  return NextResponse.json({ success: true, message: "Telemetry logs cleared." });
}
