/**
 * Mirror of the Flux REST/WS contract the dashboard consumes. Kept as a local,
 * dependency-free copy (rather than importing @flux/shared) so the web app can be
 * built and typechecked in isolation. Field names match the API responses exactly.
 */

export type JobStatus =
  | "scheduled"
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "dead"
  | "canceled";

export type JobType = "immediate" | "delayed" | "scheduled" | "recurring" | "batch";

export type ExecutionStatus = "running" | "completed" | "failed" | "timed_out" | "lost";

export type WorkerStatus = "starting" | "active" | "draining" | "dead" | "stopped";

export type OrgRole = "owner" | "admin" | "member";

export type DlqReason =
  | "max_attempts_exhausted"
  | "non_retryable_error"
  | "lease_expired_max_attempts"
  | "manually_killed";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RATE_LIMITED"
  | "QUEUE_PAUSED"
  | "INVALID_CRON"
  | "INVALID_STATE_TRANSITION"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: string;
  code: ErrorCode;
  details?: unknown;
  requestId: string;
  statusCode: number;
}

/* ── Auth / tenancy ───────────────────────────────────────────────────────── */

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  createdAt?: string;
}

export interface AuthResult {
  user: User;
  organization?: Organization;
  accessToken: string;
  refreshToken: string;
}

export interface MeResult {
  user: User;
  organizations: Organization[];
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt?: string;
}

/* ── Queues ───────────────────────────────────────────────────────────────── */

export interface Queue {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  priorityDefault: number;
  concurrencyLimit: number;
  retryPolicyId: string | null;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStats {
  queueId: string;
  depth: number;
  scheduled: number;
  running: number;
  completed: number;
  dead: number;
  countsByStatus: Partial<Record<JobStatus, number>>;
  lastHour: {
    completed: number;
    failed: number;
    throughputPerMin: number;
    avgDurationMs: number;
    p95DurationMs: number;
    failureRate: number;
  };
}

/* ── Jobs ─────────────────────────────────────────────────────────────────── */

export interface Job {
  id: string;
  projectId: string;
  queueId: string;
  name: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  priority: number;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  idempotencyKey?: string | null;
  claimedBy: string | null;
  claimedAt?: string | null;
  leaseExpiresAt?: string | null;
  batchId?: string | null;
  parentJobId?: string | null;
  scheduleId?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobExecution {
  id: string;
  jobId: string;
  workerId: string | null;
  attemptNo: number;
  status: ExecutionStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface JobLog {
  id: string;
  jobId: string;
  executionId: string | null;
  level: string;
  message: string;
  ts: string;
}

export interface DeadLetter {
  id?: string;
  jobId?: string;
  queueId?: string;
  reason: DlqReason;
  finalError: string | null;
  attempts: number;
  deadAt: string;
}

export interface JobDetail {
  job: Job;
  executions: JobExecution[];
  logs: JobLog[];
  deadLetter: DeadLetter | null;
  worker: Worker | null;
}

export interface AiSummary {
  jobId: string;
  summary: string;
  source: "anthropic" | "heuristic";
  model?: string;
}

/* ── Workers ──────────────────────────────────────────────────────────────── */

export interface Worker {
  id: string;
  projectId: string | null;
  host: string;
  pid: number | null;
  status: WorkerStatus;
  concurrency: number;
  inFlightCount: number;
  startedAt: string;
  lastHeartbeatAt: string;
  stoppedAt: string | null;
  alive: boolean;
}

/* ── Monitoring ───────────────────────────────────────────────────────────── */

export interface Overview {
  countsByStatus: Partial<Record<JobStatus, number>>;
  completedLastMinute: number;
}

export interface Schedule {
  id: string;
  projectId: string;
  queueId: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt?: string;
}

export interface DlqEntry {
  id: string;
  jobId: string;
  queueId: string;
  reason: DlqReason;
  finalError: string | null;
  attempts: number;
  deadAt: string;
  jobName: string;
  jobType: JobType;
}

/* ── Pagination ───────────────────────────────────────────────────────────── */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/* ── Job creation ─────────────────────────────────────────────────────────── */

export type CreateJobBody =
  | { type: "immediate"; name: string; payload?: Record<string, unknown>; priority?: number; maxAttempts?: number }
  | { type: "delayed"; name: string; payload?: Record<string, unknown>; delayMs: number; priority?: number; maxAttempts?: number }
  | { type: "scheduled"; name: string; payload?: Record<string, unknown>; runAt: string; priority?: number; maxAttempts?: number }
  | { type: "recurring"; name: string; payload?: Record<string, unknown>; cron: string; timezone?: string; priority?: number; maxAttempts?: number }
  | { type: "batch"; name: string; payloads: Record<string, unknown>[]; priority?: number; maxAttempts?: number };

export type CreateJobResult =
  | { kind: "job"; job: Job; deduplicated: boolean }
  | { kind: "batch"; batchId: string; count: number; jobIds: string[] }
  | { kind: "schedule"; schedule: Schedule };

/* ── WebSocket events ─────────────────────────────────────────────────────── */

export type FluxEvent =
  | { kind: "job.created"; queueId: string; jobId: string; status: JobStatus; at: string }
  | { kind: "job.claimed"; queueId: string; jobId: string; workerId: string; at: string }
  | { kind: "job.started"; queueId: string; jobId: string; workerId: string; at: string }
  | { kind: "job.completed"; queueId: string; jobId: string; workerId: string; durationMs: number; at: string }
  | { kind: "job.failed"; queueId: string; jobId: string; workerId: string; willRetry: boolean; attempt: number; error: string; at: string }
  | { kind: "job.dead"; queueId: string; jobId: string; reason: string; at: string }
  | { kind: "job.log"; jobId: string; executionId: string; level: string; message: string; at: string }
  | { kind: "worker.registered"; workerId: string; host: string; at: string }
  | { kind: "worker.heartbeat"; workerId: string; status: WorkerStatus; inFlight: number; at: string }
  | { kind: "worker.dead"; workerId: string; reclaimedJobs: number; at: string }
  | { kind: "worker.stopped"; workerId: string; at: string }
  | { kind: "queue.stats"; queueId: string; depth: number; running: number; at: string };

export type FluxEventKind = FluxEvent["kind"];
