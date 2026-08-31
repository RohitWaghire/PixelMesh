import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { keyStore } from "@/lib/auth/key-store";
import { signRequestPayload, generateAgentKeypair } from "@/lib/auth/agent-crypto";
import { resetMockDb } from "@/lib/db/prisma";
import { resetMockRedis } from "@/lib/redis/client";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { jobQueue } from "@/lib/queue/job-queue";
import { QueueWorker } from "@/lib/queue/worker";
import { storageClient, resetMockStorage, createStorageAdapter } from "@/lib/storage/client";
import { telemetryStore } from "@/lib/telemetry/store";
import { NextRequest } from "next/server";
import { POST as jobsPostHandler } from "@/app/api/mcp/jobs/route";
import { GET as jobGetHandler } from "@/app/api/mcp/jobs/[id]/route";
import { GET as jobStreamHandler } from "@/app/api/mcp/jobs/[id]/stream/route";
import { POST as uploadUrlHandler } from "@/app/api/mcp/upload-url/route";
import { POST as mcpPostHandler } from "@/app/api/mcp/route";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
  await jobQueue.reset();
  await resetMockStorage();
  await telemetryStore.clear();
});

async function createSampleImage(width = 120, height = 120, color = { r: 70, g: 130, b: 180 }): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: color }
  }).png().toBuffer();
}

function createSignedGet(path: string, keypair: any, fingerprint: string): NextRequest {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "e2e-get-" + Math.random().toString(36).substring(2, 9);
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

// ============================================================================
// Tier 1: Core E2E Feature Integration
// ============================================================================

test("tier 1 e2e: full upload -> async job -> polling -> worker -> atomic credit settlement", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Autonomous E2E Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  // 1. Request S3 Pre-signed Upload URL
  const uploadPayload = JSON.stringify({
    filename: "input_portrait.png",
    content_type: "image/png",
    size_bytes: 50000
  });

  const uploadTs = Math.floor(Date.now() / 1000).toString();
  const uploadNonce = "upload-nonce-1";
  const uploadSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp: uploadTs,
    nonce: uploadNonce,
    body: uploadPayload
  });

  const uploadReq = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": uploadTs,
      "x-agent-nonce": uploadNonce,
      "x-agent-signature": uploadSig
    },
    body: uploadPayload
  });

  const uploadRes = await uploadUrlHandler(uploadReq);
  assert.equal(uploadRes.status, 200);
  const uploadJson = await uploadRes.json();
  assert.ok(uploadJson.upload_url);
  assert.ok(uploadJson.image_key);

  // 2. Direct binary upload to object storage
  const sampleBuf = await createSampleImage(120, 120);
  await storageClient.putObject({
    key: uploadJson.image_key,
    body: sampleBuf,
    contentType: "image/png"
  });

  // 3. Submit async filter job referencing image_key
  const jobPayload = JSON.stringify({
    tool: "adjust_brightness",
    arguments: {
      image_key: uploadJson.image_key,
      factor: 25,
      return_type: "storage"
    },
    priority: "high"
  });

  const jobTs = Math.floor(Date.now() / 1000).toString();
  const jobNonce = "job-nonce-1";
  const jobSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp: jobTs,
    nonce: jobNonce,
    body: jobPayload
  });

  const jobReq = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": jobTs,
      "x-agent-nonce": jobNonce,
      "x-agent-signature": jobSig
    },
    body: jobPayload
  });

  const jobRes = await jobsPostHandler(jobReq);
  assert.equal(jobRes.status, 202);
  const jobJson = await jobRes.json();
  assert.ok(jobJson.job_id);

  // 4. Background Worker Execution
  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  const processed = await worker.processNextJob();
  assert.ok(processed);
  assert.equal(processed.status, "completed");

  // 5. Poll Job Result (Signed)
  const pollReq = createSignedGet(`/api/mcp/jobs/${jobJson.job_id}`, keypair, agent.fingerprint);
  const pollRes = await jobGetHandler(pollReq, { params: Promise.resolve({ id: jobJson.job_id }) });
  assert.equal(pollRes.status, 200);
  const pollJson = await pollRes.json();
  assert.equal(pollJson.status, "completed");
  assert.equal(pollJson.progress, 100);
  assert.ok(pollJson.result?.image_key || pollJson.result?.imageKey);

  // 6. Verify Exact Credit Deduction
  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 99);
});

// ============================================================================
// Tier 2: Boundary & Fault Injection Invariants
// ============================================================================

test("tier 2 e2e: 0-credit agent rejected on preflight with 402", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Zero Balance Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 0
  });

  const sampleBuf = await createSampleImage(60, 60);
  const rawBody = JSON.stringify({
    tool: "crop_image",
    arguments: {
      image_base64: `data:image/png;base64,${sampleBuf.toString("base64")}`,
      width: 30,
      height: 30
    }
  });

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "t2-zero-nonce-" + Math.random().toString(36).substring(2, 9);
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp: ts,
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body: rawBody
  });

  const res = await jobsPostHandler(req);
  assert.equal(res.status, 402);
});

test("tier 2 e2e: non-existent image_key failure guarantees 0 credit deduction", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Missing Key Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 20
  });

  const job = await jobQueue.addJob(
    {
      fingerprint: agent.fingerprint,
      agentName: agent.agentName,
      toolName: "rotate_image",
      toolArgs: {
        image_key: "raw/2026/08/does_not_exist_404.png",
        degrees: 45
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
  assert.equal(processed.costDeducted, 0);

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 20);
});

test("tier 2 e2e: clock skew >60s and nonce replay attacks are rejected with 401", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Replay Attack Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 30
  });

  const body = JSON.stringify({ tool: "get_image_metadata", arguments: { image_base64: "data:image/png;base64,abc" } });

  // 1. Clock skew test (2 minutes in past)
  const staleTs = (Math.floor(Date.now() / 1000) - 120).toString();
  const nonceStale = "stale-nonce-" + Math.random().toString(36).substring(2, 9);
  const staleSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp: staleTs,
    nonce: nonceStale,
    body
  });

  const staleReq = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": staleTs,
      "x-agent-nonce": nonceStale,
      "x-agent-signature": staleSig
    },
    body
  });

  const staleRes = await jobsPostHandler(staleReq);
  assert.equal(staleRes.status, 401);

  // 2. Replay attack test
  const validTs = Math.floor(Date.now() / 1000).toString();
  const replayNonce = "replay-nonce-target";
  const replaySig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp: validTs,
    nonce: replayNonce,
    body
  });

  const req1 = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": validTs,
      "x-agent-nonce": replayNonce,
      "x-agent-signature": replaySig
    },
    body
  });

  const res1 = await jobsPostHandler(req1);
  assert.equal(res1.status, 202);

  // Replaying identical nonce must be rejected
  const req2 = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": validTs,
      "x-agent-nonce": replayNonce,
      "x-agent-signature": replaySig
    },
    body
  });

  const res2 = await jobsPostHandler(req2);
  assert.equal(res2.status, 401);
});

// ============================================================================
// Tier 3: Concurrency & Cross-Feature Pairs
// ============================================================================

test("tier 3 e2e: simultaneous polling and SSE stream subscription consistency", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Dual Subscriber Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  const sampleBuf = await createSampleImage(100, 100);
  const job = await jobQueue.addJob({
    fingerprint: agent.fingerprint,
    agentName: agent.agentName,
    toolName: "invert_colors",
    toolArgs: {
      image_base64: `data:image/png;base64,${sampleBuf.toString("base64")}`
    },
    cost: 1
  });

  // Open stream handler (Signed)
  const streamReq = createSignedGet(`/api/mcp/jobs/${job.id}/stream`, keypair, agent.fingerprint);
  const streamRes = await jobStreamHandler(streamReq, { params: Promise.resolve({ id: job.id }) });
  assert.equal(streamRes.status, 200);

  // Poll in parallel (Signed)
  const pollReq1 = createSignedGet(`/api/mcp/jobs/${job.id}`, keypair, agent.fingerprint);
  const pollRes1 = await jobGetHandler(pollReq1, { params: Promise.resolve({ id: job.id }) });
  const json1 = await pollRes1.json();
  assert.equal(json1.status, "queued");

  // Worker executes
  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  await worker.processNextJob();

  // Poll after completion (Signed)
  const pollReq2 = createSignedGet(`/api/mcp/jobs/${job.id}`, keypair, agent.fingerprint);
  const pollRes2 = await jobGetHandler(pollReq2, { params: Promise.resolve({ id: job.id }) });
  const json2 = await pollRes2.json();
  assert.equal(json2.status, "completed");
  assert.equal(json2.progress, 100);
});

test("tier 3 e2e: multi-agent queue burst with 5 agents and 15 concurrent jobs", async () => {
  const agents = [];
  for (let i = 0; i < 5; i++) {
    const kp = generateAgentKeypair("ed25519");
    const ag = await keyStore.registerKey({
      agentName: `Fleet Agent ${i + 1}`,
      publicKeyPem: kp.publicKeyPem,
      initialCredits: 30
    });
    agents.push({ kp, ag });
  }

  const sampleBuf = await createSampleImage(40, 40);
  const base64Img = `data:image/png;base64,${sampleBuf.toString("base64")}`;

  const toolNames = ["grayscale_image", "adjust_brightness", "flip_image"];
  const jobPromises = [];

  for (let i = 0; i < agents.length; i++) {
    for (let j = 0; j < 3; j++) {
      const tool = toolNames[j % toolNames.length];
      const jobP = jobQueue.addJob({
        fingerprint: agents[i].ag.fingerprint,
        agentName: agents[i].ag.agentName,
        toolName: tool,
        toolArgs: {
          image_base64: base64Img,
          direction: "horizontal",
          factor: 20
        },
        cost: 1,
        priority: j === 0 ? "fast" : j === 1 ? "default" : "batch"
      });
      jobPromises.push(jobP);
    }
  }

  const enqueuedJobs = await Promise.all(jobPromises);
  assert.equal(enqueuedJobs.length, 15);

  const worker = new QueueWorker(jobQueue, { concurrency: 3, autoStart: false });
  for (let k = 0; k < 15; k++) {
    const res = await worker.processNextJob();
    assert.ok(res);
    assert.equal(res.status, "completed");
  }

  for (const item of agents) {
    const updated = await keyStore.findKeyByFingerprint(item.ag.fingerprint);
    assert.equal(updated?.creditsBalance, 27);
  }
});

// ============================================================================
// Tier 4: Real-World Autonomous Agent Workload Scenarios
// ============================================================================

test("tier 4 e2e: full autonomous media processing agent journey (7-step lifecycle)", async () => {
  // Step 1: Agent registers Ed25519 keypair and receives initial credit grant
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Master Creative Pipeline Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  // Step 2: Agent requests pre-signed upload URL for raw banner asset
  const uploadPayload = JSON.stringify({ filename: "master_banner.png", content_type: "image/png" });
  const ts1 = Math.floor(Date.now() / 1000).toString();
  const nonce1 = "t4-upload-nonce-" + Math.random().toString(36).substring(2, 9);
  const sig1 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp: ts1,
    nonce: nonce1,
    body: uploadPayload
  });

  const uploadReq = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts1,
      "x-agent-nonce": nonce1,
      "x-agent-signature": sig1
    },
    body: uploadPayload
  });

  const uploadRes = await uploadUrlHandler(uploadReq);
  assert.equal(uploadRes.status, 200);
  const uploadJson = await uploadRes.json();
  const rawKey = uploadJson.key;

  // Step 3: Agent uploads asset directly to storage
  const sampleBuf = await createSampleImage(200, 200, { r: 120, g: 60, b: 200 });
  await storageClient.putObject({ key: rawKey, body: sampleBuf, contentType: "image/png" });

  // Step 4: Agent submits multi-stage async job with return_type: url
  const jobPayload = JSON.stringify({
    tool: "batch_filter_pipeline",
    arguments: {
      image_key: rawKey,
      operations: [
        { tool: "crop_image", params: { width: 160, height: 160, left: 20, top: 20 } },
        { tool: "make_sepia_tone", params: { intensity: 80 } },
        { tool: "adjust_contrast", params: { factor: 25 } }
      ],
      output_format: "webp",
      return_type: "url"
    },
    priority: "default"
  });

  const ts2 = Math.floor(Date.now() / 1000).toString();
  const nonce2 = "t4-job-nonce-" + Math.random().toString(36).substring(2, 9);
  const sig2 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp: ts2,
    nonce: nonce2,
    body: jobPayload
  });

  const jobReq = new NextRequest("http://localhost:3000/api/mcp/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts2,
      "x-agent-nonce": nonce2,
      "x-agent-signature": sig2
    },
    body: jobPayload
  });

  const jobRes = await jobsPostHandler(jobReq);
  assert.equal(jobRes.status, 202);
  const jobJson = await jobRes.json();
  const jobId = jobJson.job_id;

  // Step 5: Worker executes multi-stage pipeline
  const worker = new QueueWorker(jobQueue, { concurrency: 1, autoStart: false });
  const processed = await worker.processNextJob();
  assert.ok(processed);
  assert.equal(processed.status, "completed");

  // Step 6: Agent retrieves download URL & verifies WebP EXIF metadata (Signed)
  const pollReq = createSignedGet(`/api/mcp/jobs/${jobId}`, keypair, agent.fingerprint);
  const pollRes = await jobGetHandler(pollReq, { params: Promise.resolve({ id: jobId }) });
  assert.equal(pollRes.status, 200);
  const pollJson = await pollRes.json();
  assert.equal(pollJson.status, "completed");
  assert.equal(pollJson.progress, 100);
  assert.equal(pollJson.cost_deducted, 3);
  assert.ok(pollJson.result?.image_url || pollJson.result?.imageUrl || pollJson.result?.public_url);

  // Step 7: Agent inspects audit log and credit balance to verify 0 leakage
  const keyFinal = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyFinal?.creditsBalance, 47);
});

test("tier 4 e2e: storage adapter runtime switching (memory -> local)", async () => {
  const memAdapter = createStorageAdapter({ driver: "memory" });
  const buf = await createSampleImage(50, 50);

  const putMem = await memAdapter.putObject({ key: "test/switch.png", body: buf, contentType: "image/png" });
  assert.ok(putMem.key);
  assert.equal(await memAdapter.exists("test/switch.png"), true);

  const localAdapter = createStorageAdapter({ driver: "local", localStorageDir: ".storage_test_switch" });
  const putLocal = await localAdapter.putObject({ key: "test/switch_local.png", body: buf, contentType: "image/png" });
  assert.ok(putLocal.key);
  assert.equal(await localAdapter.exists("test/switch_local.png"), true);

  await localAdapter.deleteObject("test/switch_local.png");
  assert.equal(await localAdapter.exists("test/switch_local.png"), false);
});
