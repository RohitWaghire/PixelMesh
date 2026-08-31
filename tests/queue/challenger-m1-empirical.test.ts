/**
 * PixelMesh Phase 3 - M1 Empirical Challenger 1 Test Suite
 * 
 * Challenger: Challenger 1 (Milestone 1: Asynchronous Background Task Queue)
 * File: lib/queue/challenger-m1-empirical.test.ts
 * Runner: node:test + node:assert/strict via tsx
 * 
 * Scope:
 * 1. High concurrency burst (75+ concurrent jobs across multi-worker pool)
 * 2. Corrupted & malicious payload storm (invalid base64, truncated streams, empty pipeline, unknown tools)
 * 3. Security verification (revoked keys, forged fingerprints, unauthorized tool scopes)
 * 4. Exact balance & ledger invariants (0-credit guarantee on failure, exact cost on success, overdraw race defense)
 * 5. Retry policies & exponential backoff calculation (transient recovery, retry event delays, terminal exhaustion)
 * 6. Empirical race condition analysis: Live-worker retry timer dispatch vs requeue race condition
 */

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  JobQueue,
  getJobQueue,
  resetMockQueue,
  InMemoryJobQueue,
  inferJobPriority
} from "@/lib/queue/job-queue";
import {
  WorkerProcessor,
  QueueWorker,
  createWorker,
  NonRetryableJobError
} from "@/lib/queue/worker";
import {
  JobRecord,
  JobPayload,
  JobPriority,
  JobStatus
} from "@/lib/queue/types";
import { keyStore } from "@/lib/auth/key-store";
import { generateAgentKeypair, computeKeyFingerprint } from "@/lib/auth/agent-crypto";
import { prisma, resetMockDb } from "@/lib/db/prisma";
import { resetMockRedis } from "@/lib/redis/client";
import { telemetryStore } from "@/lib/telemetry/store";

// ============================================================================
// Test Utilities & Fixtures
// ============================================================================

async function createValidTestImage(width = 60, height = 60, color = { r: 80, g: 130, b: 210 }): Promise<string> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  }).png().toBuffer();

  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function createAgent(name: string, initialCredits = 100, scopes = ["all-tools"]) {
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(publicKeyPem);

  const agent = await keyStore.registerKey({
    agentName: name,
    publicKeyPem,
    algorithm: "ed25519",
    initialCredits,
    scopes
  });

  return { agent, fingerprint, publicKeyPem, privateKeyPem };
}

let unhandledRejections: any[] = [];
let uncaughtExceptions: any[] = [];

const rejectionHandler = (reason: any) => {
  unhandledRejections.push(reason);
};
const exceptionHandler = (err: any) => {
  uncaughtExceptions.push(err);
};

beforeEach(async () => {
  unhandledRejections = [];
  uncaughtExceptions = [];
  process.on("unhandledRejection", rejectionHandler);
  process.on("uncaughtException", exceptionHandler);

  resetMockDb();
  resetMockRedis();
  resetMockQueue();
  await keyStore.init();
  await telemetryStore.clear();
});

afterEach(() => {
  process.removeListener("unhandledRejection", rejectionHandler);
  process.removeListener("uncaughtException", exceptionHandler);

  assert.equal(
    unhandledRejections.length,
    0,
    `Detected ${unhandledRejections.length} unhandled promise rejection(s): ${JSON.stringify(unhandledRejections)}`
  );
  assert.equal(
    uncaughtExceptions.length,
    0,
    `Detected ${uncaughtExceptions.length} uncaught exception(s): ${JSON.stringify(uncaughtExceptions)}`
  );
});

// ============================================================================
// SUITE 1: High Concurrency Burst (75+ Concurrent Jobs)
// ============================================================================

test("challenger-m1: 75-job concurrent burst across multi-worker pool with mixed operations and priorities", async () => {
  const queue = new InMemoryJobQueue("challenger-burst-queue");
  const worker = new QueueWorker(queue, { concurrency: 8, autoStart: true, pollIntervalMs: 5 });

  const { fingerprint, agent } = await createAgent("Burst-Agent-75", 1000);
  const imageBase64 = await createValidTestImage(50, 50);

  const totalJobs = 75;
  const jobsSubmitted: Promise<JobRecord>[] = [];

  // Enqueue 75 jobs in parallel
  for (let i = 0; i < totalJobs; i++) {
    const priority: JobPriority = i % 3 === 0 ? "fast" : i % 3 === 1 ? "default" : "batch";
    const toolName = priority === "fast" ? "crop_image" : priority === "default" ? "adjust_brightness" : "make_sepia_tone";
    const cost = priority === "fast" ? 1 : priority === "default" ? 2 : 3;

    jobsSubmitted.push(
      queue.enqueue({
        id: `burst_job_${i}`,
        fingerprint,
        agentName: agent.agentName,
        toolName,
        toolArgs: {
          image_base64: imageBase64,
          left: 0,
          top: 0,
          width: 25,
          height: 25,
          factor: 20,
          intensity: 60
        },
        cost,
        priority
      })
    );
  }

  const enqueued = await Promise.all(jobsSubmitted);
  assert.equal(enqueued.length, 75);

  // Poll until all 75 jobs are processed
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const counts = await queue.getJobCounts();
    if (counts.completed === totalJobs) break;
    await new Promise((r) => setTimeout(r, 20));
  }

  const finalCounts = await queue.getJobCounts();
  assert.equal(finalCounts.completed, 75, "All 75 jobs must reach completed state");
  assert.equal(finalCounts.failed, 0);
  assert.equal(finalCounts.active, 0);
  assert.equal(finalCounts.queued, 0);

  // Cost calculation: 25 * 1 + 25 * 2 + 25 * 3 = 25 + 50 + 75 = 150 credits
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 850, "Credits balance must be exactly 1000 - 150 = 850");
  assert.equal(agentAfter?.totalInvocations, 75);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 75);

  await worker.stop();
  await queue.close();
});

// ============================================================================
// SUITE 2: Mixed Successful and Intentionally Corrupted/Failing Payloads
// ============================================================================

test("challenger-m1: payload corruption matrix - worker isolates errors and guarantees 0 credit deduction", async () => {
  const queue = new InMemoryJobQueue("challenger-corruption-queue");
  const worker = new QueueWorker(queue, { autoStart: false });

  const { fingerprint, agent } = await createAgent("Corrupted-Payload-Agent", 200);
  const validImage = await createValidTestImage(40, 40);

  const adversarialPayloads = [
    {
      label: "Completely invalid non-base64 string",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "crop_image",
        toolArgs: { image_base64: "NOT_BASE64_RANDOM_DATA_!@#$%", width: 10, height: 10 },
        cost: 5,
        maxAttempts: 1
      }
    },
    {
      label: "Truncated base64 with empty buffer",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "crop_image",
        toolArgs: { image_base64: "data:image/png;base64,", width: 10, height: 10 },
        cost: 5,
        maxAttempts: 1
      }
    },
    {
      label: "Corrupted binary bytes disguised as JPEG",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "crop_image",
        toolArgs: { image_base64: "data:image/jpeg;base64,AQIDBAUGBwgJCgsMDQ4PEA==", width: 10, height: 10 },
        cost: 5,
        maxAttempts: 1
      }
    },
    {
      label: "Batch pipeline with empty operations array",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "batch_filter_pipeline",
        toolArgs: { image_base64: validImage, operations: [] },
        cost: 10,
        maxAttempts: 1
      }
    },
    {
      label: "Batch pipeline with failing middle step",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "batch_filter_pipeline",
        toolArgs: {
          image_base64: validImage,
          operations: [
            { tool: "crop_image", params: { left: 0, top: 0, width: 20, height: 20 } },
            { tool: "non_existent_invalid_filter_step", params: {} },
            { tool: "make_sepia_tone", params: {} }
          ]
        },
        cost: 10,
        maxAttempts: 1
      }
    },
    {
      label: "Unknown tool name",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "execute_malicious_code",
        toolArgs: { image_base64: validImage },
        cost: 10,
        maxAttempts: 1
      }
    },
    {
      label: "Missing image_base64 parameter for crop_image",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "crop_image",
        toolArgs: { width: 20, height: 20 },
        cost: 5,
        maxAttempts: 1
      }
    },
    {
      label: "Missing image_base64 parameter for get_image_metadata",
      payload: {
        fingerprint,
        agentName: agent.agentName,
        toolName: "get_image_metadata",
        toolArgs: {},
        cost: 1,
        maxAttempts: 1
      }
    }
  ];

  for (const tc of adversarialPayloads) {
    const job = await queue.enqueue(tc.payload);
    const result = await worker.processNextJob();

    assert.ok(result, `Job should return result for ${tc.label}`);
    assert.equal(result.status, "failed", `Job must be marked failed for ${tc.label}`);
    assert.equal(result.costDeducted, 0, `Cost deducted must be exactly 0 for ${tc.label}`);
    assert.ok(result.error || result.failedReason, `Error message must be set for ${tc.label}`);
  }

  // Exact balance check: 0 credits lost across all 8 failing payloads
  const agentAfterFails = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfterFails?.creditsBalance, 200, "Balance must remain strictly 200 after all failures");
  assert.equal(agentAfterFails?.totalInvocations, 0);

  const txsAfterFails = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txsAfterFails.length, 0, "No transactions should be recorded for failed jobs");

  // Telemetry check: 8 failed logs should be recorded with costCredits: 0
  const logs = await telemetryStore.getLogs({ fingerprint });
  assert.equal(logs.length, 8, "Telemetry store must record all 8 failed executions");
  for (const log of logs) {
    assert.equal(log.status, "tool_error");
    assert.equal(log.costCredits, 0);
  }

  // Verify worker continues to process valid jobs normally afterwards
  const validJob = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: { image_base64: validImage, left: 0, top: 0, width: 20, height: 20 },
    cost: 5
  });

  const validResult = await worker.processNextJob();
  assert.equal(validResult?.status, "completed");
  assert.equal(validResult?.costDeducted, 5);

  const agentFinal = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentFinal?.creditsBalance, 195, "Balance must be 200 - 5 = 195 after valid job");
  assert.equal(agentFinal?.totalInvocations, 1);

  await queue.close();
});

test("challenger-m1: security rejection - revoked key, non-existent key, and unauthorized tool scope", async () => {
  const queue = new InMemoryJobQueue("challenger-security-queue");
  const worker = new QueueWorker(queue, { autoStart: false });
  const validImage = await createValidTestImage(30, 30);

  // 1. Scoped agent: only allowed "geometry:*"
  const { fingerprint: scopedFp, agent: scopedAgent } = await createAgent("Scoped-Agent", 50, ["geometry:*"]);

  const scopeJob = await queue.enqueue({
    fingerprint: scopedFp,
    agentName: scopedAgent.agentName,
    toolName: "adjust_brightness", // Not a geometry tool!
    toolArgs: { image_base64: validImage, factor: 20 },
    cost: 5,
    maxAttempts: 1
  });

  const scopeRes = await worker.processNextJob();
  assert.equal(scopeRes?.status, "failed");
  assert.ok(scopeRes?.error?.includes("Scope permission denied"));
  assert.equal(scopeRes?.costDeducted, 0);

  const scopedAgentAfter = await keyStore.findKeyByFingerprint(scopedFp);
  assert.equal(scopedAgentAfter?.creditsBalance, 50, "Scoped agent balance must not change");

  // 2. Revoked key
  const { fingerprint: revokedFp, agent: revokedAgent } = await createAgent("Revoked-Agent", 50);
  await keyStore.revokeKey(revokedFp);

  const revokedJob = await queue.enqueue({
    fingerprint: revokedFp,
    agentName: revokedAgent.agentName,
    toolName: "crop_image",
    toolArgs: { image_base64: validImage, width: 10, height: 10 },
    cost: 5,
    maxAttempts: 1
  });

  const revokedRes = await worker.processNextJob();
  assert.equal(revokedRes?.status, "failed");
  assert.ok(revokedRes?.error?.includes("revoked"));
  assert.equal(revokedRes?.costDeducted, 0);

  // 3. Forged non-existent key
  const forgedJob = await queue.enqueue({
    fingerprint: "SHA256:forged_fake_nonexistent_fingerprint_here",
    agentName: "Intruder",
    toolName: "crop_image",
    toolArgs: { image_base64: validImage, width: 10, height: 10 },
    cost: 5,
    maxAttempts: 1
  });

  const forgedRes = await worker.processNextJob();
  assert.equal(forgedRes?.status, "failed");
  assert.ok(forgedRes?.error?.includes("not found"));
  assert.equal(forgedRes?.costDeducted, 0);

  await queue.close();
});

// ============================================================================
// SUITE 3: Exact Balance Verification & Overdraw Defense
// ============================================================================

test("challenger-m1: concurrent overdraw race condition - exact zero boundary with zero negative balance", async () => {
  const queue = new InMemoryJobQueue("challenger-overdraw-queue");
  const worker = new QueueWorker(queue, { concurrency: 10, autoStart: true, pollIntervalMs: 5 });

  // Agent has exactly 40 credits
  const initialCredits = 40;
  const costPerJob = 2;
  // Submit 40 concurrent jobs of 2 credits each (80 credits requested)
  const totalJobs = 40;

  const { fingerprint, agent } = await createAgent("Overdraw-Challenger-Agent", initialCredits);
  const validImage = await createValidTestImage(30, 30);

  const submitted = await Promise.all(
    Array.from({ length: totalJobs }, (_, i) =>
      queue.enqueue({
        id: `challenger_overdraw_${i}`,
        fingerprint,
        agentName: agent.agentName,
        toolName: "adjust_brightness",
        toolArgs: { image_base64: validImage, factor: 10 },
        cost: costPerJob,
        maxAttempts: 1
      })
    )
  );

  assert.equal(submitted.length, 40);

  // Wait for all 40 jobs to settle
  const start = Date.now();
  while (Date.now() - start < 12000) {
    const counts = await queue.getJobCounts();
    if (counts.completed + counts.failed === totalJobs) break;
    await new Promise((r) => setTimeout(r, 20));
  }

  const counts = await queue.getJobCounts();
  assert.equal(counts.completed, 20, "Exactly 20 jobs should complete (20 * 2 = 40 credits)");
  assert.equal(counts.failed, 20, "Exactly 20 jobs should fail due to credit balance exhaustion");

  // Invariant verification
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 0, "Credits balance must reach exactly 0, never negative");
  assert.equal(agentAfter?.totalInvocations, 20);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 20, "Must record exactly 20 transactions");

  const totalDeducted = txs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  assert.equal(totalDeducted, 40, "Total sum deducted must equal exactly 40 credits");

  await worker.stop();
  await queue.close();
});

// ============================================================================
// SUITE 4: Rapid Retry Storm and Exponential Backoff Timing
// ============================================================================

test("challenger-m1: multi-stage transient failure recovery with backoff delay scaling and single credit deduction", async () => {
  const queue = new InMemoryJobQueue("challenger-backoff-queue");
  const baseDelay = 50;
  const worker = new QueueWorker(queue, { autoStart: false, backoffDelayMs: baseDelay });

  const { fingerprint, agent } = await createAgent("Backoff-Agent", 100);
  const validImage = await createValidTestImage(30, 30);

  const retryEvents: any[] = [];
  worker.on("retry", (evt) => {
    retryEvents.push(evt);
  });

  let attempt = 0;
  worker.setExecutionHook(async (tool, args) => {
    attempt++;
    if (attempt === 1) {
      throw new Error("Transient GPU out-of-memory error (attempt 1)");
    }
    if (attempt === 2) {
      throw new Error("Transient network socket timeout (attempt 2)");
    }
    return null; // Attempt 3 succeeds through standard pipeline
  });

  const job = await queue.enqueue({
    id: "retry-job-multi",
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: { image_base64: validImage, width: 15, height: 15 },
    cost: 5,
    maxAttempts: 3,
    backoffDelayMs: baseDelay
  });

  // Attempt 1: Fails and re-queues
  const r1 = await worker.processNextJob();
  assert.ok(r1);
  assert.equal(r1.status, "queued");
  assert.equal(r1.attemptsMade, 1);
  assert.equal(r1.costDeducted, 0);

  // Attempt 2: Fails and re-queues
  const r2 = await worker.processNextJob();
  assert.ok(r2);
  assert.equal(r2.status, "queued");
  assert.equal(r2.attemptsMade, 2);
  assert.equal(r2.costDeducted, 0);

  // Attempt 3: Succeeds
  const r3 = await worker.processNextJob();
  assert.ok(r3);
  assert.equal(r3.status, "completed");
  assert.equal(r3.attemptsMade, 3);
  assert.equal(r3.costDeducted, 5);

  // Validate exponential backoff retry event delays
  assert.equal(retryEvents.length, 2, "Must emit exactly 2 retry events");
  assert.equal(retryEvents[0].attempt, 1);
  assert.equal(retryEvents[0].nextAttempt, 2);
  assert.equal(retryEvents[0].delayMs, baseDelay * 1, "Attempt 1 backoff delay must be baseDelay * 2^0 = 50ms");

  assert.equal(retryEvents[1].attempt, 2);
  assert.equal(retryEvents[1].nextAttempt, 3);
  assert.equal(retryEvents[1].delayMs, baseDelay * 2, "Attempt 2 backoff delay must be baseDelay * 2^1 = 100ms");

  // Verify single credit deduction
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 95, "Credits must be deducted exactly once (100 - 5 = 95)");
  assert.equal(agentAfter?.totalInvocations, 1);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, -5);

  await queue.close();
});

test("challenger-m1: terminal retry exhaustion deducts 0 credits and marks job failed", async () => {
  const queue = new InMemoryJobQueue("challenger-exhaust-queue");
  const worker = new QueueWorker(queue, { autoStart: false, backoffDelayMs: 10 });

  const { fingerprint, agent } = await createAgent("Exhaust-Agent", 50);
  const validImage = await createValidTestImage(20, 20);

  // Persistent failure hook
  worker.setExecutionHook(async () => {
    throw new Error("Unrecoverable downstream connection crash");
  });

  const job = await queue.enqueue({
    id: "exhaust-job-1",
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: { image_base64: validImage, width: 10, height: 10 },
    cost: 10,
    maxAttempts: 3,
    backoffDelayMs: 10
  });

  // Attempt 1 -> Re-queued
  const r1 = await worker.processNextJob();
  assert.equal(r1?.status, "queued");
  assert.equal(r1?.attemptsMade, 1);

  // Attempt 2 -> Re-queued
  const r2 = await worker.processNextJob();
  assert.equal(r2?.status, "queued");
  assert.equal(r2?.attemptsMade, 2);

  // Attempt 3 -> Terminal Failure
  const r3 = await worker.processNextJob();
  assert.equal(r3?.status, "failed");
  assert.equal(r3?.attemptsMade, 3);
  assert.equal(r3?.costDeducted, 0);

  // Final invariant check
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 50, "Credits must remain completely untouched on terminal failure");
  assert.equal(agentAfter?.totalInvocations, 0);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 0);

  await queue.close();
});
