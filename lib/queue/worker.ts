/**
 * PixelMesh Phase 3 - Asynchronous Background Queue Worker & Credit Settlement Pipeline
 * 
 * Features:
 * 1. Dual-mode worker architecture supporting BullMQ (Redis) and InMemoryJobQueue.
 * 2. Strict atomic credit settlement: 0 credits deducted on failure, exact cost deducted on completion.
 * 3. Exponential backoff retry engine for transient image/system errors with non-retryable fast-fail.
 * 4. Fine-grained progress reporting across single and multi-step pipeline operations.
 * 5. Full error isolation preventing single-job crashes from compromising worker uptime.
 * 6. Audit telemetry logging for every asynchronous job execution.
 */

import { EventEmitter } from "events";
import crypto from "crypto";
import sharp from "sharp";
import { keyStore } from "../auth/key-store";
import { telemetryStore } from "../telemetry/store";
import { processSingleFilter, processPipeline, parseBase64Image, resolveInputImage } from "../image/engine";
import {
  JobRecord,
  JobPayload,
  JobResult,
  WorkerOptions
} from "./types";
import { JobQueue, getJobQueue } from "./job-queue";

// ============================================================================
// 1. Custom Error Types
// ============================================================================

export class NonRetryableJobError extends Error {
  public readonly isNonRetryable = true;
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

// ============================================================================
// 2. QueueWorker Implementation
// ============================================================================

export class QueueWorker extends EventEmitter {
  private queue: JobQueue;
  private options: Required<WorkerOptions>;
  private running = false;
  private activeJobs = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private retryTimers = new Set<NodeJS.Timeout>();
  private bullWorker: any = null;
  private executionHook: ((tool: string, args: Record<string, any>) => Promise<any>) | null = null;

  constructor(queueOrOptions?: JobQueue | WorkerOptions, options?: WorkerOptions) {
    super();

    let q: JobQueue | undefined;
    let opts: WorkerOptions | undefined;

    if (queueOrOptions && "enqueue" in (queueOrOptions as any)) {
      q = queueOrOptions as JobQueue;
      opts = options;
    } else if (queueOrOptions) {
      opts = queueOrOptions as WorkerOptions;
      q = opts.queue;
    }

    this.queue = q || getJobQueue();
    this.options = {
      queue: this.queue,
      concurrency: opts?.concurrency ?? 5,
      maxRetries: opts?.maxRetries ?? opts?.maxAttempts ?? 3,
      maxAttempts: opts?.maxAttempts ?? opts?.maxRetries ?? 3,
      backoffDelayMs: opts?.backoffDelayMs ?? opts?.backoffMs ?? 1000,
      backoffMs: opts?.backoffMs ?? opts?.backoffDelayMs ?? 1000,
      drainDelayMs: opts?.drainDelayMs ?? 100,
      pollIntervalMs: opts?.pollIntervalMs ?? 50,
      shutdownTimeoutMs: opts?.shutdownTimeoutMs ?? 5000,
      autoStart: opts?.autoStart ?? false
    };

    if (this.options.autoStart) {
      this.start().catch((err) => {
        console.error("[QueueWorker] Failed to auto-start worker:", err);
      });
    }
  }

  /**
   * Set custom execution hook (used for test fault-injection & mocking)
   */
  public setExecutionHook(fn: ((tool: string, args: Record<string, any>) => Promise<any>) | null): void {
    this.executionHook = fn;
  }

  /**
   * Start background worker loop
   */
  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.queue.isBullMQ()) {
      await this.initBullMQWorker();
    } else {
      this.initInMemoryWorker();
    }

    this.emit("ready");
  }

  /**
   * Initialize BullMQ Worker backend
   */
  private async initBullMQWorker(): Promise<void> {
    try {
      // Dynamic import to prevent crash when BullMQ is not installed in mock mode
      const { Worker } = require("bullmq");
      const ioredis = await this.queue.getRedisConnection();

      this.bullWorker = new Worker(
        this.queue.getQueueName(),
        async (bullJob: any) => {
          return await this.processJobData(
            bullJob.data,
            bullJob.attemptsMade + 1,
            (progress: number) => bullJob.updateProgress(progress)
          );
        },
        {
          connection: ioredis,
          concurrency: this.options.concurrency
        }
      );

      this.bullWorker.on("completed", (job: any, result: any) => {
        this.emit("job:completed", { jobId: job.id, result });
      });

      this.bullWorker.on("failed", (job: any, err: any) => {
        this.emit("job:failed", { jobId: job.id, error: err.message });
      });
    } catch (err) {
      console.warn("[QueueWorker] BullMQ Worker initialization failed. Falling back to in-memory mode.", err);
      this.initInMemoryWorker();
    }
  }

  /**
   * Initialize In-Memory Worker event listener and polling loop
   */
  private initInMemoryWorker(): void {
    this.queue.on("job:enqueued", () => {
      this.scheduleDispatch();
    });

    const loop = async () => {
      if (!this.running) return;
      await this.dispatchNextJobs();
      if (this.running) {
        this.pollTimer = setTimeout(loop, this.options.pollIntervalMs);
      }
    };
    this.pollTimer = setTimeout(loop, 10);
  }

  private scheduleDispatch(): void {
    if (!this.running) return;
    setImmediate(() => {
      this.dispatchNextJobs().catch((err) => {
        this.emit("error", err);
      });
    });
  }

  /**
   * Dispatch available jobs up to concurrency limit
   */
  private async dispatchNextJobs(): Promise<void> {
    if (!this.running || this.queue.isBullMQ()) return;

    while (this.activeJobs.size < this.options.concurrency) {
      const nextJob = await this.queue.getNextQueuedJob();
      if (!nextJob) break;

      this.activeJobs.add(nextJob.id);
      this.executeJobWithLifecycle(nextJob)
        .finally(() => {
          this.activeJobs.delete(nextJob.id);
          this.scheduleDispatch();
        })
        .catch((err) => {
          this.emit("error", err);
        });
    }
  }

  /**
   * Manually process the next queued job (for deterministic unit testing)
   */
  public async processNextJob(): Promise<JobRecord | null> {
    const nextJob = await this.queue.getNextQueuedJob({ includeDelayed: true });
    if (!nextJob) return null;

    this.activeJobs.add(nextJob.id);
    try {
      return await this.executeJobWithLifecycle(nextJob);
    } finally {
      this.activeJobs.delete(nextJob.id);
    }
  }

  /**
   * Executes a job through its complete lifecycle in InMemory mode
   */
  public async executeJobWithLifecycle(job: JobRecord): Promise<JobRecord> {
    const startTime = performance.now();
    const attemptsMade = job.attemptsMade + 1;
    const startedAt = new Date();

    await this.queue.updateJobStatus(job.id, "active", {
      startedAt: startedAt.toISOString(),
      attemptsMade,
      progress: 5
    });

    try {
      const jobResult = await this.processJobData(
        job.data,
        attemptsMade,
        async (progress: number) => {
          await this.queue.updateJobProgress(job.id, progress);
        }
      );

      const durationMs = Math.round(performance.now() - startTime);
      const completedAt = new Date();

      await this.queue.updateJobStatus(job.id, "completed", {
        progress: 100,
        result: jobResult.result,
        costDeducted: jobResult.costDeducted,
        balanceAfter: jobResult.balanceAfter,
        completedAt: completedAt.toISOString(),
        durationMs
      });

      const updatedJob = await this.queue.getJob(job.id);
      return updatedJob || {
        ...job,
        status: "completed",
        progress: 100,
        result: jobResult.result,
        costDeducted: jobResult.costDeducted,
        balanceAfter: jobResult.balanceAfter,
        startedAt,
        completedAt,
        attemptsMade
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      const isNonRetryable = err instanceof NonRetryableJobError || Boolean(err.isNonRetryable);
      const maxRetries = job.data.maxRetries ?? job.maxRetries ?? this.options.maxRetries;

      if (!isNonRetryable && attemptsMade < maxRetries) {
        // Calculate exponential backoff delay
        const delayMs = (job.data.backoffDelayMs || job.data.backoffMs || this.options.backoffDelayMs) * Math.pow(2, attemptsMade - 1);
        const runAt = new Date(Date.now() + delayMs);

        await this.queue.updateJobStatus(job.id, "queued", {
          error: `Attempt ${attemptsMade} failed: ${err.message}`,
          progress: 0,
          attemptsMade,
          runAt: runAt.toISOString(),
          delayMs
        });

        const retryEventPayload = {
          jobId: job.id,
          attempt: attemptsMade,
          nextAttempt: attemptsMade + 1,
          delayMs,
          error: err.message
        };

        this.emit("retry", retryEventPayload);
        this.emit("job:retry", retryEventPayload);
        if ((this.queue as any).emit) {
          (this.queue as any).emit("retry", retryEventPayload);
          (this.queue as any).emit("job:retry", retryEventPayload);
        }

        if (this.running) {
          const retryTimer = setTimeout(async () => {
            this.retryTimers.delete(retryTimer);
            if (this.running) {
              const currentJob = await this.queue.getJob(job.id);
              if (currentJob && currentJob.status !== "completed" && currentJob.status !== "failed") {
                await this.queue.requeueJob(job.id);
                this.scheduleDispatch();
              }
            }
          }, delayMs);
          this.retryTimers.add(retryTimer);
        }

        const updatedJob = await this.queue.getJob(job.id);
        return updatedJob || {
          ...job,
          status: "queued",
          attemptsMade,
          error: err.message,
          costDeducted: 0,
          runAt
        };
      }

      // Final Terminal Failure
      const failedAt = new Date();
      const reservedCost = job.costDeducted || (job.data as any)?.costDeducted || 0;
      if (reservedCost > 0) {
        try {
          await keyStore.refundCredits(
            job.fingerprint,
            reservedCost,
            `refund-${job.id}`,
            `Refund for failed job ${job.id}: ${err.message}`
          );
        } catch (refundErr) {
          console.error(`[Worker] Failed to refund ${reservedCost} credits for job ${job.id}:`, refundErr);
        }
      }

      await this.queue.updateJobStatus(job.id, "failed", {
        progress: 0,
        error: err.message,
        failedReason: err.message,
        costDeducted: 0,
        failedAt: failedAt.toISOString()
      });

      // Log failure to telemetry store (guaranteed 0 net credits deducted)
      await telemetryStore.addLog({
        fingerprint: job.fingerprint,
        agentName: job.agentName,
        method: "tools/call",
        toolName: job.toolName,
        status: "tool_error",
        costCredits: 0,
        creditsRemaining: 0,
        latencyMs: durationMs,
        nonce: `async-job-${job.id}`,
        timestampDriftMs: 0,
        signatureValid: true,
        errorMessage: err.message
      });

      const updatedJob = await this.queue.getJob(job.id);
      return updatedJob || {
        ...job,
        status: "failed",
        error: err.message,
        failedReason: err.message,
        failedAt,
        completedAt: failedAt,
        costDeducted: 0,
        attemptsMade
      };
    }
  }

  /**
   * Core Job Execution Logic: Payload Validation, Sharp Processing & Atomic Credit Settlement
   */
  public async processJobData(
    payload: JobPayload,
    attempt: number = 1,
    onProgress?: (progress: number) => Promise<void> | void
  ): Promise<JobResult> {
    const startTime = performance.now();
    const { id: jobId, fingerprint, toolName, toolArgs = {}, cost = 1 } = payload;

    // Check custom test hook first if registered
    if (this.executionHook) {
      const hookResult = await this.executionHook(toolName, toolArgs);
      if (hookResult !== null && hookResult !== undefined) {
        return hookResult;
      }
    }

    if (!fingerprint) {
      throw new NonRetryableJobError("Missing required field 'fingerprint' in job payload.");
    }
    if (!toolName) {
      throw new NonRetryableJobError("Missing required field 'toolName' in job payload.");
    }

    // 1. Verify Agent Key Existence and Status
    const agentKey = await keyStore.findKeyByFingerprint(fingerprint);
    if (!agentKey || agentKey.status === "revoked") {
      throw new NonRetryableJobError("Agent key not found or has been revoked.");
    }

    // 2. Validate Key Scopes
    const allowedScopes = agentKey.scopes || ["all-tools"];
    const hasScope =
      allowedScopes.includes("all-tools") ||
      allowedScopes.includes(toolName) ||
      (allowedScopes.includes("filters:*") && toolName !== "export_image") ||
      (allowedScopes.includes("geometry:*") &&
        ["crop_image", "circle_crop", "flip_image", "rotate_image", "straighten_photo"].includes(toolName));

    if (!hasScope) {
      throw new NonRetryableJobError(`Scope permission denied for tool '${toolName}'.`);
    }

    // 3. Pre-flight Credit Balance Check (Account for pre-reserved credits)
    const reservedCost = (payload as any).costDeducted || 0;
    const effectiveRemainingCost = Math.max(0, cost - reservedCost);
    if (agentKey.creditsBalance < effectiveRemainingCost) {
      throw new NonRetryableJobError(
        `Insufficient credits. Required: ${effectiveRemainingCost}, Available: ${agentKey.creditsBalance}.`
      );
    }

    await onProgress?.(10);

    // 4. Execute Sharp Filter Engine
    let filterResult: any;

    try {
      const hasInput = Boolean(toolArgs?.image_base64 || toolArgs?.image_key || toolArgs?.image_url);

      if (toolName === "get_image_metadata") {
        if (!hasInput) {
          throw new NonRetryableJobError("Invalid arguments: 'image_base64', 'image_key', or 'image_url' is required for get_image_metadata.");
        }
        const resolved = await resolveInputImage(toolArgs);
        const meta = await sharp(resolved.buffer).metadata();

        await onProgress?.(90);

        filterResult = {
          imageBase64: resolved.sourceType === "base64" ? toolArgs.image_base64 : undefined,
          metadata: {
            width: meta.width,
            height: meta.height,
            format: meta.format,
            space: meta.space,
            channels: meta.channels,
            sizeBytes: resolved.buffer.length
          },
          executionTimeMs: Math.round(performance.now() - startTime)
        };
      } else if (toolName === "batch_filter_pipeline") {
        if (!hasInput || !Array.isArray(toolArgs?.operations)) {
          throw new NonRetryableJobError("Invalid arguments: image input and 'operations' array are required.");
        }
        const operations = toolArgs.operations;
        if (operations.length === 0) {
          throw new NonRetryableJobError("The 'operations' pipeline array cannot be empty.");
        }

        const returnType = payload.returnType || toolArgs.return_type || toolArgs.returnType || "base64";
        filterResult = await processPipeline(
          toolArgs,
          operations,
          toolArgs.output_format,
          returnType
        );
        await onProgress?.(90);
      } else {
        // Single Filter Tool
        if (!hasInput) {
          throw new NonRetryableJobError(`Invalid arguments: image input is required for tool '${toolName}'.`);
        }
        const { output_format, ...restParams } = toolArgs;
        const returnType = payload.returnType || toolArgs.return_type || toolArgs.returnType || "base64";
        await onProgress?.(30);
        filterResult = await processSingleFilter(
          toolArgs,
          toolName,
          restParams,
          output_format,
          returnType
        );
        await onProgress?.(90);
      }
    } catch (err: any) {
      if (err instanceof NonRetryableJobError) throw err;
      if (
        err.message?.includes("Invalid image input") ||
        err.message?.includes("Unknown filter tool") ||
        err.message?.includes("exceeds maximum allowed") ||
        err.message?.includes("Unsupported image format")
      ) {
        throw new NonRetryableJobError(err.message);
      }
      throw err;
    }

    // 5. ATOMIC CREDIT SETTLEMENT: Check if already reserved at enqueue, or deduct now
    let deductionRemaining = agentKey.creditsBalance;

    if (cost > 0 && reservedCost < cost) {
      const remainingToDeduct = cost - reservedCost;
      const uniqueJobRef = jobId || (payload as any).jobId || `job:${crypto.randomUUID()}`;
      const deduction = await keyStore.deductCredits(
        fingerprint,
        remainingToDeduct,
        uniqueJobRef,
        toolName
      );

      if (!deduction.success) {
        throw new NonRetryableJobError(`Credit settlement failed: ${deduction.error || "Unable to deduct credits."}`);
      }
      deductionRemaining = deduction.remaining;
    }

    const durationMs = Math.round(performance.now() - startTime);

    // 6. Log Successful Job to Telemetry Store
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      fingerprint,
      agentName: agentKey.agentName,
      method: "tools/call",
      toolName,
      status: "success",
      costCredits: cost,
      creditsRemaining: deductionRemaining,
      latencyMs: durationMs,
      nonce: `async-job-${jobId || Date.now()}`,
      timestampDriftMs: 0,
      signatureValid: true
    });

    await onProgress?.(100);

    const resultObj: any = {
      content: [
        {
          type: "text",
          text: `Tool '${toolName}' executed successfully in ${filterResult.executionTimeMs}ms. Metadata: ${JSON.stringify(filterResult.metadata)}`
        }
      ],
      metadata: filterResult.metadata,
      executionTimeMs: filterResult.executionTimeMs,
      execution_time_ms: filterResult.executionTimeMs
    };

    if (filterResult.imageBase64) {
      resultObj.content.push({
        type: "image",
        data: filterResult.imageBase64,
        mimeType: filterResult.metadata?.format ? `image/${filterResult.metadata.format}` : "image/png"
      });
      resultObj.imageBase64 = filterResult.imageBase64;
      resultObj.image_base64 = filterResult.imageBase64;
    }
    if (filterResult.imageKey || filterResult.image_key) {
      resultObj.imageKey = filterResult.image_key || filterResult.imageKey;
      resultObj.image_key = resultObj.imageKey;
    }
    if (filterResult.imageUrl || filterResult.image_url || filterResult.publicUrl) {
      resultObj.imageUrl = filterResult.image_url || filterResult.imageUrl || filterResult.publicUrl;
      resultObj.image_url = resultObj.imageUrl;
      resultObj.publicUrl = resultObj.imageUrl;
      resultObj.public_url = resultObj.imageUrl;
    }

    return {
      status: "completed",
      result: resultObj,
      costDeducted: cost,
      balanceAfter: deductionRemaining,
      durationMs,
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Check if worker is running
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if worker is idle (no active running jobs)
   */
  public isIdle(): boolean {
    return this.activeJobs.size === 0;
  }

  /**
   * Return number of currently active jobs
   */
  public getActiveCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Graceful worker shutdown
   */
  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    if (this.bullWorker) {
      await this.bullWorker.close().catch(() => {});
      this.bullWorker = null;
    }

    // Wait for in-flight active jobs to finish (up to shutdownTimeoutMs)
    const start = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - start < this.options.shutdownTimeoutMs) {
      await new Promise((res) => setTimeout(res, 20));
    }

    this.emit("stopped");
  }

  /**
   * Alias for stop()
   */
  public async close(): Promise<void> {
    await this.stop();
  }
}

// ============================================================================
// 3. WorkerProcessor Alias & Factory Helpers
// ============================================================================

export { QueueWorker as WorkerProcessor };

export function createWorker(options?: WorkerOptions): QueueWorker {
  return new QueueWorker(options);
}

declare global {
  // eslint-disable-next-line no-var
  var __pixelmesh_worker__: QueueWorker | undefined;
}

export function getQueueWorker(options?: WorkerOptions): QueueWorker {
  if (!globalThis.__pixelmesh_worker__) {
    globalThis.__pixelmesh_worker__ = new QueueWorker(options);
  }
  return globalThis.__pixelmesh_worker__;
}

export const queueWorker = getQueueWorker();
