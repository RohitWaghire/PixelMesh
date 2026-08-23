import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { keyStore } from "../auth/key-store";
import { signRequestPayload, generateAgentKeypair } from "../auth/agent-crypto";
import { resetMockDb } from "../db/prisma";
import { resetMockRedis } from "../redis/client";
import { nonceCache } from "../auth/nonce-cache";
import { jobQueue } from "../queue/job-queue";
import { QueueWorker } from "../queue/worker";
import { storageClient } from "../storage/client";
import { NextRequest } from "next/server";
import { POST as jobsPostHandler } from "../../app/api/mcp/jobs/route";
import { GET as jobGetHandler } from "../../app/api/mcp/jobs/[id]/route";
import { GET as jobStreamHandler } from "../../app/api/mcp/jobs/[id]/stream/route";
import { POST as mcpPostHandler } from "../../app/api/mcp/route";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
  await jobQueue.reset();
});

async function createTestImage(width = 80, height = 80): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } }
  }).png().toBuffer();
  return "data:image/png;base64," + buf.toString("base64");
}

test("m3: POST /api/mcp/jobs successfully submits async job with atomic upfront credit reservation", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Async Submitter Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  const testImage = await createTestImage();
  const rawBody = JSON.stringify({
    tool: "adjust_brightness",
    arguments: {
      image_base64: testImage,
      factor: 30
    },
    priority: "high"
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "async-job-nonce-" + Math.random().toString(36).substring(2, 9);
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp,
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature
    },
    body: rawBody
  });

  const res = await jobsPostHandler(req);
  assert.equal(res.status, 202, "Submission must return 202 Accepted");

  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.job_id, "Must return job_id");
  assert.equal(json.status, "queued");
  assert.equal(json.poll_url, `/api/mcp/jobs/${json.job_id}`);
  assert.equal(json.stream_url, `/api/mcp/jobs/${json.job_id}/stream`);

  // Verify Invariant: Exactly 1 credit reserved atomically upon job submission
  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 49, "1 credit must be reserved upfront at submission");
});

test("m3: POST /api/mcp/jobs preflight rejects insufficient credits with 402", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Broke Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 0
  });

  const testImage = await createTestImage();
  const rawBody = JSON.stringify({
    tool: "grayscale_image",
    arguments: { image_base64: testImage }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "broke-nonce-" + Math.random().toString(36).substring(2, 9);
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp,
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature
    },
    body: rawBody
  });

  const res = await jobsPostHandler(req);
  assert.equal(res.status, 402, "Must return 402 for insufficient credits");
});

test("m3: GET /api/mcp/jobs/:id poll endpoint lifecycle (queued -> completed)", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Polling Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 20
  });

  const testImage = await createTestImage();
  const job = await jobQueue.addJob(
    {
      fingerprint: agent.fingerprint,
      agentName: agent.agentName,
      toolName: "rotate_image",
      toolArgs: {
        image_base64: testImage,
        degrees: 90
      },
      cost: 1,
      priority: "normal"
    }
  );

  function createSignedJobRequest(path: string, keypair: any, fingerprint: string): NextRequest {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "job-req-" + Math.random().toString(36).substring(2, 9);
    const signature = signRequestPayload({
      privateKeyPem: keypair.privateKeyPem,
      method: "GET",
      path,
      timestamp,
      nonce,
      body: ""
    });

    return new NextRequest(`http://localhost:3000${path}`, {
      method: "GET",
      headers: {
        "x-agent-key-fingerprint": fingerprint,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": nonce,
        "x-agent-signature": signature
      }
    });
  }

  // 1. Check queued status via GET (Signed)
  const req1 = createSignedJobRequest(`/api/mcp/jobs/${job.id}`, keypair, agent.fingerprint);
  const res1 = await jobGetHandler(req1, { params: Promise.resolve({ id: job.id }) });
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.status, "queued");
  assert.equal(json1.job_id, job.id);

  // 2. Process job with worker
  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  await worker.processNextJob();

  // 3. Check completed status via GET (Signed)
  const req2 = createSignedJobRequest(`/api/mcp/jobs/${job.id}`, keypair, agent.fingerprint);
  const res2 = await jobGetHandler(req2, { params: Promise.resolve({ id: job.id }) });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.status, "completed");
  assert.equal(json2.progress, 100);
  assert.ok(json2.result?.image_base64, "Result must contain transformed image");
  assert.equal(json2.cost_deducted, 1);
  assert.equal(json2.balance_after, 19);

  // Verify Invariant: Balance correctly deducted after completion
  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 19);
});

test("m3: GET /api/mcp/jobs/:id/stream emits SSE progress and completed events", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "SSE Stream Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 30
  });

  const testImage = await createTestImage();
  const job = await jobQueue.addJob(
    {
      fingerprint: agent.fingerprint,
      agentName: agent.agentName,
      toolName: "grayscale_image",
      toolArgs: {
        image_base64: testImage
      },
      cost: 1
    }
  );

  function createSignedJobStreamRequest(path: string, kp: any, fp: string): NextRequest {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "stream-req-" + Math.random().toString(36).substring(2, 9);
    const signature = signRequestPayload({
      privateKeyPem: kp.privateKeyPem,
      method: "GET",
      path,
      timestamp,
      nonce,
      body: ""
    });

    return new NextRequest(`http://localhost:3000${path}`, {
      method: "GET",
      headers: {
        "x-agent-key-fingerprint": fp,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": nonce,
        "x-agent-signature": signature
      }
    });
  }

  const req = createSignedJobStreamRequest(`/api/mcp/jobs/${job.id}/stream`, keypair, agent.fingerprint);
  const res = await jobStreamHandler(req, { params: Promise.resolve({ id: job.id }) });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  // Process job
  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  await worker.processNextJob();

  // Stream completed job (Signed)
  const reqCompleted = createSignedJobStreamRequest(`/api/mcp/jobs/${job.id}/stream`, keypair, agent.fingerprint);
  const resCompleted = await jobStreamHandler(reqCompleted, { params: Promise.resolve({ id: job.id }) });
  const reader = resCompleted.body?.getReader();
  assert.ok(reader, "Reader must be available");

  let receivedText = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedText += decoder.decode(value);
  }

  assert.ok(receivedText.includes("event: progress"), "Must emit progress event");
  assert.ok(receivedText.includes("event: completed"), "Must emit completed event");
});

test("m3: GET /api/mcp/jobs/:id strictly rejects unauthenticated requests with 401", async () => {
  const req = new NextRequest("http://localhost:3000/api/mcp/jobs/job_test_123", { method: "GET" });
  const res = await jobGetHandler(req, { params: Promise.resolve({ id: "job_test_123" }) });
  assert.equal(res.status, 401, "Unauthenticated poll must be rejected with 401");
});

test("m3: GET /api/mcp/jobs/:id/stream strictly rejects unauthenticated requests with 401", async () => {
  const req = new NextRequest("http://localhost:3000/api/mcp/jobs/job_test_123/stream", { method: "GET" });
  const res = await jobStreamHandler(req, { params: Promise.resolve({ id: "job_test_123" }) });
  assert.equal(res.status, 401, "Unauthenticated stream must be rejected with 401");
});

test("m3: GET /api/mcp/jobs/:id enforces IDOR authorization (403 for unauthorized caller)", async () => {
  // Agent A creates job
  const keypairA = generateAgentKeypair("ed25519");
  const agentA = await keyStore.registerKey({
    agentName: "Agent A",
    publicKeyPem: keypairA.publicKeyPem,
    initialCredits: 20
  });

  const testImage = await createTestImage();
  const job = await jobQueue.addJob({
    fingerprint: agentA.fingerprint,
    agentName: agentA.agentName,
    toolName: "invert_colors",
    toolArgs: { image_base64: testImage },
    cost: 1
  });

  // Agent B attempts to read Agent A's job
  const keypairB = generateAgentKeypair("ed25519");
  const agentB = await keyStore.registerKey({
    agentName: "Agent B (Attacker)",
    publicKeyPem: keypairB.publicKeyPem,
    initialCredits: 20
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "idor-nonce-" + Math.random().toString(36).substring(2, 9);
  const signatureB = signRequestPayload({
    privateKeyPem: keypairB.privateKeyPem,
    method: "GET",
    path: `/api/mcp/jobs/${job.id}`,
    timestamp,
    nonce,
    body: ""
  });

  const reqB = new NextRequest(`http://localhost:3000/api/mcp/jobs/${job.id}`, {
    method: "GET",
    headers: {
      "x-agent-key-fingerprint": agentB.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signatureB
    }
  });

  const resB = await jobGetHandler(reqB, { params: Promise.resolve({ id: job.id }) });
  assert.equal(resB.status, 403, "Cross-agent IDOR attempt must return 403 Forbidden");

  // Admin key is permitted to read Agent A's job
  const devKeyInfo = keyStore.getDevKeypair();
  assert.ok(devKeyInfo);
  const adminKeypair = devKeyInfo.keypair;
  const adminAgent = await keyStore.registerKey({
    agentName: "Admin Inspector",
    publicKeyPem: adminKeypair.publicKeyPem,
    scopes: ["admin", "all-tools"]
  });

  const adminTimestamp = Math.floor(Date.now() / 1000).toString();
  const adminNonce = "admin-nonce-" + Math.random().toString(36).substring(2, 9);
  const adminSig = signRequestPayload({
    privateKeyPem: adminKeypair.privateKeyPem,
    method: "GET",
    path: `/api/mcp/jobs/${job.id}`,
    timestamp: adminTimestamp,
    nonce: adminNonce,
    body: ""
  });

  const adminReq = new NextRequest(`http://localhost:3000/api/mcp/jobs/${job.id}`, {
    method: "GET",
    headers: {
      "x-agent-key-fingerprint": adminAgent.fingerprint,
      "x-agent-timestamp": adminTimestamp,
      "x-agent-nonce": adminNonce,
      "x-agent-signature": adminSig
    }
  });

  const adminRes = await jobGetHandler(adminReq, { params: Promise.resolve({ id: job.id }) });
  assert.equal(adminRes.status, 200, "Admin-scoped key must be allowed to inspect job");
});

test("m3: POST /api/mcp with Prefer: respond-async routes to jobQueue with 202", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Async Gateway Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 40
  });

  const testImage = await createTestImage();
  const rawBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "rpc-async-1",
    method: "tools/call",
    params: {
      name: "invert_colors",
      arguments: { image_base64: testImage }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "async-gw-nonce-" + Math.random().toString(36).substring(2, 9);
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "prefer": "respond-async",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature
    },
    body: rawBody
  });

  const res = await mcpPostHandler(req);
  assert.equal(res.status, 202, "Prefer: respond-async must return 202");

  const json = await res.json();
  assert.equal(json.status, "queued");
  assert.ok(json.job_id);
  assert.equal(json.poll_url, `/api/mcp/jobs/${json.job_id}`);

  // Invariant: Exactly 1 credit reserved upfront at submission
  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 39, "1 credit must be reserved upfront at submission");
});

test("m3: direct storage transport (image_key input and storage return_type)", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Storage Pipeline Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 25
  });

  // 1. Upload test image to storage
  const testBuf = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 100, b: 50 } }
  }).png().toBuffer();

  const uploadRes = await storageClient.putObject({ key: "raw/2026/08/test_asset.png", body: testBuf, contentType: "image/png" });
  assert.ok(uploadRes.key);

  // 2. Submit async job referencing image_key and requesting return_type: 'storage'
  const job = await jobQueue.addJob({
    fingerprint: agent.fingerprint,
    agentName: agent.agentName,
    toolName: "make_sepia_tone",
    toolArgs: {
      image_key: uploadRes.key,
      intensity: 80,
      return_type: "storage"
    },
    returnType: "storage",
    cost: 1
  });

  // 3. Execute job via Worker
  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  const processed = await worker.processNextJob();

  assert.ok(processed);
  assert.equal(processed.status, "completed");
  assert.ok(processed.result?.image_key || processed.result?.imageKey, "Result must contain output storage key");

  // Check stored output object
  const outputKey = processed.result?.image_key || processed.result?.imageKey;
  const storedBuf = await storageClient.getObjectBuffer(outputKey);
  assert.ok(storedBuf, "Processed image must exist in storage");
  assert.ok(storedBuf.length > 0);
});

test("m3: error isolation and 0 credit deduction on failed job", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Error Testing Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 15
  });

  // Add job with corrupted base64 data
  const job = await jobQueue.addJob(
    {
      fingerprint: agent.fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {
      image_base64: "data:image/png;base64,CORRUPTED_GARBAGE_PAYLOAD",
      width: 50,
      height: 50
    },
    cost: 1,
    maxRetries: 1
  },
  { maxRetries: 1 }
);

  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  const processed = await worker.processNextJob();

  assert.ok(processed);
  assert.equal(processed.status, "failed");
  assert.equal(processed.costDeducted, 0, "0 credits must be deducted on failed job");

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 15, "Balance must remain unchanged after failure");
});
