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

  if (fingerprint && timestampStr && nonce && signature) {
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
      path: `/api/mcp/jobs/${id}/stream`,
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
  }

  const job = await jobQueue.getJob(id);
  if (!job) {
    return NextResponse.json({
      success: false,
      error: `Job with ID '${id}' not found.`
    }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: any) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Client stream may be closed
        }
      };

      if (job.status === "completed") {
        sendEvent("progress", {
          jobId: id,
          job_id: id,
          progress: 100,
          status: "completed"
        });
        sendEvent("completed", {
          jobId: id,
          job_id: id,
          status: "completed",
          result: job.result,
          cost_deducted: job.costDeducted,
          costDeducted: job.costDeducted,
          balance_after: job.balanceAfter
        });
        try { controller.close(); } catch {}
        return;
      }

      if (job.status === "failed") {
        sendEvent("error", {
          jobId: id,
          job_id: id,
          status: "failed",
          error: job.error || "Job failed",
          cost_deducted: 0
        });
        try { controller.close(); } catch {}
        return;
      }

      sendEvent("progress", {
        jobId: id,
        job_id: id,
        progress: job.progress || 0,
        status: job.status
      });

      const onProgress = (event: any) => {
        const eventJobId = event?.jobId || event?.id;
        if (eventJobId === id) {
          const progress = typeof event.progress === "number" ? event.progress : event.data?.progress || 0;
          sendEvent("progress", {
            jobId: id,
            job_id: id,
            progress,
            status: "active",
            stage: event.stage
          });
        }
      };

      const onCompleted = (event: any) => {
        const eventJobId = event?.jobId || event?.id;
        if (eventJobId === id) {
          sendEvent("progress", {
            jobId: id,
            job_id: id,
            progress: 100,
            status: "completed"
          });
          sendEvent("completed", {
            jobId: id,
            job_id: id,
            status: "completed",
            result: event.result || job.result,
            cost_deducted: event.costDeducted ?? job.cost,
            costDeducted: event.costDeducted ?? job.cost,
            balance_after: event.balanceAfter
          });
          cleanup();
          try { controller.close(); } catch {}
        }
      };

      const onFailed = (event: any) => {
        const eventJobId = event?.jobId || event?.id;
        if (eventJobId === id) {
          sendEvent("error", {
            jobId: id,
            job_id: id,
            status: "failed",
            error: event.error || "Job failed",
            cost_deducted: 0
          });
          cleanup();
          try { controller.close(); } catch {}
        }
      };

      const cleanup = () => {
        (jobQueue as any).off?.("progress", onProgress);
        (jobQueue as any).off?.("job:progress", onProgress);
        (jobQueue as any).off?.("completed", onCompleted);
        (jobQueue as any).off?.("job:completed", onCompleted);
        (jobQueue as any).off?.("failed", onFailed);
        (jobQueue as any).off?.("job:failed", onFailed);
      };

      (jobQueue as any).on?.("progress", onProgress);
      (jobQueue as any).on?.("job:progress", onProgress);
      (jobQueue as any).on?.("completed", onCompleted);
      (jobQueue as any).on?.("job:completed", onCompleted);
      (jobQueue as any).on?.("failed", onFailed);
      (jobQueue as any).on?.("job:failed", onFailed);

      req.signal?.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    }
  });
}
