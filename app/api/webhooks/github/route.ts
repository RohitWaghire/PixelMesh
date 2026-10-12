import { NextRequest, NextResponse } from "next/server";
import { verifyGitHubWebhookSignature } from "@/lib/webhooks/hmac";
import { webhookIdempotency } from "@/lib/webhooks/idempotency";
import { webhookDispatcher } from "@/lib/webhooks/dispatcher";
import { GitHubEventName } from "@/lib/webhooks/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/webhooks/github
 * Health check & discovery metadata endpoint for GitHub App webhook listeners.
 */
export async function GET() {
  const isConfigured = Boolean(process.env.GITHUB_WEBHOOK_SECRET);
  return NextResponse.json({
    status: "healthy",
    gateway: "PixelMesh GitHub App Webhook Gateway",
    configured: isConfigured,
    supportedEvents: [
      "ping",
      "pull_request",
      "pull_request_review",
      "issue_comment",
      "check_run",
      "check_suite",
      "workflow_run",
      "installation"
    ],
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
}

/**
 * POST /api/webhooks/github
 * Inbound webhook receiver for GitHub App events with HMAC verification and delivery deduplication.
 */
export async function POST(req: NextRequest) {
  const startTime = performance.now();

  try {
    const rawBody = await req.text();

    const signature256 = req.headers.get("x-hub-signature-256");
    const eventName = req.headers.get("x-github-event");
    const deliveryId = req.headers.get("x-github-delivery");
    const hookId = req.headers.get("x-github-hook-id");

    // 1. Mandatory Header Validation
    if (!eventName) {
      return NextResponse.json(
        { error: "Bad Request: Missing X-GitHub-Event header." },
        { status: 400 }
      );
    }

    if (!deliveryId) {
      return NextResponse.json(
        { error: "Bad Request: Missing X-GitHub-Delivery header." },
        { status: 400 }
      );
    }

    // 2. Cryptographic HMAC Signature Verification
    const verification = verifyGitHubWebhookSignature(rawBody, signature256);
    if (!verification.valid) {
      return NextResponse.json(
        {
          error: verification.reason || "Unauthorized: Webhook signature verification failed.",
          deliveryId,
          event: eventName,
        },
        { status: verification.statusCode || 401 }
      );
    }

    // 3. Replay Protection & Delivery Idempotency Check
    const isNewDelivery = await webhookIdempotency.checkAndRecordDelivery(
      deliveryId,
      eventName
    );

    if (!isNewDelivery) {
      return NextResponse.json({
        received: true,
        event: eventName,
        deliveryId,
        status: "duplicate",
        message: "Delivery identifier has already been processed (idempotency guard).",
        processingTimeMs: Math.round(performance.now() - startTime),
      });
    }

    // 4. Safe Payload Deserialization
    let payload: any = {};
    if (rawBody && rawBody.trim().length > 0) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return NextResponse.json(
          { error: "Bad Request: Invalid JSON payload in webhook body." },
          { status: 400 }
        );
      }
    }

    // 5. Special Handler for Initial Ping Event
    if (eventName === "ping") {
      const pingResponse = {
        received: true,
        event: "ping",
        deliveryId,
        hookId: hookId ? parseInt(hookId, 10) : payload?.hook_id,
        zen: payload?.zen || "Keep it logically awesome.",
        message: "PONG - PixelMesh GitHub App Webhook Gateway successfully connected.",
        processingTimeMs: Math.round(performance.now() - startTime),
      };
      return NextResponse.json(pingResponse);
    }

    // 6. Dispatch Inbound Event to Handlers
    const dispatchResult = await webhookDispatcher.dispatch(
      eventName as GitHubEventName,
      deliveryId,
      payload
    );

    return NextResponse.json(dispatchResult);
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Internal Server Error: Failed to process inbound webhook event.",
        detail: err.message,
      },
      { status: 500 }
    );
  }
}
