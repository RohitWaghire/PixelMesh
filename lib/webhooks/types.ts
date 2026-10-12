/**
 * PixelMesh Webhook & GitHub App Integration Types
 * 
 * Strict type definitions for inbound webhook verification, delivery deduplication,
 * and event routing across GitHub Apps and autonomous agent webhooks.
 * 
 * @module lib/webhooks/types
 */

export type GitHubEventName =
  | "ping"
  | "pull_request"
  | "pull_request_review"
  | "issue_comment"
  | "check_run"
  | "check_suite"
  | "workflow_run"
  | "installation"
  | "push";

export interface GitHubWebhookHeaders {
  signature256?: string | null;
  eventName?: string | null;
  deliveryId?: string | null;
  hookId?: string | null;
  targetType?: string | null;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
  statusCode?: number;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  eventName: string;
  timestamp: string;
  status: "processed" | "duplicate" | "ignored" | "rejected";
  action?: string;
  repo?: string;
  sender?: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface GitHubPingPayload {
  zen: string;
  hook_id: number;
  hook: {
    type: string;
    id: number;
    name: string;
    active: boolean;
    events: string[];
  };
  repository?: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  };
  sender?: {
    login: string;
    id: number;
  };
}

export interface GitHubPullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    id: number;
    number: number;
    title: string;
    state: string;
    draft: boolean;
    user: {
      login: string;
      id: number;
    };
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    html_url: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
  };
  sender: {
    login: string;
    id: number;
  };
  installation?: {
    id: number;
  };
}

export interface GitHubIssueCommentPayload {
  action: string;
  issue: {
    number: number;
    title: string;
    html_url: string;
    pull_request?: {
      url: string;
      html_url: string;
    };
  };
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
      id: number;
    };
    created_at: string;
    html_url: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
  };
  sender: {
    login: string;
  };
}

export interface GitHubCheckRunPayload {
  action: string;
  check_run: {
    id: number;
    name: string;
    head_sha: string;
    status: string;
    conclusion: string | null;
    html_url: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
  };
}

export interface WebhookHandlerResponse {
  received: boolean;
  event: string;
  deliveryId: string;
  action?: string;
  status: "processed" | "duplicate" | "ignored";
  message?: string;
  processingTimeMs: number;
}
