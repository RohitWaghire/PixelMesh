import { NextRequest, NextResponse } from "next/server";
import { telemetryStore } from "@/lib/telemetry/store";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const take = url.searchParams.get("take") ? Math.min(100, Math.max(1, parseInt(url.searchParams.get("take")!, 10))) : 50;
  const skip = url.searchParams.get("skip") ? Math.max(0, parseInt(url.searchParams.get("skip")!, 10)) : 0;
  let fingerprint = url.searchParams.get("fingerprint") || undefined;
  const status = url.searchParams.get("status") as any || undefined;

  const callerFingerprint = req.headers.get("x-agent-key-fingerprint");
  const timestampStr = req.headers.get("x-agent-timestamp");
  const nonce = req.headers.get("x-agent-nonce");
  const signature = req.headers.get("x-agent-signature");

  if (!callerFingerprint || !timestampStr || !nonce || !signature) {
    return NextResponse.json({
      error: "Unauthorized: Accessing telemetry audit logs requires cryptographic agent signature."
    }, { status: 401 });
  }

  const timestampNum = parseInt(timestampStr, 10);
  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum);
  if (!nonceCheck.valid) {
    return NextResponse.json({
      error: `Unauthorized: ${nonceCheck.reason}`
    }, { status: nonceCheck.statusCode || 401 });
  }

  const callerKey = await keyStore.findKeyByFingerprint(callerFingerprint);
  if (!callerKey || callerKey.status === "revoked") {
    return NextResponse.json({
      error: "Unauthorized: Agent key not found or revoked."
    }, { status: 401 });
  }

  const isValidSig = verifyRequestSignature({
    publicKeyPem: callerKey.publicKeyPem,
    signature,
    method: "GET",
    path: url.pathname,
    timestamp: timestampStr,
    nonce,
    body: ""
  });

  if (!isValidSig) {
    return NextResponse.json({
      error: "Unauthorized: Signature verification failed."
    }, { status: 401 });
  }

  const isAdmin = callerKey.scopes?.includes("admin") || callerKey.scopes?.includes("all-tools");
  if (!isAdmin) {
    // Non-admin callers can only view their own logs (tenant isolation)
    fingerprint = callerFingerprint;
  }

  const logs = await telemetryStore.getLogs({ take, skip, fingerprint, status });
  return NextResponse.json({ logs });
}

export async function DELETE(req: NextRequest) {
  const callerFingerprint = req.headers.get("x-agent-key-fingerprint");
  const timestampStr = req.headers.get("x-agent-timestamp");
  const nonce = req.headers.get("x-agent-nonce");
  const signature = req.headers.get("x-agent-signature");

  if (!callerFingerprint || !timestampStr || !nonce || !signature) {
    return NextResponse.json({
      error: "Unauthorized: Deleting audit logs requires cryptographic admin signature."
    }, { status: 401 });
  }

  const timestampNum = parseInt(timestampStr, 10);
  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum);
  if (!nonceCheck.valid) {
    return NextResponse.json({
      error: `Unauthorized: ${nonceCheck.reason}`
    }, { status: nonceCheck.statusCode || 401 });
  }

  const callerKey = await keyStore.findKeyByFingerprint(callerFingerprint);
  if (!callerKey || callerKey.status === "revoked") {
    return NextResponse.json({
      error: "Unauthorized: Admin key not found or revoked."
    }, { status: 401 });
  }

  const isValidSig = verifyRequestSignature({
    publicKeyPem: callerKey.publicKeyPem,
    signature,
    method: "DELETE",
    path: "/api/telemetry/logs",
    timestamp: timestampStr,
    nonce,
    body: ""
  });

  if (!isValidSig) {
    return NextResponse.json({
      error: "Unauthorized: Signature verification failed."
    }, { status: 401 });
  }

  const isAdmin = callerKey.scopes?.includes("admin");
  if (!isAdmin) {
    return NextResponse.json({
      error: "Forbidden: Only admin-scoped keys can clear system telemetry."
    }, { status: 403 });
  }

  await telemetryStore.clear();
  return NextResponse.json({ success: true, message: "Telemetry logs cleared." });
}
