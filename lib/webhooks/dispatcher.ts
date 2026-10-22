/**
 * PixelMesh Webhook Dispatcher & Event Router
 * 
 * Routes verified inbound webhook payloads to registered event handlers,
 * captures delivery latency metrics, and logs execution to the audit store.
 * 
 * @module lib/webhooks/dispatcher
 */

import { telemetryStore } from "@/lib/telemetry/store";
import {
  GitHubEventName,
  WebhookDeliveryRecord,
  WebhookHandlerResponse,
} from "./types";

export type WebhookEventHandler<T = any> = (
  payload: T,
  deliveryId: string,
  event: GitHubEventName
) => Promise<void | Record<string, unknown>>;

export class WebhookDispatcher {
  private handlers: Map<string, WebhookEventHandler[]> = new Map();
  private recentDeliveries: WebhookDeliveryRecord[] = [];
  private readonly maxRecentHistory = 100;

  /**
   * Registers a callback listener for a specific GitHub event name or wildcard ('*').
   */
  public on(event: GitHubEventName | "*", handler: WebhookEventHandler): () => void {
    const existing = this.handlers.get(event) || [];
    existing.push(handler);
    this.handlers.set(event, existing);

    // Return unregister callback
    return () => {
      const current = this.handlers.get(event) || [];
      this.handlers.set(event, current.filter((h) => h !== handler));
    };
  }

  /**
   * Dispatches an inbound event payload to all matching registered handlers.
   */
  public async dispatch(
    event: GitHubEventName,
    deliveryId: string,
    payload: any
  ): Promise<WebhookHandlerResponse> {
    const startTime = performance.now();
    const action = payload?.action;
    const repo = payload?.repository?.full_name || payload?.repository?.name;
    const sender = payload?.sender?.login;

    const matchedHandlers = [
      ...(this.handlers.get(event) || []),
      ...(this.handlers.get("*") || []),
    ];

    let status: "processed" | "ignored" = "processed";
    let message: string | undefined;

    try {
      if (matchedHandlers.length === 0) {
        status = "ignored";
        message = `No active handlers registered for '${event}'`;
      } else {
        await Promise.all(matchedHandlers.map((h) => h(payload, deliveryId, event)));
        message = `Successfully processed by ${matchedHandlers.length} handler(s)`;
      }

      const durationMs = Math.round(performance.now() - startTime);

      // Record delivery telemetry
      const record: WebhookDeliveryRecord = {
        deliveryId,
        eventName: event,
        timestamp: new Date().toISOString(),
        status,
        action,
        repo,
        sender,
        durationMs,
        metadata: {
          hookId: payload?.hook_id,
          zen: payload?.zen,
          prNumber: payload?.pull_request?.number || payload?.issue?.number,
        },
      };

      this.addRecentDelivery(record);

      // Async audit log
      telemetryStore.addLog({
        fingerprint: `github:${sender || "app"}`,
        agentName: `GitHub Webhook [${event}]`,
        method: "WEBHOOK",
        toolName: event,
        status: "success",
        latencyMs: durationMs,
        costCredits: 0,
        creditsRemaining: 0,
        timestampDriftMs: 0,
        nonce: deliveryId,
        signatureValid: true,
      }).catch(() => {});

      return {
        received: true,
        event,
        deliveryId,
        action,
        status,
        message,
        processingTimeMs: durationMs,
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);

      const record: WebhookDeliveryRecord = {
        deliveryId,
        eventName: event,
        timestamp: new Date().toISOString(),
        status: "rejected",
        action,
        repo,
        sender,
        durationMs,
        error: err.message,
      };

      this.addRecentDelivery(record);

      telemetryStore.addLog({
        fingerprint: `github:${sender || "app"}`,
        agentName: `GitHub Webhook [${event}]`,
        method: "WEBHOOK",
        toolName: event,
        status: "tool_error",
        errorMessage: err.message,
        latencyMs: durationMs,
        costCredits: 0,
        creditsRemaining: 0,
        timestampDriftMs: 0,
        nonce: deliveryId,
        signatureValid: true,
      }).catch(() => {});

      throw err;
    }
  }

  private addRecentDelivery(record: WebhookDeliveryRecord): void {
    this.recentDeliveries.unshift(record);
    if (this.recentDeliveries.length > this.maxRecentHistory) {
      this.recentDeliveries.pop();
    }
  }

  /**
   * Retrieves recent in-memory deliveries for monitoring/diagnostics.
   */
  public getRecentDeliveries(): WebhookDeliveryRecord[] {
    return [...this.recentDeliveries];
  }

  /**
   * Resets registered handlers and delivery records (for test isolation).
   */
  public reset(): void {
    this.handlers.clear();
    this.recentDeliveries = [];
  }
}

export const webhookDispatcher = new WebhookDispatcher();
