import test from "node:test";
import assert from "node:assert/strict";
import { computeGitHubSignature, verifyGitHubWebhookSignature } from "@/lib/webhooks/hmac";

test("webhooks: computeGitHubSignature computes standard sha256 hex digest", () => {
  const secret = "test-webhook-secret-123";
  const payload = JSON.stringify({ action: "opened", number: 42 });

  const sig = computeGitHubSignature(payload, secret);
  assert.ok(sig.startsWith("sha256="));
  assert.equal(sig.length, "sha256=".length + 64); // SHA-256 hex is 64 chars
});

test("webhooks: verifyGitHubWebhookSignature verifies authentic payload", () => {
  const secret = "test-webhook-secret-456";
  const payload = JSON.stringify({ action: "synchronize", pull_request: { id: 101 } });
  const sig = computeGitHubSignature(payload, secret);

  const res = verifyGitHubWebhookSignature(payload, sig, secret);
  assert.equal(res.valid, true);
  assert.equal(res.statusCode, undefined);
});

test("webhooks: verifyGitHubWebhookSignature rejects tampered payload", () => {
  const secret = "test-webhook-secret-456";
  const payload = JSON.stringify({ action: "synchronize", pull_request: { id: 101 } });
  const sig = computeGitHubSignature(payload, secret);

  // Tamper with payload
  const tamperedPayload = JSON.stringify({ action: "synchronize", pull_request: { id: 999 } });
  const res = verifyGitHubWebhookSignature(tamperedPayload, sig, secret);

  assert.equal(res.valid, false);
  assert.equal(res.statusCode, 401);
  assert.ok(res.reason?.includes("HMAC-SHA256 verification failed"));
});

test("webhooks: verifyGitHubWebhookSignature rejects missing signature header", () => {
  const res = verifyGitHubWebhookSignature("{}", null, "secret");
  assert.equal(res.valid, false);
  assert.equal(res.statusCode, 401);
  assert.ok(res.reason?.includes("Missing X-Hub-Signature-256 header"));
});

test("webhooks: verifyGitHubWebhookSignature rejects malformed signature header", () => {
  const res = verifyGitHubWebhookSignature("{}", "invalid-format-without-prefix", "secret");
  assert.equal(res.valid, false);
  assert.equal(res.statusCode, 400);
  assert.ok(res.reason?.includes("Malformed signature header"));
});

test("webhooks: verifyGitHubWebhookSignature rejects truncated/mismatched signature lengths safely", () => {
  const res = verifyGitHubWebhookSignature("{}", "sha256=1234abcd", "secret");
  assert.equal(res.valid, false);
  assert.equal(res.statusCode, 401);
  assert.ok(res.reason?.includes("Signature length mismatch"));
});

test("webhooks: verifyGitHubWebhookSignature fails gracefully if no secret configured", () => {
  const origSecret = process.env.GITHUB_WEBHOOK_SECRET;
  delete process.env.GITHUB_WEBHOOK_SECRET;

  try {
    const res = verifyGitHubWebhookSignature("{}", "sha256=abcdef", undefined);
    assert.equal(res.valid, false);
    assert.equal(res.statusCode, 500);
    assert.ok(res.reason?.includes("Server is not configured with GITHUB_WEBHOOK_SECRET"));
  } finally {
    if (origSecret) process.env.GITHUB_WEBHOOK_SECRET = origSecret;
  }
});
