import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/webhooks/github/route";
import { computeGitHubSignature } from "@/lib/webhooks/hmac";
import { webhookIdempotency } from "@/lib/webhooks/idempotency";
import { webhookDispatcher } from "@/lib/webhooks/dispatcher";
import { resetMockRedis } from "@/lib/redis/client";
import { resetMockDb } from "@/lib/db/prisma";

const TEST_SECRET = "github-webhook-secret-production-test";

beforeEach(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
  resetMockDb();
  resetMockRedis();
  await webhookIdempotency.clear();
  webhookDispatcher.reset();
});

test("route: GET /api/webhooks/github returns healthy discovery envelope", async () => {
  const res = await GET();
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.status, "healthy");
  assert.equal(json.configured, true);
  assert.ok(Array.isArray(json.supportedEvents));
  assert.ok(json.supportedEvents.includes("pull_request"));
  assert.ok(json.supportedEvents.includes("ping"));
});

test("route: POST rejects requests missing X-GitHub-Event header with 400", async () => {
  const req = new NextRequest("http://localhost:3000/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-delivery": "delivery-missing-event",
    },
    body: JSON.stringify({ action: "opened" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("Missing X-GitHub-Event header"));
});

test("route: POST rejects requests missing X-GitHub-Delivery header with 400", async () => {
  const req = new NextRequest("http://localhost:3000/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": "pull_request",
    },
    body: JSON.stringify({ action: "opened" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("Missing X-GitHub-Delivery header"));
});

test("route: POST rejects requests with invalid HMAC signature with 401", async () => {
  const payload = JSON.stringify({ action: "opened" });
  const req = new NextRequest("http://localhost:3000/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-invalid-sig",
      "x-hub-signature-256": "sha256=" + "a".repeat(64),
    },
    body: payload,
  });

  const res = await POST(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("HMAC-SHA256 verification failed"));
});

test("route: POST successfully responds to ping event with 200 and PONG", async () => {
  const payload = JSON.stringify({
    zen: "Mind your words, they become actions.",
    hook_id: 12345678,
  });
  const sig = computeGitHubSignature(payload, TEST_SECRET);

  const req = new NextRequest("http://localhost:3000/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": "ping",
      "x-github-delivery": "delivery-ping-01",
      "x-hub-signature-256": sig,
    },
    body: payload,
  });

  const res = await POST(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.received, true);
  assert.equal(json.event, "ping");
  assert.equal(json.deliveryId, "delivery-ping-01");
  assert.ok(json.message.includes("PONG"));
});

test("route: POST processes pull_request event and routes to dispatcher", async () => {
  let eventDispatched = false;
  let receivedPRNumber = 0;

  webhookDispatcher.on("pull_request", async (data) => {
    eventDispatched = true;
    receivedPRNumber = data.pull_request?.number;
  });

  const payload = JSON.stringify({
    action: "opened",
    pull_request: {
      number: 10,
      title: "feat: add webhook integration",
    },
    repository: {
      full_name: "RohitWaghire/PixelMesh",
    },
    sender: {
      login: "developer",
    },
  });
  const sig = computeGitHubSignature(payload, TEST_SECRET);

  const req = new NextRequest("http://localhost:3000/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-pr-10",
      "x-hub-signature-256": sig,
    },
    body: payload,
  });

  const res = await POST(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.received, true);
  assert.equal(json.event, "pull_request");
  assert.equal(json.status, "processed");
  assert.equal(eventDispatched, true);
  assert.equal(receivedPRNumber, 10);
});

test("route: POST rejects duplicate delivery gracefully without re-dispatching", async () => {
  let callCount = 0;
  webhookDispatcher.on("push", async () => {
    callCount++;
  });

  const payload = JSON.stringify({ ref: "refs/heads/dev" });
  const sig = computeGitHubSignature(payload, TEST_SECRET);

  const createReq = () =>
    new NextRequest("http://localhost:3000/api/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery-push-dedup",
        "x-hub-signature-256": sig,
      },
      body: payload,
    });

  // First delivery
  const res1 = await POST(createReq());
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.status, "processed");
  assert.equal(callCount, 1);

  // Duplicate delivery
  const res2 = await POST(createReq());
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.status, "duplicate");
  assert.equal(callCount, 1, "Handler must NOT be executed a second time for duplicate delivery");
});
