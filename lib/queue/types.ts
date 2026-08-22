/**
 * PixelMesh Phase 3 - Background Task Queue Types
 * 
 * Standard domain model for asynchronous image processing jobs,
 * worker processing, priority scheduling, and event emission.
 */

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'delayed';

export type JobPriority = 'fast' | 'default' | 'batch';

export interface PriorityMapping {
  fast: 1;      // Highest priority (lightweight single filters, metadata)
  default: 5;   // Normal priority (standard filters, effects)
  batch: 10;    // Lowest priority / high compute (pipelines, high-res transforms)
}

export const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  fast: 1,
  default: 5,
  batch: 10
};

export type ReturnType = 'base64' | 'storage' | 'url';

export interface JobPayload {
  id?: string;                               // Optional unique job identifier (auto-generated if omitted)
  fingerprint: string;                       // Agent SHA-256 public key fingerprint
  agentName: string;                         // Agent identifier / display name
  toolName: string;                          // MCP tool name (e.g. crop_image, batch_filter_pipeline)
  toolArgs: Record<string, any>;             // Input parameters (image_base64, image_key, ops, etc.)
  cost: number;                              // Credits to deduct upon successful completion
  returnType?: ReturnType;                   // Preferred output format (default: 'base64')
  priority?: JobPriority;                    // Job priority tag (default: 'default')
  maxRetries?: number;                       // Max retry attempts on failure (default: 3)
  maxAttempts?: number;                      // Alias for maxRetries
  backoffDelayMs?: number;                   // Base delay for exponential backoff (default: 1000ms)
  backoffMs?: number;                        // Alias for backoffDelayMs
  createdAt?: string;                        // ISO-8601 creation timestamp
  metadata?: Record<string, any>;            // Optional contextual metadata
}

export interface JobResult<T = any> {
  id?: string;
  status: 'completed' | 'failed' | 'queued' | 'delayed';
  result?: T;                                // Result payload (content, image_base64, storage key, metadata)
  error?: string;                            // Error message if failed
  costDeducted: number;                      // Exactly equal to `cost` on success, 0 on failure
  balanceAfter?: number;                     // Agent credits balance after deduction
  durationMs: number;                        // Total execution time in milliseconds
  completedAt?: string;                      // ISO-8601 completion timestamp
  failedAt?: string;                         // ISO-8601 failure timestamp
  attemptsMade?: number;                     // Number of attempts performed
  retryCount?: number;                       // Number of retries performed
}

export interface JobRecord<T = JobPayload, R = JobResult> {
  id: string;
  name: string;
  fingerprint: string;
  agentName: string;
  toolName: string;
  toolArgs: Record<string, any>;
  cost: number;
  costDeducted: number;
  data: T;
  status: JobStatus;
  progress: number;                          // Integer percentage (0 to 100)
  result: R | null | any;
  error: string | null;
  attemptsMade: number;
  maxAttempts: number;
  maxRetries: number;
  priority: number;
  priorityTag: JobPriority;
  createdAt: Date;
  startedAt: Date | null;
  processedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  failedReason: string | null;
  runAt?: Date | null;
  balanceAfter?: number;
  stacktrace?: string[];
}

export type Job = JobRecord;

export interface QueueConfig {
  backend?: 'bullmq' | 'memory' | 'auto';
  queueName?: string;
  redisUrl?: string;
  concurrency?: number;                      // Max concurrent jobs per worker (default: 5)
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: 'exponential' | 'fixed';
      delay: number;
    };
    removeOnComplete?: boolean | number | { age?: number; count?: number };
    removeOnFail?: boolean | number | { age?: number; count?: number };
  };
  prefix?: string;                           // Redis key prefix (default: 'pixelmesh:jobs')
  isTest?: boolean;
}

export interface WorkerOptions {
  queue?: any;
  concurrency?: number;
  maxRetries?: number;
  maxAttempts?: number;
  backoffDelayMs?: number;
  backoffMs?: number;
  drainDelayMs?: number;
  pollIntervalMs?: number;
  shutdownTimeoutMs?: number;
  autoStart?: boolean;
}

export interface JobProgressEvent {
  jobId: string;
  progress: number;
  stage?: string;
  timestamp: string;
}

export interface JobCompletedEvent {
  jobId: string;
  result: JobResult;
  timestamp: string;
  durationMs?: number;
}

export interface JobFailedEvent {
  jobId: string;
  error: string;
  costDeducted: 0;
  attemptsMade: number;
  timestamp: string;
}

export interface JobRetryEvent {
  jobId: string;
  attempt: number;
  nextAttempt: number;
  delayMs: number;
  error: string;
}

export type QueueEventMap = {
  waiting: (jobId: string) => void;
  queued: (job: JobRecord) => void;
  delayed?: (job: JobRecord) => void;
  active: (job: JobRecord | { id: string } | string) => void;
  progress: (event: JobProgressEvent | JobRecord) => void;
  completed: (event: JobCompletedEvent | JobRecord) => void;
  failed: (event: JobFailedEvent | JobRecord) => void;
  retry: (event: JobRetryEvent) => void;
  cleaned: (count: number) => void;
  "job:enqueued": (job: JobRecord) => void;
  "job:delayed"?: (event: { jobId: string; delayMs: number }) => void;
  "job:active": (event: { jobId: string; attempt: number }) => void;
  "job:progress": (event: { jobId: string; progress: number }) => void;
  "job:completed": (event: { jobId: string; result: any; durationMs?: number }) => void;
  "job:failed": (event: { jobId: string; error: string; attemptsMade?: number; costDeducted: 0 }) => void;
  "job:retry": (event: JobRetryEvent) => void;
};

export interface JobQueueInterface {
  name: string;
  addJob(payload: JobPayload, options?: { priority?: JobPriority; maxRetries?: number; maxAttempts?: number }): Promise<JobRecord>;
  enqueue(payload: JobPayload, options?: { priority?: JobPriority; maxRetries?: number; maxAttempts?: number }): Promise<JobRecord>;
  getJob(jobId: string): Promise<JobRecord | null>;
  getJobs(statuses?: JobStatus[], start?: number, end?: number): Promise<JobRecord[]>;
  listJobs(filter?: { fingerprint?: string; status?: JobStatus; statuses?: JobStatus[]; start?: number; end?: number }): Promise<JobRecord[]>;
  updateJobProgress(jobId: string, progress: number, stage?: string): Promise<void>;
  updateJobStatus(jobId: string, status: JobStatus, resultOrErrorOrUpdates?: any): Promise<void>;
  removeJob(jobId: string): Promise<boolean>;
  requeueJob(jobId: string): Promise<void>;
  getNextQueuedJob(options?: { includeDelayed?: boolean }): Promise<JobRecord | null>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  isPaused(): Promise<boolean> | boolean;
  getJobCounts(): Promise<Record<JobStatus, number>>;
  
  // Cleanup & Teardown Lifecycle
  close(): Promise<void>;
  reset(): Promise<void> | void;
}
