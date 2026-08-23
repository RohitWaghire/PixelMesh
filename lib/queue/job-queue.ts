/**
 * PixelMesh Phase 3 - Dual-Mode Background Task Queue
 * 
 * Supports:
 * 1. InMemoryJobQueue for deterministic offline testing, CI, and zero-dependency execution.
 * 2. BullMQJobQueueAdapter backed by Redis TCP via ioredis.
 * 3. Priority scheduling, progress event emission, and clean lifecycle teardown.
 */

import { EventEmitter } from "events";
import crypto from "crypto";
import {
  JobStatus,
  JobPriority,
  PRIORITY_WEIGHTS,
  JobPayload,
  JobResult,
  JobRecord,
  QueueConfig,
  JobQueueInterface
} from "./types";
import { determineRedisBackend } from "../redis/client";

// ============================================================================
// 1. Priority Inference Utility
// ============================================================================

export function inferJobPriority(toolName: string, toolArgs: Record<string, any> = {}): JobPriority {
  if (toolArgs.priority && (toolArgs.priority === "fast" || toolArgs.priority === "default" || toolArgs.priority === "batch")) {
    return toolArgs.priority as JobPriority;
  }
  if (toolName === "get_image_metadata" || ["crop_image", "circle_crop", "flip_image", "straighten_photo"].includes(toolName)) {
    return "fast";
  }
  if (toolName === "batch_filter_pipeline" || (toolArgs.image_base64 && toolArgs.image_base64.length > 10 * 1024 * 1024)) {
    return "batch";
  }
  return "default";
}

// ============================================================================
// 2. In-Memory Job Queue Implementation
// ============================================================================

export class InMemoryJobQueue extends EventEmitter implements JobQueueInterface {
  public name: string;
  private jobs = new Map<string, JobRecord>();
  private activeTimers = new Set<NodeJS.Timeout>();
  private paused = false;
  private closed = false;
  private concurrency: number;

  constructor(name = "pixelmesh-jobs", options?: { concurrency?: number }) {
    super();
    this.name = name;
    this.concurrency = options?.concurrency ?? 5;
  }

  /**
   * Enqueue a new image processing job
   */
  public async addJob(
    payload: JobPayload,
    options?: { priority?: JobPriority; maxRetries?: number; maxAttempts?: number }
  ): Promise<JobRecord> {
    if (this.closed) {
      this.closed = false;
    }

    const priorityTag: JobPriority =
      options?.priority ||
      payload.priority ||
      inferJobPriority(payload.toolName, payload.toolArgs || {});

    const priorityWeight = PRIORITY_WEIGHTS[priorityTag] ?? 5;
    const maxRetries = options?.maxRetries ?? options?.maxAttempts ?? payload.maxRetries ?? payload.maxAttempts ?? 3;
    const jobId = payload.id || (payload as any).jobId || `job_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;

    const record: JobRecord = {
      id: jobId,
      name: payload.toolName,
      fingerprint: payload.fingerprint,
      agentName: payload.agentName || "Autonomous AI Agent",
      toolName: payload.toolName,
      toolArgs: payload.toolArgs || {},
      cost: payload.cost ?? 1,
      costDeducted: 0,
      data: {
        ...payload,
        id: jobId,
        priority: priorityTag,
        maxRetries
      },
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attemptsMade: 0,
      maxAttempts: maxRetries,
      maxRetries,
      priority: priorityWeight,
      priorityTag,
      createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
      startedAt: null,
      processedAt: null,
      completedAt: null,
      failedAt: null,
      failedReason: null,
      runAt: null
    };

    this.jobs.set(record.id, record);

    // Emit standardized events
    this.emit("queued", record);
    this.emit("waiting", record.id);
    this.emit("job:enqueued", record);

    return { ...record };
  }

  /**
   * Alias for addJob
   */
  public async enqueue(
    payload: JobPayload,
    options?: { priority?: JobPriority; maxRetries?: number; maxAttempts?: number }
  ): Promise<JobRecord> {
    return this.addJob(payload, options);
  }

  /**
   * Retrieve a job by its unique identifier
   */
  public async getJob(jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { ...job };
  }

  /**
   * List jobs with optional status filter and pagination
   */
  public async getJobs(statuses?: JobStatus[], start = 0, end = -1): Promise<JobRecord[]> {
    let list = Array.from(this.jobs.values());
    if (statuses && statuses.length > 0) {
      list = list.filter((j) => statuses.includes(j.status));
    }
    list.sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
    const sliced = end === -1 ? list.slice(start) : list.slice(start, end);
    return sliced.map((j) => ({ ...j }));
  }

  /**
   * List jobs with rich filters (fingerprint, status, etc.)
   */
  public async listJobs(filter: {
    fingerprint?: string;
    status?: JobStatus;
    statuses?: JobStatus[];
    start?: number;
    end?: number;
  } = {}): Promise<JobRecord[]> {
    let list = Array.from(this.jobs.values());

    if (filter.fingerprint) {
      list = list.filter((j) => j.fingerprint === filter.fingerprint);
    }

    if (filter.status) {
      list = list.filter((j) => j.status === filter.status);
    } else if (filter.statuses && filter.statuses.length > 0) {
      list = list.filter((j) => filter.statuses!.includes(j.status));
    }

    list.sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());

    const start = filter.start ?? 0;
    const end = filter.end ?? -1;
    const sliced = end === -1 ? list.slice(start) : list.slice(start, end);

    return sliced.map((j) => ({ ...j }));
  }

  /**
   * Fetch the next available queued job according to priority & FIFO order
   */
  public async getNextQueuedJob(options?: { includeDelayed?: boolean }): Promise<JobRecord | null> {
    if (this.paused || this.closed) return null;

    const now = Date.now();
    const queuedJobs = Array.from(this.jobs.values())
      .filter((j) => {
        if (options?.includeDelayed) {
          return j.status === "queued" || j.status === "delayed";
        }
        if (j.status !== "queued") return false;
        if (j.runAt && new Date(j.runAt).getTime() > now) return false;
        return true;
      })
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());

    if (queuedJobs.length === 0) return null;
    const selected = queuedJobs[0];
    selected.status = "active";
    return { ...selected };
  }

  /**
   * Update fine-grained progress percentage (0 to 100)
   */
  public async updateJobProgress(jobId: string, progress: number, stage?: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = Math.min(100, Math.max(0, Math.round(progress)));

    const eventPayload = {
      jobId,
      id: jobId,
      progress: job.progress,
      stage,
      timestamp: new Date().toISOString()
    };

    this.emit("progress", eventPayload);
    this.emit("job:progress", { jobId, progress: job.progress });
  }

  /**
   * Update lifecycle status of a job
   */
  public async updateJobStatus(jobId: string, status: JobStatus, updatesOrResultOrError?: any): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Terminal state immutability defense
    if ((job.status === "completed" || job.status === "failed") && status !== "completed" && status !== "failed") {
      return;
    }

    job.status = status;

    if (status === "active") {
      const startedAt = updatesOrResultOrError?.startedAt ? new Date(updatesOrResultOrError.startedAt) : new Date();
      job.startedAt = startedAt;
      job.processedAt = startedAt;
      job.runAt = null;
      if (updatesOrResultOrError?.attemptsMade !== undefined) {
        job.attemptsMade = updatesOrResultOrError.attemptsMade;
      } else {
        job.attemptsMade++;
      }
      if (updatesOrResultOrError?.progress !== undefined) {
        job.progress = updatesOrResultOrError.progress;
      }
      this.emit("active", job);
      this.emit("job:active", { jobId, attempt: job.attemptsMade });
    } else if (status === "completed") {
      const completedAt = updatesOrResultOrError?.completedAt ? new Date(updatesOrResultOrError.completedAt) : new Date();
      job.completedAt = completedAt;
      job.progress = 100;
      job.runAt = null;

      if (updatesOrResultOrError?.result !== undefined) {
        job.result = updatesOrResultOrError.result;
      } else if (updatesOrResultOrError !== undefined) {
        job.result = updatesOrResultOrError;
      }

      if (updatesOrResultOrError?.costDeducted !== undefined) {
        job.costDeducted = updatesOrResultOrError.costDeducted;
      } else {
        job.costDeducted = job.cost;
      }

      if (updatesOrResultOrError?.balanceAfter !== undefined) {
        job.balanceAfter = updatesOrResultOrError.balanceAfter;
      }

      this.emit("completed", job);
      this.emit("job:completed", {
        jobId,
        result: job.result,
        durationMs: updatesOrResultOrError?.durationMs
      });
    } else if (status === "failed") {
      const failedAt = updatesOrResultOrError?.failedAt ? new Date(updatesOrResultOrError.failedAt) : new Date();
      job.failedAt = failedAt;
      job.completedAt = failedAt;
      job.costDeducted = 0;
      job.runAt = null;

      const errMsg = typeof updatesOrResultOrError === "string"
        ? updatesOrResultOrError
        : updatesOrResultOrError?.error || updatesOrResultOrError?.failedReason || updatesOrResultOrError?.message || "Job execution failed";

      job.error = errMsg;
      job.failedReason = errMsg;

      this.emit("failed", job);
      this.emit("job:failed", {
        jobId,
        error: errMsg,
        costDeducted: 0,
        attemptsMade: job.attemptsMade
      });
    } else if (status === "delayed") {
      job.progress = updatesOrResultOrError?.progress ?? 0;
      if (updatesOrResultOrError?.error) {
        job.error = updatesOrResultOrError.error;
      }
      if (updatesOrResultOrError?.runAt) {
        job.runAt = new Date(updatesOrResultOrError.runAt);
      }
      this.emit("delayed", job as any);
      this.emit("job:delayed", { jobId, delayMs: updatesOrResultOrError?.delayMs ?? 0 } as any);
    } else if (status === "queued") {
      job.progress = updatesOrResultOrError?.progress ?? 0;
      if (updatesOrResultOrError?.runAt) {
        job.runAt = new Date(updatesOrResultOrError.runAt);
      } else {
        job.runAt = null;
      }
      if (updatesOrResultOrError?.error) {
        job.error = updatesOrResultOrError.error;
      }
      this.emit("queued", job);
      this.emit("job:enqueued", job);
    }
  }

  /**
   * Requeue a job (e.g. for retry)
   */
  public async requeueJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Terminal state immutability defense: never re-open completed or failed jobs!
    if (job.status === "completed" || job.status === "failed") {
      return;
    }

    job.status = "queued";
    job.runAt = null;
    job.progress = 0;
    this.emit("queued", job);
    this.emit("job:enqueued", job);
  }

  /**
   * Remove a job by ID
   */
  public async removeJob(jobId: string): Promise<boolean> {
    return this.jobs.delete(jobId);
  }

  /**
   * Pause job processing
   */
  public async pause(): Promise<void> {
    this.paused = true;
  }

  /**
   * Resume job processing
   */
  public async resume(): Promise<void> {
    this.paused = false;
  }

  /**
   * Check if queue is paused
   */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * Count jobs by status
   */
  public async getJobCounts(): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    };

    for (const job of this.jobs.values()) {
      if (counts[job.status] !== undefined) {
        counts[job.status]++;
      }
    }

    return counts;
  }

  /**
   * Is this a BullMQ backend?
   */
  public isBullMQ(): boolean {
    return false;
  }

  /**
   * Is this queue closed?
   */
  public isClosed(): boolean {
    return this.closed;
  }

  public getQueueName(): string {
    return this.name;
  }

  public async getRedisConnection(): Promise<any> {
    return null;
  }

  /**
   * Reset all queue state and clear all timers and listeners
   */
  public reset(): void {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.jobs.clear();
    this.paused = false;
    this.removeAllListeners();
  }

  /**
   * Graceful close of queue
   */
  public async close(): Promise<void> {
    this.reset();
    this.closed = true;
  }
}

// ============================================================================
// 3. BullMQ Job Queue Adapter Implementation
// ============================================================================

export class BullMQJobQueueAdapter extends EventEmitter implements JobQueueInterface {
  public name: string;
  private queue: any = null;
  private queueEvents: any = null;
  private redisUrl: string;
  private redisConnection: any = null;
  private closed = false;

  constructor(name = "pixelmesh-jobs", redisUrl: string) {
    super();
    this.name = name;
    this.redisUrl = redisUrl;
    this.initBullMQ();
  }

  private initBullMQ(): void {
    try {
      const { Queue, QueueEvents } = require("bullmq");
      const IORedis = require("ioredis");

      this.redisConnection = new IORedis(this.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true
      });

      this.queue = new Queue(this.name, {
        connection: this.redisConnection,
        prefix: "{pixelmesh:queue}"
      });

      this.queueEvents = new QueueEvents(this.name, {
        connection: this.redisConnection.duplicate(),
        prefix: "{pixelmesh:queue}"
      });

      this.setupEventForwarding();
    } catch (err) {
      console.warn("[BullMQJobQueueAdapter] Failed to initialize BullMQ. Falling back.", err);
    }
  }

  private setupEventForwarding(): void {
    if (!this.queueEvents) return;

    this.queueEvents.on("waiting", ({ jobId }: any) => this.emit("waiting", jobId));
    this.queueEvents.on("active", ({ jobId }: any) => this.emit("active", { id: jobId }));
    this.queueEvents.on("progress", ({ jobId, data }: any) => {
      this.emit("progress", {
        jobId,
        id: jobId,
        progress: typeof data === "number" ? data : data?.progress || 0,
        timestamp: new Date().toISOString()
      });
    });
    this.queueEvents.on("completed", ({ jobId, returnvalue }: any) => {
      this.emit("completed", {
        id: jobId,
        jobId,
        status: "completed",
        result: returnvalue
      } as any);
    });
    this.queueEvents.on("failed", ({ jobId, failedReason }: any) => {
      this.emit("failed", {
        id: jobId,
        jobId,
        status: "failed",
        error: failedReason,
        costDeducted: 0
      } as any);
    });
  }

  public async addJob(
    payload: JobPayload,
    options?: { priority?: JobPriority; maxRetries?: number; maxAttempts?: number }
  ): Promise<JobRecord> {
    const priorityTag = options?.priority || payload.priority || inferJobPriority(payload.toolName, payload.toolArgs || {});
    const priorityWeight = PRIORITY_WEIGHTS[priorityTag] ?? 5;
    const maxRetries = options?.maxRetries ?? options?.maxAttempts ?? payload.maxRetries ?? payload.maxAttempts ?? 3;
    const jobId = payload.id || (payload as any).jobId || `job_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;

    if (this.queue) {
      await this.queue.add(payload.toolName, payload, {
        jobId,
        priority: priorityWeight,
        attempts: maxRetries,
        backoff: {
          type: "exponential",
          delay: payload.backoffDelayMs ?? payload.backoffMs ?? 1000
        }
      });
    }

    const record: JobRecord = {
      id: jobId,
      name: payload.toolName,
      fingerprint: payload.fingerprint,
      agentName: payload.agentName || "Autonomous AI Agent",
      toolName: payload.toolName,
      toolArgs: payload.toolArgs || {},
      cost: payload.cost ?? 1,
      costDeducted: 0,
      data: { ...payload, id: jobId, priority: priorityTag, maxRetries },
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attemptsMade: 0,
      maxAttempts: maxRetries,
      maxRetries,
      priority: priorityWeight,
      priorityTag,
      createdAt: new Date(),
      startedAt: null,
      processedAt: null,
      completedAt: null,
      failedAt: null,
      failedReason: null
    };

    return record;
  }

  public async enqueue(
    payload: JobPayload,
    options?: { priority?: JobPriority; maxRetries?: number; maxAttempts?: number }
  ): Promise<JobRecord> {
    return this.addJob(payload, options);
  }

  public async getJob(jobId: string): Promise<JobRecord | null> {
    if (!this.queue) return null;
    const bullJob = await this.queue.getJob(jobId);
    if (!bullJob) return null;

    const state = await bullJob.getState();
    const status: JobStatus = state === "completed" ? "completed" : state === "failed" ? "failed" : state === "active" ? "active" : "queued";

    return {
      id: bullJob.id || jobId,
      name: bullJob.name,
      fingerprint: bullJob.data?.fingerprint,
      agentName: bullJob.data?.agentName,
      toolName: bullJob.data?.toolName || bullJob.name,
      toolArgs: bullJob.data?.toolArgs || {},
      cost: bullJob.data?.cost ?? 1,
      costDeducted: status === "completed" ? (bullJob.returnvalue?.costDeducted ?? bullJob.data?.cost ?? 1) : 0,
      data: bullJob.data,
      status,
      progress: bullJob.progress || 0,
      result: bullJob.returnvalue || null,
      error: bullJob.failedReason || null,
      attemptsMade: bullJob.attemptsMade,
      maxAttempts: bullJob.opts?.attempts || 3,
      maxRetries: bullJob.opts?.attempts || 3,
      priority: bullJob.opts?.priority || 5,
      priorityTag: (bullJob.data?.priority || "default") as JobPriority,
      createdAt: new Date(bullJob.timestamp),
      startedAt: bullJob.processedOn ? new Date(bullJob.processedOn) : null,
      processedAt: bullJob.processedOn ? new Date(bullJob.processedOn) : null,
      completedAt: bullJob.finishedOn ? new Date(bullJob.finishedOn) : null,
      failedAt: status === "failed" && bullJob.finishedOn ? new Date(bullJob.finishedOn) : null,
      failedReason: bullJob.failedReason || null
    };
  }

  public async getJobs(statuses?: JobStatus[], start = 0, end = -1): Promise<JobRecord[]> {
    if (!this.queue) return [];
    const bullTypes = statuses ? statuses.map((s) => (s === "queued" ? "waiting" : s)) : ["waiting", "active", "completed", "failed"];
    const jobs = await this.queue.getJobs(bullTypes, start, end === -1 ? 100 : end);
    const records: JobRecord[] = [];
    for (const j of jobs) {
      const rec = await this.getJob(j.id);
      if (rec) records.push(rec);
    }
    return records;
  }

  public async listJobs(filter: {
    fingerprint?: string;
    status?: JobStatus;
    statuses?: JobStatus[];
    start?: number;
    end?: number;
  } = {}): Promise<JobRecord[]> {
    const statuses = filter.status ? [filter.status] : filter.statuses;
    const all = await this.getJobs(statuses, filter.start, filter.end);
    if (filter.fingerprint) {
      return all.filter((j) => j.fingerprint === filter.fingerprint);
    }
    return all;
  }

  public async updateJobProgress(jobId: string, progress: number, stage?: string): Promise<void> {
    if (!this.queue) return;
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.updateProgress(progress);
    }
  }

  public async updateJobStatus(jobId: string, status: JobStatus, resultOrError?: any): Promise<void> {
    // In BullMQ, status transitions are managed by Worker execution
  }

  public async requeueJob(jobId: string): Promise<void> {
    if (!this.queue) return;
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state === "completed" || state === "failed") {
      return;
    }
    await job.retry();
  }

  public async getNextQueuedJob(options?: { includeDelayed?: boolean }): Promise<JobRecord | null> {
    const statuses: JobStatus[] = options?.includeDelayed ? ["queued", "delayed"] : ["queued"];
    const jobs = await this.getJobs(statuses, 0, 1);
    return jobs[0] || null;
  }

  public async removeJob(jobId: string): Promise<boolean> {
    if (!this.queue) return false;
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }

  public async pause(): Promise<void> {
    if (this.queue) await this.queue.pause();
  }

  public async resume(): Promise<void> {
    if (this.queue) await this.queue.resume();
  }

  public async isPaused(): Promise<boolean> {
    if (!this.queue) return false;
    return await this.queue.isPaused();
  }

  public async getJobCounts(): Promise<Record<JobStatus, number>> {
    if (!this.queue) return { queued: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    const counts = await this.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    return {
      queued: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0
    };
  }

  public isBullMQ(): boolean {
    return true;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public getQueueName(): string {
    return this.name;
  }

  public async getRedisConnection(): Promise<any> {
    return this.redisConnection;
  }

  public async reset(): Promise<void> {
    if (this.queue) {
      await this.queue.obliterate({ force: true }).catch(() => {});
    }
    this.removeAllListeners();
  }

  public async close(): Promise<void> {
    if (this.queueEvents) await this.queueEvents.close().catch(() => {});
    if (this.queue) await this.queue.close().catch(() => {});
    if (this.redisConnection) await this.redisConnection.quit().catch(() => {});
    this.closed = true;
    this.removeAllListeners();
  }
}

// ============================================================================
// 4. Unified JobQueue Class & Singleton Management
// ============================================================================

export type JobQueue = InMemoryJobQueue | BullMQJobQueueAdapter;

declare global {
  // eslint-disable-next-line no-var
  var __pixelmesh_queue__: JobQueue | undefined;
}

export function createJobQueue(name = "pixelmesh-jobs", config?: QueueConfig): JobQueue {
  const backend = config?.backend || (determineRedisBackend() === "ioredis" && process.env.REDIS_URL ? "bullmq" : "memory");
  const isProduction = process.env.NODE_ENV === "production";
  const allowMock = process.env.ALLOW_MOCK_IN_PRODUCTION === "true";
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build" || process.env.BUILD_PHASE === "true";

  if (backend === "bullmq" && process.env.REDIS_URL && !process.env.REDIS_URL.startsWith("memory:") && !process.env.REDIS_URL.startsWith("mock:")) {
    try {
      return new BullMQJobQueueAdapter(name, process.env.REDIS_URL);
    } catch (err) {
      if (isProduction && !allowMock && !isBuildPhase) {
        throw new Error(`[JobQueue] FATAL: Production failed to initialize BullMQ Redis queue: ${(err as Error).message}`);
      }
      console.warn("[JobQueue] BullMQ initialization failed. Falling back to InMemoryJobQueue.", err);
      return new InMemoryJobQueue(name, { concurrency: config?.concurrency });
    }
  }

  if (isProduction && !allowMock && !isBuildPhase) {
    throw new Error("[JobQueue] FATAL: Production requires BullMQ + Redis connection. Refusing to boot with in-memory queue.");
  }

  return new InMemoryJobQueue(name, { concurrency: config?.concurrency });
}

export function getJobQueue(name = "pixelmesh-jobs", config?: QueueConfig): JobQueue {
  if (globalThis.__pixelmesh_queue__) {
    return globalThis.__pixelmesh_queue__;
  }

  globalThis.__pixelmesh_queue__ = createJobQueue(name, config);
  return globalThis.__pixelmesh_queue__;
}

export const jobQueue: JobQueue = getJobQueue();

export function resetMockQueue(): void {
  const q = globalThis.__pixelmesh_queue__;
  if (q) {
    q.reset();
  }
}
