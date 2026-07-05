/**
 * Canonical enums shared by the database schema, the API DTOs, the worker/scheduler,
 * and the frontend. Declared as `as const` string tuples so they can double as:
 *   - Drizzle `pgEnum(...)` value lists
 *   - Zod `z.enum(...)` inputs
 *   - discriminated-union TypeScript types
 * Keeping a single source of truth here prevents drift between the DB and the code.
 */

/**
 * Job lifecycle.
 *
 *   scheduled  -> not yet runnable; waiting for `run_at` (delayed / scheduled / cron
 *                 instances / retry-backoff jobs all rest here). The scheduler promotes
 *                 these to `queued` once due.
 *   queued     -> runnable NOW; awaiting an atomic worker claim. `queued` always means ready.
 *   claimed    -> a worker atomically claimed it (holds a time-boxed lease) and is about to run.
 *   running    -> a worker is executing it.
 *   completed  -> succeeded (terminal).
 *   failed     -> latest attempt failed; primarily an *execution*-level state, retained here
 *                 for jobs parked as failed without auto-retry.
 *   dead       -> retries exhausted; a `dead_letter_queue` row exists (terminal unless retried).
 *   canceled   -> canceled by an operator (terminal).
 */
export const JOB_STATUSES = [
  "scheduled",
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "dead",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses from which a worker may pick up work / that are not yet terminal. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  "scheduled",
  "queued",
  "claimed",
  "running",
];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "completed",
  "dead",
  "canceled",
];

/** How a job was created — drives its initial status and `run_at`. */
export const JOB_TYPES = [
  "immediate",
  "delayed",
  "scheduled",
  "recurring",
  "batch",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** One row per execution attempt lives in `job_executions`. */
export const EXECUTION_STATUSES = [
  "running",
  "completed",
  "failed",
  "timed_out",
  "lost",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * Worker lifecycle, derived from heartbeats.
 *   starting -> registered, not yet claiming
 *   active   -> heartbeating and claiming
 *   draining -> received SIGTERM; finishing in-flight work, no new claims
 *   dead     -> lease/heartbeat expired; the reaper reclaims its jobs
 *   stopped  -> deregistered cleanly
 */
export const WORKER_STATUSES = [
  "starting",
  "active",
  "draining",
  "dead",
  "stopped",
] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

/** Organization RBAC roles, most-privileged first. */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Backoff strategies for retry policies. */
export const RETRY_STRATEGIES = ["fixed", "linear", "exponential"] as const;
export type RetryStrategy = (typeof RETRY_STRATEGIES)[number];

/** Reasons a job lands in the dead-letter queue. */
export const DLQ_REASONS = [
  "max_attempts_exhausted",
  "non_retryable_error",
  "lease_expired_max_attempts",
  "manually_killed",
] as const;
export type DlqReason = (typeof DLQ_REASONS)[number];
