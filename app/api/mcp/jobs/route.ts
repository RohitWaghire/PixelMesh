import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { jobQueue, inferJobPriority } from "@/lib/queue/job-queue";
import { JobPriority, ReturnType } from "@/lib/queue/types";
import { telemetryStore } from "@/lib/telemetry/store";

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  const rawBodyText = await req.text();

  let bodyJson: any = {};
  if (rawBodyText && rawBodyText.trim().length > 0) {
    try {
      bodyJson = JSON.parse(rawBodyText);
    } catch {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: Invalid JSON in request body" }
      }, { status: 400 });
    }
  }

  const fingerprint = req.headers.get("x-agent-key-fingerprint");
  const timestampStr = req.headers.get("x-agent-timestamp");
  const nonce = req.headers.get("x-agent-nonce");
  const signature = req.headers.get("x-agent-signature");

  if (!fingerprint || !timestampStr || !nonce || !signature) {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: "jobs/submit",
      fingerprint: fingerprint || "anonymous",
      agentName: "Unknown Agent",
      signatureValid: false,
      timestampDriftMs: 0,
      nonce: nonce || "none",
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Missing required SSH cryptographic headers"
    });

    return NextResponse.json({
      success: false,
      error: "Unauthorized: Missing required SSH cryptographic headers. Sign requests with your registered Agent Private Key."
    }, { status: 401 });
  }

  const timestampNum = parseInt(timestampStr, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  const driftMs = (nowSec - timestampNum) * 1000;

  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum);
  if (!nonceCheck.valid) {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: "jobs/submit",
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

  const agentKey = await keyStore.findKeyByFingerprint(fingerprint);
  if (!agentKey || agentKey.status === "revoked") {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: "jobs/submit",
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

  const isValidSig = verifyRequestSignature({
    publicKeyPem: agentKey.publicKeyPem,
    signature,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp: timestampStr,
    nonce,
    body: rawBodyText
  });

  if (!isValidSig) {
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      timestamp: new Date().toISOString(),
      method: "jobs/submit",
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

  const isJsonRpc = bodyJson.jsonrpc === "2.0";
  const rpcId = bodyJson.id ?? null;
  const params = bodyJson.params || {};

  const toolName = params.name || params.tool || bodyJson.tool || bodyJson.toolName || bodyJson.name;
  const toolArgs = params.arguments || params.args || bodyJson.arguments || bodyJson.params || bodyJson.toolArgs || {};
  const requestedPriority: JobPriority = params.priority || bodyJson.priority || toolArgs.priority || inferJobPriority(toolName, toolArgs);
  const returnType: ReturnType = params.return_type || params.returnType || bodyJson.return_type || bodyJson.returnType || toolArgs.return_type || toolArgs.returnType || "base64";
  const rawRetries = params.max_retries ?? params.maxRetries ?? bodyJson.max_retries ?? bodyJson.maxRetries ?? toolArgs.max_retries ?? toolArgs.maxRetries ?? 3;
  const maxRetries: number = Math.min(Math.max(0, typeof rawRetries === "number" ? Math.floor(rawRetries) : 3), 3);

  if (!toolName) {
    return NextResponse.json({
      success: false,
      error: "Invalid request: 'name' or 'tool' is required."
    }, { status: 400 });
  }

  const allowedScopes = agentKey.scopes || ["all-tools"];
  const hasPermission =
    allowedScopes.includes("all-tools") ||
    allowedScopes.includes(toolName) ||
    (allowedScopes.includes("filters;*") && toolName !== "export_image") ||
    (allowedScopes.includes("geometry:*") &&
      ["crop_image", "circle_crop", "flip_image", "rotate_image", "straighten_photo"].includes(toolName));

  if (!hasPermission) {
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      timestamp: new Date().toISOString(),
      method: "jobs/submit",
      toolName,
      fingerprint,
      agentName: agentKey.agentName,
      signatureValid: true,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: agentKey.creditsBalance,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: `Scope permission denied for tool: ${toolName}. Key scopes: [${allowedScopes.join(", ")}]`
    });

    return NextResponse.json({
      success: false,
      error: `Forbidden: Key scopes [${allowedScopes.join(", ")}] do not permit executing tool '${toolName}'.`
    }, { status: 403 });
  }

  const isHighRes = Boolean(
    (toolArgs.image_base64 && toolArgs.image_base64.length > 20 * 1024 * 1024) ||
    (toolArgs.size_bytes && toolArgs.size_bytes > 20 * 1024 * 1024)
  );
  const cost = toolName === "get_image_metadata" ? 0 : isHighRes ? 5 : toolName === "batch_filter_pipeline" ? 3 : 1;


  const jobId = `job_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
  let creditsRemaining = agentKey.creditsBalance;

  // 1. ATOMIC CREDIT RESERVATION UPFRONT: Prevents concurrency overdraw & unbillable compute spam
  if (cost > 0) {
    const deduction = await keyStore.deductCredits(
      fingerprint,
      cost,
      jobId,
      toolName
    );

    if (!deduction.success) {
      await telemetryStore.addLog({
        agentKeyId: agentKey.id,
        timestamp: new Date().toISOString(),
        method: "jobs/submit",
        toolName,
        fingerprint,
        agentName: agentKey.agentName,
        signatureValid: true,
        timestampDriftMs: driftMs,
        nonce,
        costCredits: 0,
        creditsRemaining: deduction.remaining,
        latencyMs: Math.round(performance.now() - startTime),
        status: "rate_limited",
        errorMessage: deduction.error || `Insufficient credits (requires ${cost})`
      });

      return NextResponse.json({
        success: false,
        error: `Insufficient Credits. Required: ${cost}, Available: ${deduction.remaining}. Top up credits in the dashboard.`
      }, { status: 402 });
    }

    creditsRemaining = deduction.remaining;
  }

  // 2. Enqueue Job into Resilient Task Queue with pre-reserved credit status
  let jobRecord;
  try {
    jobRecord = await jobQueue.addJob(
      {
        id: jobId,
        fingerprint: agentKey.fingerprint,
        agentName: agentKey.agentName,
        toolName,
        toolArgs,
        cost,
        costDeducted: cost,
        returnType,
        priority: requestedPriority,
        maxRetries
      },
      {
        priority: requestedPriority,
        maxRetries
      }
    );
  } catch (enqueueErr: any) {
    // If enqueue fails, immediately refund pre-reserved credits!
    if (cost > 0) {
      try {
        await keyStore.refundCredits(
          fingerprint,
          cost,
          `refund-enqueue-${jobId}`,
          `Refund for enqueue failure: ${enqueueErr.message}`
        );
      } catch (refundErr) {
        console.error(`[JobsRoute] Failed to refund ${cost} credits on enqueue failure:`, refundErr);
      }
    }
    throw enqueueErr;
  }

  const latency = Math.round(performance.now() - startTime);
  await telemetryStore.addLog({
    agentKeyId: agentKey.id,
    timestamp: new Date().toISOString(),
    method: "jobs/submit",
    toolName,
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

  const pollUrl = `/api/mcp/jobs/${jobRecord.id}`;
  const streamUrl = `/api/mcp/jobs/${jobRecord.id}/stream`;

  const responseBody: any = {
    success: true,
    job_id: jobRecord.id,
    jobId: jobRecord.id,
    status: "queued",
    estimated_cost: cost,
    cost,
    poll_url: pollUrl,
    stream_url: streamUrl,
    created_at: jobRecord.createdAt.toISOString()
  };

  if (isJsonRpc) {
    responseBody.jsonrpc = "2.0";
    responseBody.id = rpcId;
    responseBody.result = {
      job_id: jobRecord.id,
      jobId: jobRecord.id,
      status: "queued",
      estimated_cost: cost,
      poll_url: pollUrl,
      stream_url: streamUrl
    };
  }

  const response = NextResponse.json(responseBody, { status: 202 });
  response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
  response.headers.set("Location", pollUrl);
  return response;
}
