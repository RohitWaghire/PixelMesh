/**
 * PixelMesh Webhook Cryptographic HMAC Verification
 * 
 * Verifies inbound GitHub App webhooks against X-Hub-Signature-256 headers
 * using constant-time buffer comparisons to eliminate timing-attack vulnerabilities.
 * 
 * @module lib/webhooks/hmac
 */

import crypto from "node:crypto";
import { WebhookVerificationResult } from "./types";

/**
 * Computes a standard GitHub X-Hub-Signature-256 string for a raw request payload.
 * 
 * @param payload Raw string or Buffer representation of the HTTP request body
 * @param secret Webhook secret configured on the GitHub App
 * @returns Prefixed hex signature, e.g. "sha256=abcdef1234..."
 */
export function computeGitHubSignature(payload: string | Buffer, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(typeof payload === "string" ? Buffer.from(payload, "utf8") : payload);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verifies that the inbound X-Hub-Signature-256 matches the payload digest in constant time.
 * 
 * @param rawBody Raw body as string or Buffer
 * @param signatureHeader Value of X-Hub-Signature-256 header
 * @param secret Webhook secret string (defaults to GITHUB_WEBHOOK_SECRET environment variable)
 * @returns WebhookVerificationResult indicating validity or error reason
 */
export function verifyGitHubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret?: string
): WebhookVerificationResult {
  const effectiveSecret = secret || process.env.GITHUB_WEBHOOK_SECRET;

  if (!effectiveSecret) {
    return {
      valid: false,
      reason: "Webhook verification failed: Server is not configured with GITHUB_WEBHOOK_SECRET.",
      statusCode: 500,
    };
  }

  if (!signatureHeader) {
    return {
      valid: false,
      reason: "Missing X-Hub-Signature-256 header on inbound webhook request.",
      statusCode: 401,
    };
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return {
      valid: false,
      reason: "Malformed signature header. Expected format: 'sha256=<hex_digest>'.",
      statusCode: 400,
    };
  }

  const expectedSignatureHex = parts[1].trim();
  const calculatedSignature = computeGitHubSignature(rawBody, effectiveSecret);
  const calculatedSignatureHex = calculatedSignature.slice("sha256=".length);

  // Both buffers must be of identical byte length for crypto.timingSafeEqual
  const expectedBuf = Buffer.from(expectedSignatureHex, "hex");
  const calculatedBuf = Buffer.from(calculatedSignatureHex, "hex");

  if (expectedBuf.length !== calculatedBuf.length) {
    return {
      valid: false,
      reason: "Invalid webhook signature: Signature length mismatch.",
      statusCode: 401,
    };
  }

  const matches = crypto.timingSafeEqual(expectedBuf, calculatedBuf);
  if (!matches) {
    return {
      valid: false,
      reason: "Invalid webhook signature: HMAC-SHA256 verification failed.",
      statusCode: 401,
    };
  }

  return { valid: true };
}
