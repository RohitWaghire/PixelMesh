/**
 * PixelMesh Phase 3 - Background Task Queue Adversarial Challenge Test Suite
 * 
 * Challenger: Challenger 2 (Milestone 1: Queue)
 * File: lib/queue/queue-adversarial.test.ts
 * Runner: node:test + node:assert/strict via tsx
 * 
 * Scope:
 * 1. Strict priority ordering (fast -> default -> batch) under mixed arrival patterns.
 * 2. Strict FIFO execution within each priority tier (including sub-millisecond timestamp collisions).
 * 3. Dynamic runtime priority preemption during live worker processing.
 * 4. Rapid lifecycle pause, resume, reset, and close under active load.
 * 5. In-flight job resilience during mid-flight reset() and close().
 * 6. Concurrency bounding and event loop timer/listener leak prevention.
 * 7. Zero unhandled promise rejections or uncaught exceptions.
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

// ============================================================================
// Helpers & Utilities
// ============================================================================

async function createTestImageBase64(
  width = 100,
  height = 100,
  color = { r: 120, g: 140, b: 180 }
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

async function provisionTestAgent(
  agentName = "Adversarial-Queue-Agent",
  initialCredits = 5000,
  scopes = ["all-tools"]
) {
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

// Global unhandled rejection & exception traps
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
// SUITE 1: Priority Queue Scheduling & Strict FIFO Invariants
// ============================================================================

test("adversarial: 150 mixed-priority jobs are dequeued in strict 3-tier priority order (fast -> default -> batch)", async () => {
  const queue = new InMemoryJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Tier-Order-Agent", 10000);

  const totalPerTier = 50;
  const tiers: JobPriority[] = ["fast", "default", "batch"];
  const jobSubmissions: { id: string; priority: JobPriority; seq: number }[] = [];

  // Generate 150 submissions interleaved in round-robin fashion
  for (let i = 0; i < totalPerTier; i++) {
    for (const priority of ["batch", "default", "fast"] as JobPriority[]) {
      const jobId = `job_${priority}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      jobSubmissions.push({ id: jobId, priority, seq: i });
    }
  }

  // Enqueue in randomized arrival order
  const shuffled = [...jobSubmissions].sort(() => Math.random() - 0.5);
  for (const item of shuffled) {
    await queue.enqueue({
      id: item.id,
      fingerprint,
      agentName: agent.agentName,
      toolName: item.priority === "fast" ? "crop_image" : item.priority === "default" ? "adjust_brightness" : "batch_filter_pipeline",
      toolArgs: {},
      cost: 1,
      priority: item.priority
    });
  }

  // Dequeue all 150 jobs sequentially and record priority ordering
  const dequeuedPriorities: JobPriority[] = [];
  for (let i = 0; i < 150; i++) {
    const nextJob = await queue.getNextQueuedJob();
    assert.ok(nextJob, `Job at index ${i} must exist`);
    dequeuedPriorities.push(nextJob.priorityTag);
    await queue.updateJobStatus(nextJob.id, "active");
  }

  // Validate that the first 50 are all "fast"
  for (let i = 0; i < 50; i++) {
    assert.equal(
      dequeuedPriorities[i],
      "fast",
      `Job at position ${i} must have priority 'fast', got '${dequeuedPriorities[i]}'`
    );
  }

  // Validate that positions 50..99 are all "default"
  for (let i = 50; i < 100; i++) {
    assert.equal(
      dequeuedPriorities[i],
      "default",
      `Job at position ${i} must have priority 'default', got '${dequeuedPriorities[i]}'`
    );
  }

  // Validate that positions 100..149 are all "batch"
  for (let i = 100; i < 150; i++) {
    assert.equal(
      dequeuedPriorities[i],
      "batch",
      `Job at position ${i} must have priority 'batch', got '${dequeuedPriorities[i]}'`
    );
  }
});

test("adversarial: strict FIFO ordering within identical priority tiers is strictly preserved", async () => {
  const queue = new InMemoryJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("FIFO-Tier-Agent", 10000);

  const numJobs = 40;
  const tiers: JobPriority[] = ["fast", "default", "batch"];

  // For each tier, enqueue 40 jobs with sequential indices
  for (const tier of tiers) {
    for (let seq = 0; seq < numJobs; seq++) {
      await queue.enqueue({
        id: `${tier}_seq_${seq}`,
        fingerprint,
        agentName: agent.agentName,
        toolName: "crop_image",
        toolArgs: { seq },
        cost: 1,
        priority: tier,
        // Introduce monotonic createdAt progression
        createdAt: new Date(Date.now() + seq * 2).toISOString()
      });
    }
  }

  // Dequeue all 120 jobs and verify FIFO sequence within each tier
  for (const tier of tiers) {
    for (let expectedSeq = 0; expectedSeq < numJobs; expectedSeq++) {
      const nextJob = await queue.getNextQueuedJob();
      assert.ok(nextJob, `Expected job for tier ${tier} seq ${expectedSeq}`);
      assert.equal(nextJob.priorityTag, tier, `Expected tier ${tier}, got ${nextJob.priorityTag}`);
      assert.equal(
        nextJob.id,
        `${tier}_seq_${expectedSeq}`,
        `FIFO violation in tier ${tier}: expected seq ${expectedSeq}, got ${nextJob.id}`
      );
      await queue.updateJobStatus(nextJob.id, "active");
    }
  }
});

test("adversarial: sub-millisecond timestamp collision maintains stable insertion FIFO order", async () => {
  const queue = new InMemoryJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Collision-Agent", 5000);

  const identicalTimestamp = new Date("2026-08-22T19:00:00.000Z");
  const count = 30;

  for (let i = 0; i < count; i++) {
    await queue.enqueue({
      id: `collision_job_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: { index: i },
      cost: 1,
      priority: "fast",
      createdAt: identicalTimestamp.toISOString()
    });
  }

  // Dequeue all and verify exact 0..29 sequence is preserved despite identical timestamp
  for (let expectedIndex = 0; expectedIndex < count; expectedIndex++) {
    const job = await queue.getNextQueuedJob();
    assert.ok(job);
    assert.equal(
      job.id,
      `collision_job_${expectedIndex}`,
      `Stable FIFO ordering failed under timestamp collision at index ${expectedIndex}`
    );
    await queue.updateJobStatus(job.id, "active");
  }
});

test("adversarial: dynamic runtime priority preemption during live worker processing", async () => {
  const queue = new InMemoryJobQueue();
  const worker = createWorker({ queue, concurrency: 1, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Preemption-Agent", 5000);
  const imageBase64 = await createTestImageBase64(50, 50);

  // Hook to simulate a slow in-flight job
  let slowJobResolve: (() => void) | null = null;
  const slowJobPromise = new Promise<void>((resolve) => {
    slowJobResolve = resolve;
  });

  worker.setExecutionHook(async (tool, args) => {
    if (tool === "slow_batch_job") {
      await slowJobPromise;
      return {
        status: "completed",
        result: { done: true },
        costDeducted: 1,
        durationMs: 50
      };
    }
    return null;
  });

  // 1. Enqueue slow batch job and start processing it
  const slowJob = await queue.enqueue({
    id: "active_slow_job",
    fingerprint,
    agentName: agent.agentName,
    toolName: "slow_batch_job",
    toolArgs: {},
    cost: 1,
    priority: "batch"
  });

  const workerExecution = worker.processNextJob();

  // Wait until slow job is active
  while (true) {
    const j = await queue.getJob("active_slow_job");
    if (j?.status === "active") break;
    await new Promise((r) => setTimeout(r, 5));
  }

  // 2. While worker is busy, enqueue 5 low-priority batch jobs
  for (let i = 0; i < 5; i++) {
    await queue.enqueue({
      id: `queued_batch_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "adjust_brightness",
      toolArgs: { image_base64: imageBase64 },
      cost: 1,
      priority: "batch"
    });
  }

  // 3. Enqueue 2 high-priority fast jobs AFTER the batch jobs were already queued
  for (let i = 0; i < 2; i++) {
    await queue.enqueue({
      id: `urgent_fast_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: { image_base64: imageBase64, width: 20, height: 20 },
      cost: 1,
      priority: "fast"
    });
  }

  // 4. Release the slow job
  slowJobResolve!();
  await workerExecution;

  // 5. Next job processed MUST be urgent_fast_0, then urgent_fast_1, then queued_batch_0..4
  const next1 = await worker.processNextJob();
  assert.equal(next1?.id, "urgent_fast_0", "High priority fast job 0 must preempt existing batch jobs");

  const next2 = await worker.processNextJob();
  assert.equal(next2?.id, "urgent_fast_1", "High priority fast job 1 must preempt existing batch jobs");

  const next3 = await worker.processNextJob();
  assert.equal(next3?.id, "queued_batch_0", "First batch job should be processed after fast jobs finish");
});

test("adversarial: priority override precedence hierarchy (options > payload > inferred)", async () => {
  const queue = new InMemoryJobQueue();
  const { fingerprint, agent } = await provisionTestAgent("Precedence-Agent", 5000);

  // 1. Inferred: 'crop_image' naturally infers 'fast' (weight 1)
  const j1 = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 1
  });
  assert.equal(j1.priorityTag, "fast");
  assert.equal(j1.priority, 1);

  // 2. Payload override: 'crop_image' overridden to 'batch' (weight 10) in payload
  const j2 = await queue.enqueue({
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 1,
    priority: "batch"
  });
  assert.equal(j2.priorityTag, "batch");
  assert.equal(j2.priority, 10);

  // 3. Options override: options.priority 'fast' overrides payload 'batch'
  const j3 = await queue.enqueue(
    {
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: {},
      cost: 1,
      priority: "batch"
    },
    { priority: "fast" }
  );
  assert.equal(j3.priorityTag, "fast");
  assert.equal(j3.priority, 1);
});

// ============================================================================
// SUITE 2: Rapid Lifecycle (Pause, Resume, Reset, Close) Under Active Load
// ============================================================================

test("adversarial: rapid pause and resume stress cycle under continuous job generation", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 3, autoStart: true, pollIntervalMs: 10 });
  const { fingerprint, agent } = await provisionTestAgent("Pause-Resume-Agent", 10000);
  const imageBase64 = await createTestImageBase64(30, 30);

  const totalJobs = 30;
  const processedJobIds = new Set<string>();

  queue.on("completed", (j: any) => {
    processedJobIds.add(j.id || j.jobId);
  });

  // Enqueue jobs continuously while toggling pause/resume rapidly
  for (let i = 0; i < totalJobs; i++) {
    await queue.enqueue({
      id: `pause_resume_job_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: { image_base64: imageBase64, width: 20, height: 20 },
      cost: 1
    });

    if (i % 3 === 0) {
      await queue.pause();
      assert.equal(queue.isPaused(), true);
      // While paused, no new jobs should be fetched
      const nextWhilePaused = await queue.getNextQueuedJob();
      assert.equal(nextWhilePaused, null);

      await new Promise((r) => setTimeout(r, 15));
      await queue.resume();
      assert.equal(queue.isPaused(), false);
    }
  }

  // Wait for all jobs to complete after full resume
  const startTime = Date.now();
  while (processedJobIds.size < totalJobs && Date.now() - startTime < 4000) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(
    processedJobIds.size,
    totalJobs,
    `All ${totalJobs} jobs must complete after pause/resume cycle; only completed ${processedJobIds.size}`
  );

  await worker.stop();
  await queue.close();
});

test("adversarial: mid-flight reset() handles active in-flight jobs gracefully without crashing or leaking", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 5, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("MidFlight-Reset-Agent", 5000);

  let activeInFlightCount = 0;
  let finishSignal: (() => void) | null = null;
  const finishPromise = new Promise<void>((resolve) => {
    finishSignal = resolve;
  });

  worker.setExecutionHook(async () => {
    activeInFlightCount++;
    await finishPromise;
    return {
      status: "completed",
      result: { ok: true },
      costDeducted: 1,
      durationMs: 10
    };
  });

  // Enqueue 5 jobs
  for (let i = 0; i < 5; i++) {
    await queue.enqueue({
      id: `inflight_reset_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: {},
      cost: 1
    });
  }

  // Start processing in parallel
  const processPromises = Array.from({ length: 5 }, () => worker.processNextJob());

  // Wait until all 5 jobs are in-flight in hook
  while (activeInFlightCount < 5) {
    await new Promise((r) => setTimeout(r, 5));
  }

  // Trigger mid-flight queue reset!
  queue.reset();

  // Release the in-flight jobs
  finishSignal!();

  // All promises must resolve without throwing unhandled exceptions
  const results = await Promise.all(processPromises);
  assert.equal(results.length, 5);

  for (const r of results) {
    assert.ok(r, "Returned job record must exist");
    assert.equal(r.status, "completed");
  }

  await worker.stop();
  await queue.close();
});

test("adversarial: queue.close() and worker.stop() under active concurrent load terminates cleanly within timeout", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 4, autoStart: true, pollIntervalMs: 10, shutdownTimeoutMs: 2000 });
  const { fingerprint, agent } = await provisionTestAgent("Close-Load-Agent", 5000);
  const imageBase64 = await createTestImageBase64(40, 40);

  // Enqueue 20 jobs
  for (let i = 0; i < 20; i++) {
    await queue.enqueue({
      id: `close_load_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: { image_base64: imageBase64, width: 20, height: 20 },
      cost: 1
    });
  }

  // Let worker start processing a few jobs
  await new Promise((r) => setTimeout(r, 40));

  // Trigger concurrent stop and close
  const stopPromise = worker.stop();
  const closePromise = queue.close();

  await Promise.all([stopPromise, closePromise]);

  assert.equal(worker.isRunning(), false);
  assert.equal(worker.isIdle(), true);
  assert.equal(queue.isClosed(), true);
});

test("adversarial: 50 sequential rapid lifecycle churn cycles (instantiate -> enqueue -> pause -> resume -> reset -> close)", async () => {
  const { fingerprint, agent } = await provisionTestAgent("Churn-Agent", 10000);

  for (let cycle = 0; cycle < 50; cycle++) {
    const q = new InMemoryJobQueue(`churn-queue-${cycle}`, { concurrency: 2 });
    const w = new QueueWorker({ queue: q, concurrency: 2, autoStart: false });

    const job = await q.enqueue({
      id: `churn_${cycle}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: {},
      cost: 1
    });

    await q.pause();
    assert.equal(q.isPaused(), true);
    await q.resume();
    assert.equal(q.isPaused(), false);

    q.reset();
    await q.close();
    await w.stop();

    assert.equal(q.isClosed(), true);
    assert.equal(w.isRunning(), false);
  }
});

// ============================================================================
// SUITE 3: Worker Event Loop Integrity, Concurrency Bounds & Leak Auditing
// ============================================================================

test("adversarial: strict worker concurrency limit is never exceeded under burst load", async () => {
  const queue = new InMemoryJobQueue();
  const concurrencyLimit = 3;
  const worker = new QueueWorker({ queue, concurrency: concurrencyLimit, autoStart: true, pollIntervalMs: 5 });
  const { fingerprint, agent } = await provisionTestAgent("Concurrency-Bound-Agent", 5000);

  let maxObservedConcurrency = 0;
  let concurrencyViolations = 0;

  // Simulate artificial latency in execution hook
  worker.setExecutionHook(async () => {
    const current = worker.getActiveCount();
    if (current > maxObservedConcurrency) {
      maxObservedConcurrency = current;
    }
    if (current > concurrencyLimit) {
      concurrencyViolations++;
    }
    await new Promise((r) => setTimeout(r, 25));
    return {
      status: "completed",
      result: { ok: true },
      costDeducted: 1,
      durationMs: 25
    };
  });

  // Burst enqueue 30 jobs
  for (let i = 0; i < 30; i++) {
    await queue.enqueue({
      id: `burst_concurrency_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: {},
      cost: 1
    });
  }

  // Poll for completion while sampling concurrency
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const current = worker.getActiveCount();
    if (current > maxObservedConcurrency) {
      maxObservedConcurrency = current;
    }
    if (current > concurrencyLimit) {
      concurrencyViolations++;
    }
    const counts = await queue.getJobCounts();
    if (counts.completed === 30) break;
    await new Promise((r) => setTimeout(r, 5));
  }

  await worker.stop();
  await queue.close();

  assert.equal(
    concurrencyViolations,
    0,
    `Observed ${concurrencyViolations} concurrency limit violations (> ${concurrencyLimit})`
  );
  assert.ok(
    maxObservedConcurrency <= concurrencyLimit,
    `Max observed concurrency ${maxObservedConcurrency} exceeded limit ${concurrencyLimit}`
  );
});

test("adversarial: worker retry timers are completely cleaned up on worker.stop() without dangling handles", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({
    queue,
    concurrency: 2,
    autoStart: false,
    backoffMs: 5000 // Long delay so timer would hang if not cleared
  });
  const { fingerprint, agent } = await provisionTestAgent("Timer-Cleanup-Agent", 5000);

  await worker.start();
  assert.equal(worker.isRunning(), true);

  worker.setExecutionHook(async () => {
    throw new Error("Simulated transient network failure");
  });

  await queue.enqueue({
    id: "retry_timer_job",
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 1,
    maxAttempts: 3,
    backoffMs: 5000
  });

  // Execute first attempt -> triggers retry timer
  const r1 = await worker.processNextJob();
  assert.equal(r1?.status, "queued");
  assert.equal(r1?.attemptsMade, 1);

  // Verify internal retry timer set has 1 timer
  assert.equal((worker as any).retryTimers.size, 1);

  // Stop worker -> must clear all retry timers
  await worker.stop();
  assert.equal((worker as any).retryTimers.size, 0, "All retry timers must be cleared on stop()");

  await queue.close();
});

test("adversarial: event listener count remains constant and bounded across hundreds of jobs", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 2, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Listener-Leak-Agent", 10000);

  const initialQueueListeners = queue.eventNames().reduce((sum, e) => sum + queue.listenerCount(e), 0);
  const initialWorkerListeners = worker.eventNames().reduce((sum, e) => sum + worker.listenerCount(e), 0);

  worker.setExecutionHook(async () => ({
    status: "completed",
    result: { ok: true },
    costDeducted: 1,
    durationMs: 1
  }));

  for (let i = 0; i < 100; i++) {
    await queue.enqueue({
      id: `listener_job_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: {},
      cost: 1
    });

    await worker.processNextJob();
  }

  const finalQueueListeners = queue.eventNames().reduce((sum, e) => sum + queue.listenerCount(e), 0);
  const finalWorkerListeners = worker.eventNames().reduce((sum, e) => sum + worker.listenerCount(e), 0);

  assert.equal(
    finalQueueListeners,
    initialQueueListeners,
    `Queue listener count leaked: initial=${initialQueueListeners}, final=${finalQueueListeners}`
  );
  assert.equal(
    finalWorkerListeners,
    initialWorkerListeners,
    `Worker listener count leaked: initial=${initialWorkerListeners}, final=${finalWorkerListeners}`
  );

  await worker.stop();
  await queue.close();
});

// ============================================================================
// SUITE 4: High-Load Stress, Deep Pipeline Resilience & Fault Isolation
// ============================================================================

test("adversarial: 300 high-load jobs across 3 tiers processed concurrently without race conditions or credit discrepancy", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 8, autoStart: true, pollIntervalMs: 5 });
  const { fingerprint, agent } = await provisionTestAgent("High-Load-Agent", 50000);
  const imageBase64 = await createTestImageBase64(40, 40);

  const fastCount = 100;
  const defaultCount = 100;
  const batchCount = 100;
  const totalJobs = fastCount + defaultCount + batchCount;

  // Interleaved enqueue of 300 jobs
  const enqueuePromises: Promise<any>[] = [];
  for (let i = 0; i < 100; i++) {
    enqueuePromises.push(
      queue.enqueue({
        id: `batch_hl_${i}`,
        fingerprint,
        agentName: agent.agentName,
        toolName: "batch_filter_pipeline",
        toolArgs: {
          image_base64: imageBase64,
          operations: [{ tool: "crop_image", params: { left: 0, top: 0, width: 20, height: 20 } }]
        },
        cost: 3,
        priority: "batch"
      }),
      queue.enqueue({
        id: `default_hl_${i}`,
        fingerprint,
        agentName: agent.agentName,
        toolName: "adjust_brightness",
        toolArgs: { image_base64: imageBase64, factor: 10 },
        cost: 2,
        priority: "default"
      }),
      queue.enqueue({
        id: `fast_hl_${i}`,
        fingerprint,
        agentName: agent.agentName,
        toolName: "crop_image",
        toolArgs: { image_base64: imageBase64, width: 20, height: 20 },
        cost: 1,
        priority: "fast"
      })
    );
  }

  await Promise.all(enqueuePromises);

  // Poll until all 300 jobs are completed
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const counts = await queue.getJobCounts();
    if (counts.completed === totalJobs) break;
    await new Promise((r) => setTimeout(r, 20));
  }

  const finalCounts = await queue.getJobCounts();
  assert.equal(finalCounts.completed, totalJobs, `Expected ${totalJobs} completed jobs, got ${finalCounts.completed}`);

  // Total expected deduction: 100*1 (fast) + 100*2 (default) + 100*3 (batch) = 600 credits
  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 50000 - 600, "Balance must be exactly 50000 - 600 = 49400");
  assert.equal(agentAfter?.totalInvocations, 300);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 300);

  await worker.stop();
  await queue.close();
});

test("adversarial: rapid pause and resume while live Sharp image processing is in-flight", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 4, autoStart: true, pollIntervalMs: 5 });
  const { fingerprint, agent } = await provisionTestAgent("Sharp-Pause-Agent", 10000);
  const imageBase64 = await createTestImageBase64(80, 80);

  const total = 20;
  for (let i = 0; i < total; i++) {
    await queue.enqueue({
      id: `sharp_pause_job_${i}`,
      fingerprint,
      agentName: agent.agentName,
      toolName: "crop_image",
      toolArgs: { image_base64: imageBase64, width: 40, height: 40 },
      cost: 1
    });
  }

  // Rapidly toggle pause/resume during Sharp processing
  for (let i = 0; i < 10; i++) {
    await queue.pause();
    await new Promise((r) => setTimeout(r, 10));
    await queue.resume();
    await new Promise((r) => setTimeout(r, 10));
  }

  // Wait for all to finish
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const counts = await queue.getJobCounts();
    if (counts.completed === total) break;
    await new Promise((r) => setTimeout(r, 20));
  }

  const finalCounts = await queue.getJobCounts();
  assert.equal(finalCounts.completed, total);

  await worker.stop();
  await queue.close();
});

test("adversarial: unexpected fatal runtime exceptions in worker engine do not corrupt state or deduct credits", async () => {
  const queue = new InMemoryJobQueue();
  const worker = new QueueWorker({ queue, concurrency: 2, autoStart: false });
  const { fingerprint, agent } = await provisionTestAgent("Fatal-Error-Agent", 5000);

  // Inject a fatal TypeError
  worker.setExecutionHook(async () => {
    throw new TypeError("Simulated internal runtime TypeError in Sharp native binding");
  });

  const job = await queue.enqueue({
    id: "fatal_crash_job",
    fingerprint,
    agentName: agent.agentName,
    toolName: "crop_image",
    toolArgs: {},
    cost: 50,
    maxAttempts: 1
  });

  const result = await worker.processNextJob();
  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.equal(result.costDeducted, 0);
  assert.ok(result.error?.includes("TypeError"));

  const agentAfter = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(agentAfter?.creditsBalance, 5000, "Credits must strictly remain 5000 on fatal error");

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 0);

  await worker.stop();
  await queue.close();
});

