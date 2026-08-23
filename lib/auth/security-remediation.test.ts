import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { keyStore } from "./key-store";
import { generateAgentKeypair, signRequestPayload } from "./agent-crypto";
import { resetMockDb, prisma } from "../db/prisma";
import { resetMockRedis } from "../redis/client";
import { nonceCache } from "./nonce-cache";
import { isPrivateOrBlockedIp, validateSafeRemoteUrl, fetchSafeRemoteImage } from "../image/engine";
import { checkRateLimit, inMemoryRateLimiter } from "./rate-limiter";
import { validateProductionEnvironment } from "../../instrumentation";
import { NextRequest } from "next/server";
import { POST as registerHandler } from "../../app/api/auth/register/route";
import { POST as studioProcessHandler } from "../../app/api/studio/process/route";
import { POST as jobsPostHandler } from "../../app/api/mcp/jobs/route";
import { jobQueue } from "../queue/job-queue";
import { QueueWorker } from "../queue/worker";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  inMemoryRateLimiter.reset();
  await nonceCache.clear();
  await jobQueue.reset();
});

test("sec-remediation: key re-registration strictly preserves credit balance and prevents infinite credits", async () => {
  const keypair = generateAgentKeypair("ed25519");
  
  // 1. Initial registration grants 100 credits
  const initial = await keyStore.registerKey({
    agentName: "Initial Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });
  assert.equal(initial.creditsBalance, 100);

  // 2. Deduct 90 credits (leaving 10 balance)
  const deduction = await keyStore.deductCredits(initial.fingerprint, 90, "tx-spend-1");
  assert.equal(deduction.success, true);
  assert.equal(deduction.remaining, 10);

  // 3. Attempt re-registration via keyStore.registerKey
  const reRegistered = await keyStore.registerKey({
    agentName: "Renamed Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  // Balance must remain 10 credits!
  assert.equal(reRegistered.creditsBalance, 10, "Balance must NOT be reset to 100 on re-registration");
  assert.equal(reRegistered.agentName, "Renamed Agent", "Mutable metadata can be updated");

  // 4. Verify ledger: exactly ONE FREE_GRANT transaction exists
  const grants = await prisma.creditTransaction.findMany({
    where: { agentKeyId: initial.id!, type: "FREE_GRANT" }
  });
  assert.equal(grants.length, 1, "Duplicate FREE_GRANT transactions must NOT be created");

  // 5. Test via HTTP endpoint POST /api/auth/register
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const registerSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "HTTP Re-register", public_key: keypair.publicKeyPem })
  });

  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "HTTP Re-register",
      public_key: keypair.publicKeyPem,
      timestamp,
      signature: registerSig
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 200, "Existing key registration returns 200 OK");
  const json = await res.json();
  assert.equal(json.agent.credits_balance, 10, "HTTP endpoint returns current preserved balance");
  assert.ok(json.message.includes("already registered"));
});

test("sec-remediation: deductCredits idempotency via referenceId prevents double charging", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Idempotent Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  // First deduction with referenceId
  const res1 = await keyStore.deductCredits(agent.fingerprint, 10, "job-idempotent-unique-1");
  assert.equal(res1.success, true);
  assert.equal(res1.remaining, 40);

  // Duplicate retry with same referenceId
  const res2 = await keyStore.deductCredits(agent.fingerprint, 10, "job-idempotent-unique-1");
  assert.equal(res2.success, true);
  assert.equal(res2.remaining, 40, "Duplicate deduction with same referenceId must NOT deduct credits again");

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 40);
});

test("sec-remediation: SSRF IP checker accurately identifies private, link-local, and cloud metadata IPs", () => {
  // Blocked / Private IPs
  assert.equal(isPrivateOrBlockedIp("169.254.169.254"), true, "AWS/GCP metadata IP must be blocked");
  assert.equal(isPrivateOrBlockedIp("169.254.1.1"), true, "Link-local must be blocked");
  assert.equal(isPrivateOrBlockedIp("127.0.0.1"), true, "Loopback must be blocked");
  assert.equal(isPrivateOrBlockedIp("127.100.200.1"), true, "127.0.0.0/8 subnet must be blocked");
  assert.equal(isPrivateOrBlockedIp("10.0.0.1"), true, "10.0.0.0/8 private subnet must be blocked");
  assert.equal(isPrivateOrBlockedIp("172.16.0.1"), true, "172.16.0.0/12 private subnet must be blocked");
  assert.equal(isPrivateOrBlockedIp("172.31.255.255"), true, "172.16.0.0/12 boundary must be blocked");
  assert.equal(isPrivateOrBlockedIp("192.168.1.1"), true, "192.168.0.0/16 private subnet must be blocked");
  assert.equal(isPrivateOrBlockedIp("0.0.0.0"), true, "0.0.0.0 must be blocked");
  assert.equal(isPrivateOrBlockedIp("::1"), true, "IPv6 loopback must be blocked");
  assert.equal(isPrivateOrBlockedIp("fc00::1"), true, "IPv6 unique local must be blocked");
  assert.equal(isPrivateOrBlockedIp("fe80::1"), true, "IPv6 link-local must be blocked");
  assert.equal(isPrivateOrBlockedIp("::ffff:127.0.0.1"), true, "IPv4-mapped loopback must be blocked");

  // Allowed Public IPs
  assert.equal(isPrivateOrBlockedIp("8.8.8.8"), false, "Public Google DNS must be allowed");
  assert.equal(isPrivateOrBlockedIp("1.1.1.1"), false, "Public Cloudflare DNS must be allowed");
  assert.equal(isPrivateOrBlockedIp("151.101.1.140"), false, "Public CDN IP must be allowed");
});

test("sec-remediation: validateSafeRemoteUrl rejects SSRF hostnames and protocols", async () => {
  // Protocol rejection
  await assert.rejects(
    async () => validateSafeRemoteUrl("ftp://example.com/photo.jpg"),
    /Unsupported protocol/
  );
  await assert.rejects(
    async () => validateSafeRemoteUrl("file:///etc/passwd"),
    /Unsupported protocol/
  );

  // Hostname string rejection
  await assert.rejects(
    async () => validateSafeRemoteUrl("http://localhost/image.png"),
    /SSRF Violation/
  );
  await assert.rejects(
    async () => validateSafeRemoteUrl("http://169.254.169.254/latest/meta-data/"),
    /SSRF Violation/
  );
  await assert.rejects(
    async () => validateSafeRemoteUrl("http://service.internal/photo.jpg"),
    /SSRF Violation/
  );
});

test("sec-remediation: rate limiter blocks requests exceeding threshold", async () => {
  const testIp = "192.0.2.45";

  for (let i = 1; i <= 5; i++) {
    const res = await checkRateLimit(testIp, 5, 60);
    assert.equal(res.allowed, true, `Request ${i} should be allowed`);
    assert.equal(res.remaining, 5 - i);
  }

  // 6th request must be blocked
  const blocked = await checkRateLimit(testIp, 5, 60);
  assert.equal(blocked.allowed, false, "Request exceeding limit must be blocked");
  assert.equal(blocked.remaining, 0);
});

test("sec-remediation: POST /api/studio/process rejects payloads exceeding 10MB with 413", async () => {
  // Create an oversized base64 string (>14MB)
  const oversizedBase64 = "A".repeat(15 * 1024 * 1024);

  const req = new NextRequest("http://localhost:3000/api/studio/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: "crop_image",
      image_base64: oversizedBase64
    })
  });

  const res = await studioProcessHandler(req);
  assert.equal(res.status, 413, "Oversized payload must return 413 Payload Too Large");
  const json = await res.json();
  assert.ok(json.error.includes("Payload Too Large"));
});

test("sec-remediation: POST /api/studio/process enforces pipeline operations limit (max 5)", async () => {
  const operations = Array(6).fill({ tool: "grayscale_image", params: {} });

  const req = new NextRequest("http://localhost:3000/api/studio/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations,
      image_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    })
  });

  const res = await studioProcessHandler(req);
  assert.equal(res.status, 400, "Pipeline with >5 operations must be rejected");
  const json = await res.json();
  assert.ok(json.error.includes("Maximum 5 operations"));
});

test("sec-remediation: production environment validation detects missing configurations", () => {
  const origEnv = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_MOCK_IN_PRODUCTION;
    delete process.env.NEXT_PHASE;
    delete process.env.BUILD_PHASE;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.S3_BUCKET;
    delete process.env.LOCAL_STORAGE_DIR;

    const result = validateProductionEnvironment(false);
    assert.equal(result.valid, false);
    assert.ok(result.missing.some((m) => m.includes("DATABASE_URL")));
    assert.ok(result.missing.some((m) => m.includes("Redis")));
    assert.ok(result.missing.some((m) => m.includes("Persistent Storage")));
  } finally {
    process.env = origEnv;
  }
});

test("sec-remediation: concurrent async job submissions reserve credits and strictly prevent unbillable compute", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Tight Budget Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 3 // Only 3 credits available!
  });

  const payloadBody = JSON.stringify({
    tool: "grayscale_image",
    arguments: {
      image_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    }
  });

  // Launch 10 simultaneous async job requests (each costs 1 credit)
  const results = await Promise.all(
    Array.from({ length: 10 }).map(async (_, idx) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = `concurrent-nonce-${idx}-${Math.random().toString(36).substring(2, 9)}`;
      const signature = signRequestPayload({
        privateKeyPem: keypair.privateKeyPem,
        method: "POST",
        path: "/api/mcp/jobs",
        timestamp,
        nonce,
        body: payloadBody
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
        body: payloadBody
      });

      return await jobsPostHandler(req);
    })
  );

  const acceptedCount = results.filter((r) => r.status === 202).length;
  const rejectedCount = results.filter((r) => r.status === 402).length;

  assert.equal(acceptedCount, 3, "Exactly 3 requests must be admitted (matching available credits)");
  assert.equal(rejectedCount, 7, "Remaining 7 requests must be rejected with 402 Insufficient Credits");

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 0, "Credit balance must be exactly 0 after 3 reservations");
});

test("sec-remediation: KeyStore refundCredits restores balance and logs REFUND ledger entry", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Refunder Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 10
  });

  // Deduct 5 credits
  const deductRes = await keyStore.deductCredits(agent.fingerprint, 5, "job-fail-123", "crop_image");
  assert.equal(deductRes.success, true);
  assert.equal(deductRes.remaining, 5);

  // Refund 5 credits on worker failure
  const refunded = await keyStore.refundCredits(agent.fingerprint, 5, "refund-job-fail-123", "Worker crashed");
  assert.equal(refunded.creditsBalance, 10);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id }
  });
  const refundTx = txs.find((t) => t.type === "REFUND");
  assert.ok(refundTx, "Must record a REFUND credit transaction in ledger");
  assert.equal(refundTx.amount, 5);
  assert.equal(refundTx.balanceAfter, 10);
});

test("sec-remediation: fetchSafeRemoteImage socket DNS pinning rejects private IPs", async () => {
  await assert.rejects(
    async () => {
      await fetchSafeRemoteImage("http://169.254.169.254/latest/meta-data/");
    },
    /SSRF Violation/
  );

  await assert.rejects(
    async () => {
      await fetchSafeRemoteImage("http://127.0.0.1:8080/internal-status");
    },
    /SSRF Violation/
  );
});

test("sec-remediation: reserved job executes successfully through QueueWorker when caller balance hits 0 after reservation", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Zero Balance Remaining Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 1 // Exactly 1 credit!
  });

  const payloadBody = JSON.stringify({
    tool: "grayscale_image",
    arguments: {
      image_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = `zero-bal-nonce-${Math.random().toString(36).substring(2, 9)}`;
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp,
    nonce,
    body: payloadBody
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
    body: payloadBody
  });

  // 1. Submit job: 1 credit is reserved, leaving balance === 0
  const submitRes = await jobsPostHandler(req);
  assert.equal(submitRes.status, 202);
  const submitJson = await submitRes.json();
  assert.ok(submitJson.job_id);

  const keyAfterSubmit = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfterSubmit?.creditsBalance, 0, "Balance must be 0 after reservation");

  // 2. Start worker and verify worker processes the job successfully without failing preflight
  const worker = new QueueWorker(jobQueue, { pollIntervalMs: 50, concurrency: 1 });
  worker.start();

  try {
    let completedJob: any = null;
    for (let i = 0; i < 40; i++) {
      const job = await jobQueue.getJob(submitJson.job_id);
      if (job && (job.status === "completed" || job.status === "failed")) {
        completedJob = job;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(completedJob, "Job must complete");
    assert.equal(completedJob.status, "completed", `Job should succeed, but failed with: ${completedJob.error}`);
    assert.equal(completedJob.costDeducted, 1);
  } finally {
    await worker.stop();
  }
});

test("sec-remediation: maxRetries is strictly capped to system limit (3) to prevent unbilled compute", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Malicious Retry Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 10
  });

  const payloadBody = JSON.stringify({
    tool: "grayscale_image",
    arguments: {
      image_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    },
    max_retries: 10000 // Attempting to request 10,000 retries!
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = `max-retry-nonce-${Math.random().toString(36).substring(2, 9)}`;
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/jobs",
    timestamp,
    nonce,
    body: payloadBody
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
    body: payloadBody
  });

  const res = await jobsPostHandler(req);
  assert.equal(res.status, 202);
  const json = await res.json();

  const job = await jobQueue.getJob(json.job_id);
  assert.ok(job);
  assert.equal(job.maxRetries, 3, "maxRetries must be clamped to system maximum (3)");
});

test("sec-remediation: enqueue failure automatically refunds reserved credits without losing user balance", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Queue Crash Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 10
  });

  const payloadBody = JSON.stringify({
    tool: "grayscale_image",
    arguments: {
      image_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    }
  });

  // Mock jobQueue.addJob to simulate a transient queue / Redis failure
  const origAddJob = jobQueue.addJob.bind(jobQueue);
  jobQueue.addJob = async () => {
    throw new Error("Redis cluster connection timeout");
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = `crash-queue-nonce-${Math.random().toString(36).substring(2, 9)}`;
    const signature = signRequestPayload({
      privateKeyPem: keypair.privateKeyPem,
      method: "POST",
      path: "/api/mcp/jobs",
      timestamp,
      nonce,
      body: payloadBody
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
      body: payloadBody
    });

    await assert.rejects(
      async () => {
        await jobsPostHandler(req);
      },
      /Redis cluster connection timeout/
    );

    // Verify Invariant: The 1 credit was auto-refunded, keeping balance at 10
    const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
    assert.equal(keyAfter?.creditsBalance, 10, "Credits must be refunded upon enqueue failure");
  } finally {
    jobQueue.addJob = origAddJob;
  }
});

test("sec-remediation: validateSafeRemoteUrl enforces DNS timeout on non-resolving hosts", async () => {
  await assert.rejects(
    async () => {
      // 1ms timeout to immediately trigger DNS timeout
      await validateSafeRemoteUrl("http://some-very-slow-unresolvable-domain-test.org/image.png", 1);
    },
    /timed out/
  );
});
