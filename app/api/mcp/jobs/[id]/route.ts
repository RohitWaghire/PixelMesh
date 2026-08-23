import { NextRequest, NextResponse } from "next/server";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { jobQueue } from "@/lib/queue/job-queue";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ success: false, error: "Missing job ID" }, { status: 400 });
  }

  const fingerprint = req.headers.get("x-agent-key-fingerprint");
  const timestampStr = req.headers.get("x-agent-timestamp");
  const nonce = req.headers.get("x-agent-nonce");
  const signature = req.headers.get("x-agent-signature");

  if (!fingerprint || !timestampStr || !nonce || !signature) {
    return NextResponse.json({
      success: false,
      error: "Unauthorized: Missing required SSH cryptographic headers."
    }, { status: 401 });
  }

  const timestampNum = parseInt(timestampStr, 10);
  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum);
  if (!nonceCheck.valid) {
    return NextResponse.json({
      success: false,
      error: `Unauthorized: ${nonceCheck.reason}`
    }, { status: nonceCheck.statusCode || 401 });
  }

  const agentKey = await keyStore.findKeyByFingerprint(fingerprint);
  if (!agentKey || agentKey.status === "revoked") {
    return NextResponse.json({
      success: false,
      error: "Unauthorized: Agent key not found or revoked."
    }, { status: 401 });
  }

  const isValidSig = verifyRequestSignature({
    publicKeyPem: agentKey.publicKeyPem,
    signature,
    method: "GET",
    path: `/api/mcp/jobs/${id}`,
    timestamp: timestampStr,
    nonce,
    body: ""
  });

  if (!isValidSig) {
    return NextResponse.json({
      success: false,
      error: "Unauthorized: Cryptographic signature verification failed."
    }, { status: 401 });
  }

  const job = await jobQueue.getJob(id);
  if (!job) {
    return NextResponse.json({
      success: false,
      error: `Job with ID '${id}' not found.`
    }, { status: 404 });
  }

  const isOwner = job.fingerprint === fingerprint;
  const isAdmin = agentKey.scopes?.includes("admin");

  if (!isOwner && !isAdmin) {
    return NextResponse.json({
      success: false,
      error: "Forbidden: You do not have permission to access this job."
    }, { status: 403 });
  }

  const response = NextResponse.json({
    success: true,
    job_id: job.id,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    cost: job.cost,
    cost_deducted: job.costDeducted,
    costDeducted: job.costDeducted,
    balance_after: job.balanceAfter,
    balanceAfter: job.balanceAfter,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt ? job.startedAt.toISOString() : null,
    completed_at: job.completedAt ? job.completedAt.toISOString() : null,
    failed_at: job.failedAt ? job.failedAt.toISOString() : null,
    attempts_made: job.attemptsMade,
    attemptsMade: job.attemptsMade
  });

  return response;
}
