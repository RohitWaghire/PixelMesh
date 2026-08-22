import { NextRequest, NextResponse } from "next/server";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { storageClient } from "@/lib/storage/client";
import { telemetryStore } from "@/lib/telemetry/store";

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  const rawBodyText = await req.text();

  let bodyJson: any = {};
  if (rawBodyText && rawBodyText.trim().length > 0) {
    try {
      bodyJson = JSON.parse(rawBodyText);
    } catch {
      return NextResponse.json({
        success: false,
        error: "Parse error: Invalid JSON in request body"
      }, { status: 400 });
    }
  }

  const {
    filename,
    content_type = "image/png",
    size_bytes,
    expires_seconds = 900
  } = bodyJson;

  // Extract SSH Cryptographic Signature Headers
  const fingerprint = req.headers.get("x-agent-key-fingerprint");
  const timestampStr = req.headers.get("x-agent-timestamp");
  const nonce = req.headers.get("x-agent-nonce");
  const signature = req.headers.get("x-agent-signature");

  // 1. Authenticate Request Headers
  if (!fingerprint || !timestampStr || !nonce || !signature) {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: "upload-url",
      fingerprint: fingerprint || "anonymous",
      agentName: "Unknown Agent",
      signatureValid: false,
      timestampDriftMs: 0,
      nonce: nonce || "none",
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Missing required SSH cryptographic headers (x-agent-key-fingerprint, x-agent-timestamp, x-agent-nonce, x-agent-signature)"
    });

    return NextResponse.json({
      success: false,
      error: "Unauthorized: Missing required SSH cryptographic headers. Sign requests with your registered Agent Private Key."
    }, { status: 401 });
  }

  const timestampNum = parseInt(timestampStr, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  const driftMs = (nowSec - timestampNum) * 1000;

  // 2. Anti-Replay and Clock Skew Check via Distributed Nonce Cache
  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum);
  if (!nonceCheck.valid) {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: "upload-url",
      fingerprint,
      agentName: "Unknown",
      signatureValid: false,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: nonceCheck.reason
    });

    return NextResponse.json({
      success: false,
      error: `Unauthorized: ${nonceCheck.reason}`
    }, { status: nonceCheck.statusCode || 401 });
  }

  // 3. Find Key in Asynchronous Prisma KeyStore
  const agentKey = await keyStore.findKeyByFingerprint(fingerprint);
  if (!agentKey || agentKey.status === "revoked") {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: "upload-url",
      fingerprint,
      agentName: "Unknown",
      signatureValid: false,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Agent key not registered or has been revoked"
    });

    return NextResponse.json({
      success: false,
      error: "Unauthorized: Agent key not found or revoked."
    }, { status: 401 });
  }

  // 4. Verify Cryptographic Signature
  const isValidSig = verifyRequestSignature({
    publicKeyPem: agentKey.publicKeyPem,
    signature,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp: timestampStr,
    nonce,
    body: rawBodyText
  });

  if (!isValidSig) {
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      timestamp: new Date().toISOString(),
      method: "upload-url",
      fingerprint,
      agentName: agentKey.agentName,
      signatureValid: false,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: agentKey.creditsBalance,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Cryptographic signature verification failed (payload or headers tampered)"
    });

    return NextResponse.json({
      success: false,
      error: "Unauthorized: Cryptographic signature verification failed."
    }, { status: 401 });
  }

  // 5. Size Validation
  if (size_bytes !== undefined && typeof size_bytes === "number") {
    if (size_bytes > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json({
        success: false,
        error: `Payload size (${(size_bytes / (1024 * 1024)).toFixed(1)}MB) exceeds 50MB maximum limit.`,
        max_size_bytes: MAX_IMAGE_SIZE_BYTES
      }, { status: 400 });
    }
  }

  // 6. Generate Pre-signed Upload URL
  try {
    const uploadResult = await storageClient.getUploadUrl({
      filename,
      contentType: content_type,
      expiresInSeconds: expires_seconds,
      maxSizeBytes: MAX_IMAGE_SIZE_BYTES
    });

    const latency = Math.round(performance.now() - startTime);
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      timestamp: new Date().toISOString(),
      method: "upload-url",
      fingerprint,
      agentName: agentKey.agentName,
      signatureValid: true,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: agentKey.creditsBalance,
      latencyMs: latency,
      status: "success"
    });

    const response = NextResponse.json({
      success: true,
      upload_url: uploadResult.uploadUrl,
      image_key: uploadResult.imageKey,
      public_url: uploadResult.publicUrl,
      method: "PUT",
      headers: uploadResult.headers || {
        "Content-Type": content_type
      },
      expires_at: uploadResult.expiresAt,
      max_size_bytes: MAX_IMAGE_SIZE_BYTES
    });

    response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
    return response;
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: `Storage error: ${err.message}`
    }, { status: 500 });
  }
}
