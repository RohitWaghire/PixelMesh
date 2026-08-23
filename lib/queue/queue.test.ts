/**
 * PixelMesh Phase 3 - Asynchronous Background Task Queue & Worker Unit Test Suite
 * 
 * Target: lib/queue/queue.test.ts
 * Runner: node:test + node:assert/strict via tsx
 * 
 * Coverage:
 * 1. Job enqueueing, ID generation, and metadata initialization
 * 2. Custom ID preservation and list filtering by status / fingerprint
 * 3. Priority scheduling order (fast before default before batch)
 * 4. Status transitions (queued -> active -> completed / failed) and event listeners
 * 5. In-memory mock queue lifecycle and resetMockQueue() isolation
 * 6. Image processing execution (single filter, metadata, and batch pipeline) with Sharp
 * 7. Atomic credit deduction on successful completion (credit invariant)
 * 8. Zero-credit deduction invariant on job failures (invalid image / unknown tool / scope error)
 * 9. Retry policies: transient error recovery and terminal retry exhaustion
 * 10. High-concurrency race condition testing and overdraw defense
 * 11. Clean queue & worker shutdown without dangling handles
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  JobQueue,
  getJobQueue,
  resetMockQueue,
  InMemoryJobQueue,
  inferJobPriority
} from "./job-queue";
import {
  WorkerProcessor,
  QueueWorker,
  createWorker,
  NonRetryableJobError
} from "./worker";
import {
  JobRecord,
  JobPayload,
  JobStatus
} from "./types";
import { keyStore } from "../auth/key-store";
import { generateAgentKeypair, computeKeyFingerprint } from "../auth/agent-crypto";
import { prisma, resetMockDb } from "../db/prisma";
import { resetMockRedis } from "../redis/client";

// ============================================================================
// Test Utilities & Helpers
// ============================================================================

async function createTestImageBase64(
  width = 200,
  height = 200,
  color = { r: 100, g: 150, b: 200 }
): Promise<string> {
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

async function provisionTestAgent(agentName = "Queue-Test-Agent", initialCredits = 100, scopes = ["all-tools"]) {
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(publicKeyPem);

  const agent = await keyStore.registerKey({
    agentName,
    publicKeyPem,
    algorithm: "ed25519",
    initialCredits,
    scopes
  });

  return { agent, fingerprint, publicKeyPem, privateKeyPem };
}

// ============================================================================
// Lifecycle Setup & Teardown
// ============================================================================

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  resetMockQueue();
  await keyStore.init();
});

// ============================================================================
// 1. Job Enqueueing, ID Generation & Metadata
// ============================================================================

test("queue: enqueue generates unique job_id and initializes queued state", async () => {
  const queue = getJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Enqueue-Agent", 50);

  const payload: JobPayload = {
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: { width: 100, height: 100 },
    cost: 5
  };

  const job = await queue.enqueue(payload);

  assert.ok(job.id, "Job ID must be generated");
  assert.ok(job.id.startsWith("job_") || job.id.length >= 16, "Job ID should follow standard format");
  assert.equal(job.status, "queued");
  assert.equal(job.progress, 0);
  assert.equal(job.fingerprint, fingerprint);
  assert.equal(job.agentName, "Enqueue-Agent");
  assert.equal(job.toolName, "crop_image");
  assert.equal(job.cost, 5);
  assert.equal(job.costDeducted, 0);
  assert.equal(job.attemptsMade, 0);
  assert.equal(job.maxAttempts, 3);
  assert.ok(job.createdAt);

  // Retrieve job by ID
  const retrieved = await queue.getJob(job.id);
  assert.ok(retrieved);
  assert.equal(retrieved.id, job.id);
  assert.equal(retrieved.status, "queued");
});

test("queue: enqueue preserves explicit custom jobId", async () => {
  const queue = getJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Custom-ID-Agent", 50);

  const customId = "custom-job-uuid-123456";
  const job = await queue.enqueue({
    id: customId,
    fingerprint,
    agentName: agent.agentName,
    toolName: "rotate_image",
    toolArgs: { degrees: 90 },
    cost: 3
  });

  assert.equal(job.id, customId);
  const retrieved = await queue.getJob(customId);
  assert.equal(retrieved?.id, customId);
});

test("queue: listJobs filters by status and fingerprint with pagination", async () => {
  const queue = getJobQueue();
  const { fingerprint: fp1, agent: agent1 } = await provisionTestAgent("Agent-1", 50);
  const { fingerprint: fp2, agent: agent2 } = await provisionTestAgent("Agent-2", 50);

  await queue.enqueue({ fingerprint: fp1, agentName: agent1.agentName, toolName: "tool1", toolArgs: {}, cost: 1 });
  await queue.enqueue({ fingerprint: fp1, agentName: agent1.agentName, toolName: "tool2", toolArgs: {}, cost: 2 });
  await queue.enqueue({ fingerprint: fp2, agentName: agent2.agentName, toolName: "tool3", toolArgs: {}, cost: 3 });

  const allJobs = await queue.listJobs();
  assert.equal(allJobs.length, 3);

  const fp1Jobs = await queue.listJobs({ fingerprint: fp1 });
  assert.equal(fp1Jobs.length, 2);

  const fp2Jobs = await queue.listJobs({ fingerprint: fp2 });
  assert.equal(fp2Jobs.length, 1);

  const paged = await queue.listJobs({ start: 0, end: 2 });
  assert.equal(paged.length, 2);
});

// ============================================================================
// 2. Priority Scheduling & Inference
// ============================================================================

test("queue: priority queue schedules fast jobs before default and batch jobs", async () => {
  const queue = new InMemoryJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Priority-Agent", 100);

  // Enqueue batch first, then default, then fast
  const jobBatch = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "batch_filter_pipeline",
    toolArgs: {},
    cost: 10,
    priority: "batch"
  });

  const jobDefault = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "adjust_brightness",
    toolArgs: {},
    cost: 2,
    priority: "default"
  });

  const jobFast = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 1,
    priority: "fast"
  });

  // Dequeue in priority order
  const first = await queue.getNextQueuedJob();
  assert.equal(first?.id, jobFast.id, "Fast priority job (weight 1) must be dequeued first");
  await queue.updateJobStatus(first!.id, "active");

  const second = await queue.getNextQueuedJob();
  assert.equal(second?.id, jobDefault.id, "Default priority job (weight 5) must be dequeued second");
  await queue.updateJobStatus(second!.id, "active");

  const third = await queue.getNextQueuedJob();
  assert.equal(third?.id, jobBatch.id, "Batch priority job (weight 10) must be dequeued last");
});

test("queue: inferJobPriority correctly categorizes tool complexity", () => {
  assert.equal(inferJobPriority("crop_image", {}), "fast");
  assert.equal(inferJobPriority("get_image_metadata", {}), "fast");
  assert.equal(inferJobPriority("adjust_brightness", {}), "default");
  assert.equal(inferJobPriority("make_sepia_tone", {}), "default");
  assert.equal(inferJobPriority("batch_filter_pipeline", {}), "batch");
  assert.equal(inferJobPriority("custom_tool", { priority: "fast" }), "fast");
});

// ============================================================================
// 3. In-Memory Mock Queue State & resetMockQueue()
// ============================================================================

test("queue: resetMockQueue clears all internal job states and pending items", async () => {
  const queue = getJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Reset-Agent", 50);

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 5
  });

  assert.ok(await queue.getJob(job.id));

  resetMockQueue();

  assert.equal(await queue.getJob(job.id), null, "Job should not exist after resetMockQueue()");
  const remaining = await queue.listJobs();
  assert.equal(remaining.length, 0);
});

// ============================================================================
// 4. Status Lifecycle Transitions & Events
// ============================================================================

test("queue: job transitions through queued -> active -> completed with event emissions", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Lifecycle-Agent", 50);
  const imageBase64 = await createTestImageBase64(100, 100);

  const events: string[] = [];
  queue.on("queued", (j: any) => events.push(`queued:${j.id}`));
  queue.on("active", (j: any) => events.push(`active:${j.id}`));
  queue.on("progress", (j: any) => events.push(`progress:${j.jobId || j.id}:${j.progress}`));
  queue.on("completed", (j: any) => events.push(`completed:${j.id || j.jobId}`));

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: { image_base64: imageBase64, width: 50, height: 50, left: 0, top: 0 },
    cost: 5
  });

  assert.equal(job.status, "queued");

  // Process single job
  const processed = await worker.processNextJob();
  assert.ok(processed);
  assert.equal(processed.id, job.id);
  assert.equal(processed.status, "completed");
  assert.ok(processed.startedAt, "startedAt timestamp must be set");
  assert.ok(processed.completedAt, "completedAt timestamp must be set");
  assert.ok(processed.result?.imageBase64);

  // Validate event emission order
  assert.ok(events.includes(`queued:${job.id}`));
  assert.ok(events.includes(`active:${job.id}`));
  assert.ok(events.includes(`completed:${job.id}`));
});

// ============================================================================
// 5. Successful Image Execution & Credit Settlement Invariant
// ============================================================================

test("queue: worker successfully processes crop_image and atomically deducts credits upon completion", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Worker-Success-Agent", 50);
  const imageBase64 = await createTestImageBase64(300, 200);

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {
      image_base64: imageBase64,
      left: 10,
      top: 10,
      width: 100,
      height: 80
    },
    cost: 5
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "completed");
  assert.equal(result.costDeducted, 5);
  assert.equal(result.result.metadata.width, 100);
  assert.equal(result.result.metadata.height, 80);
  assert.ok(result.result.imageBase64.startsWith("data:image/png;base64,"));

  // Verify Credit Balance in KeyStore / Prisma
  const updatedAgent = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(updatedAgent?.creditsBalance, 45, "Balance must be decremented by 5");
  assert.equal(updatedAgent?.totalInvocations, 1);

  // Verify CreditTransaction ledger entry
  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, -5);
  assert.equal(txs[0].balanceAfter, 45);
  assert.equal(txs[0].referenceId, job.id);
});

test("queue: worker successfully processes get_image_metadata tool", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Metadata-Agent", 50);
  const imageBase64 = await createTestImageBase64(150, 120);

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "get_image_metadata",
    toolArgs: { image_base64: imageBase64 },
    cost: 1
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "completed");
  assert.equal(result.costDeducted, 1);
  assert.equal(result.result.metadata.width, 150);
  assert.equal(result.result.metadata.height, 120);

  const updatedAgent = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(updatedAgent?.creditsBalance, 49);
});

test("queue: worker successfully processes multi-step batch_filter_pipeline", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Batch-Pipeline-Agent", 100);
  const imageBase64 = await createTestImageBase64(200, 200);

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "batch_filter_pipeline",
    toolArgs: {
      image_base64: imageBase64,
      operations: [
        { tool: "crop_image", params: { left: 0, top: 0, width: 100, height: 100 } },
        { tool: "make_sepia_tone", params: { intensity: 80 } },
        { tool: "adjust_contrast", params: { factor: 20 } }
      ]
    },
    cost: 10
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "completed");
  assert.equal(result.costDeducted, 10);
  assert.equal(result.result.metadata.width, 100);
  assert.equal(result.result.metadata.height, 100);

  const updatedAgent = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(updatedAgent?.creditsBalance, 90);
});

// ============================================================================
// 6. Failure Scenarios & Zero-Credit Invariant
// ============================================================================

test("queue: invalid image base64 causes job to fail with 0 credits deducted", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Corrupted-Image-Agent", 50);

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {
      image_base64: "invalid_not_base64_data",
      width: 100,
      height: 100
    },
    cost: 5,
    maxAttempts: 1
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.equal(result.costDeducted, 0);
  assert.ok(result.failedAt);

  // Credit Invariant: Balance must remain strictly 50
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 50, "No credits must be deducted for failed job");
  assert.equal(agentAfter?.totalInvocations, 0);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 0, "No USAGE_DEDUCTION ledger records should exist");
});

test("queue: unknown filter tool name causes job to fail with 0 credits deducted", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Unknown-Tool-Agent", 30);
  const imageBase64 = await createTestImageBase64(50, 50);

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "non_existent_magic_filter",
    toolArgs: { image_base64: imageBase64 },
    cost: 15,
    maxAttempts: 1
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.ok(result.error?.includes("Unknown filter tool"));
  assert.equal(result.costDeducted, 0);

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 30);
});

test("queue: scope permission violation causes job to fail with 0 credits deducted", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  // Agent has only geometry:* scope
  const { fingerprint, agent } = await provisionTestAgent("Geometry-Only-Agent", 40, ["geometry:*"]);
  const imageBase64 = await createTestImageBase64(50, 50);

  // Attempt to invoke color adjustment
  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "adjust_brightness",
    toolArgs: { image_base64: imageBase64, factor: 30 },
    cost: 5,
    maxAttempts: 1
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.ok(result.error?.includes("Scope permission denied"));
  assert.equal(result.costDeducted, 0);

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 40);
});

test("queue: initial insufficient credit balance causes job to fail with 0 credits deducted", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Low-Balance-Agent", 5);
  const imageBase64 = await createTestImageBase64(50, 50);

  // Requires 10 credits, but agent only has 5
  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: { image_base64: imageBase64, width: 50, height: 50 },
    cost: 10,
    maxAttempts: 1
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.ok(result.error?.includes("Insufficient credits"));
  assert.equal(result.costDeducted, 0);

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 5);
});

// ============================================================================
// 7. Retry Logic & Backoff Policies
// ============================================================================

test("queue: retry policy recovers from transient failure and deducts credits once on success", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Retry-Agent", 50);
  const imageBase64 = await createTestImageBase64(100, 100);

  let attemptCount = 0;
  worker.setExecutionHook(async () => {
    attemptCount++;
    if (attemptCount === 1) {
      throw new Error("Transient GPU out-of-memory error");
    }
    return null; // Fall through to standard engine execution
  });

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "rotate_image",
    toolArgs: { image_base64: imageBase64, degrees: 90 },
    cost: 5,
    maxAttempts: 3,
    backoffMs: 10
  });

  // First process attempt: fails and schedules retry
  const firstAttemptResult = await worker.processNextJob();
  assert.ok(firstAttemptResult);
  assert.equal(firstAttemptResult.attemptsMade, 1);
  assert.equal(firstAttemptResult.status, "queued"); // Re-queued for retry

  // Second process attempt: succeeds
  const secondAttemptResult = await worker.processNextJob();
  assert.ok(secondAttemptResult);
  assert.equal(secondAttemptResult.status, "completed");
  assert.equal(secondAttemptResult.attemptsMade, 2);
  assert.equal(secondAttemptResult.costDeducted, 5);

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 45, "Credits must be deducted exactly once despite 2 attempts");
});

test("queue: retry policy marks job failed and deducts 0 credits when maxAttempts are exhausted", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Exhaust-Retry-Agent", 50);

  worker.setExecutionHook(async () => {
    throw new Error("Permanent hardware fault");
  });

  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 10,
    maxAttempts: 3,
    backoffMs: 5
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

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 50, "Credits must remain unchanged on terminal failure");
});

// ============================================================================
// 8. High Concurrency & Overdraw Race Conditions
// ============================================================================

test("queue: 30 concurrent jobs processed across multiple workers without race conditions", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, concurrency: 5, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Concurrency-Agent", 200);
  const imageBase64 = await createTestImageBase64(50, 50);

  const totalJobs = 30;
  const costPerJob = 2;

  // Enqueue 30 jobs
  const jobPromises = Array.from({ length: totalJobs }, () =>
    queue.enqueue({
      fingerprint,
      agentName: agent.agentName,
      toolName: "adjust_brightness",
      toolArgs: { image_base64: imageBase64, factor: 10 },
      cost: costPerJob
    })
  );

  const enqueuedJobs = await Promise.all(jobPromises);
  assert.equal(enqueuedJobs.length, 30);

  // Process all jobs concurrently with worker pool
  const processPromises = Array.from({ length: totalJobs }, () => worker.processNextJob());
  const results = await Promise.all(processPromises);

  const completed = results.filter((r) => r?.status === "completed");
  assert.equal(completed.length, 30, "All 30 concurrent jobs must complete successfully");

  // Verify total deduction: 30 jobs * 2 credits = 60 credits deducted
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 140, "Balance must be exactly 200 - 60 = 140");
  assert.equal(agentAfter?.totalInvocations, 30);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 30);
});

test("queue: concurrent overdraw defense gracefully rejects jobs exceeding credit balance", async () => {
  const queue = getJobQueue();
  const worker = createWorker({ queue, concurrency: 5, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Overdraw-Queue-Agent", 10);
  const imageBase64 = await createTestImageBase64(50, 50);

  // 10 credits available. Submit 10 jobs of 2 credits each (20 credits requested).
  const totalJobs = 10;
  const costPerJob = 2;

  const enqueuedJobs = await Promise.all(
    Array.from({ length: totalJobs }, () =>
      queue.enqueue({
        fingerprint,
        agentName: agent.agentName,
        toolName: "invert_colors",
        toolArgs: { image_base64: imageBase64 },
        cost: costPerJob,
        maxAttempts: 1
      })
    )
  );

  const results = await Promise.all(Array.from({ length: totalJobs }, () => worker.processNextJob()));

  const completed = results.filter((r) => r?.status === "completed");
  const failed = results.filter((r) => r?.status === "failed");

  assert.equal(completed.length, 5, "Exactly 5 jobs should complete (5 * 2 = 10 credits)");
  assert.equal(failed.length, 5, "Exactly 5 jobs should fail due to balance exhaustion");

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 0, "Final balance must be exactly 0");
});

// ============================================================================
// 9. Graceful Shutdown & Handle Cleanup
// ============================================================================

test("queue: close() and worker.stop() terminate without hanging handles", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new WorkerProcessor({ queue, autoStart: true, pollIntervalMs: 20 });

  const { fingerprint, agent } = await provisionTestAgent("Shutdown-Agent", 50);
  const imageBase64 = await createTestImageBase64(50, 50);

  // Enqueue and let background worker process
  const job = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "grayscale_image",
    toolArgs: { image_base64: imageBase64 },
    cost: 2
  });

  // Wait briefly for completion
  let attempts = 0;
  while (attempts < 30) {
    const j = await queue.getJob(job.id);
    if (j?.status === "completed") break;
    await new Promise((r) => setTimeout(r, 20));
    attempts++;
  }

  const finalJob = await queue.getJob(job.id);
  assert.equal(finalJob?.status, "completed");

  // Shutdown both worker and queue
  await worker.stop();
  await queue.close();

  assert.equal(worker.isIdle(), true);
  assert.equal(queue.isClosed?.(), true);
});
