import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobStatusEnum, jobTypeEnum, executionStatusEnum, dlqReasonEnum } from "./enums";
import { projects } from "./auth";
import { queues, schedules } from "./catalog";
import { workers } from "./workers";

/**
 * jobs — the queue itself. This table IS the message queue; there is no Redis/Bull
 * behind it. Correctness of the whole system rests on how rows here are claimed:
 * atomically, via `FOR UPDATE SKIP LOCKED` inside a transaction (see @flux/core).
 *
 * `projectId` is denormalised from the queue for fast project-scoped listing and to
 * scope tenant queries without an extra join on the hot read path.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>().default({}),
    priority: integer("priority").notNull().default(100),

    // Scheduling
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),

    // Retry accounting
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),

    // At-least-once + idempotency-key => effectively-once creation.
    idempotencyKey: text("idempotency_key"),

    // Claim / lease. `leaseExpiresAt` is the linchpin of dead-worker recovery: a claim
    // is only valid until this instant; heartbeats extend it, the reaper reclaims past it.
    claimedBy: uuid("claimed_by").references(() => workers.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),

    // Grouping / lineage
    batchId: uuid("batch_id"),
    parentJobId: uuid("parent_job_id"),
    scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "set null" }),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ── THE CLAIM HOT PATH ────────────────────────────────────────────────────
    // Workers claim with: WHERE status='queued' AND queue_id=$1 AND run_at<=now()
    //                     ORDER BY priority DESC, run_at ASC FOR UPDATE SKIP LOCKED.
    // A PARTIAL index over only 'queued' rows keeps the index small and hot even when
    // millions of completed jobs exist, and its column order matches the ORDER BY so
    // the planner reads pre-sorted rows (no sort node). This is the single most
    // performance-critical index in the schema.
    index("jobs_claim_idx")
      .on(t.queueId, t.priority.desc(), t.runAt.asc())
      .where(sql`${t.status} = 'queued'`),

    // ── THE REAPER PATH ───────────────────────────────────────────────────────
    // The reaper scans in-flight jobs whose lease has expired (dead worker).
    // Partial index over only claimed/running rows ordered by lease expiry.
    index("jobs_lease_idx")
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} in ('claimed','running')`),

    // ── THE SCHEDULER PROMOTION PATH ──────────────────────────────────────────
    // Promote 'scheduled' jobs (delayed/scheduled/retry-backoff) whose runAt is due.
    index("jobs_promote_idx")
      .on(t.runAt)
      .where(sql`${t.status} = 'scheduled'`),

    // Idempotency enforced by the DATABASE: at most one job per (queue, key).
    // Concurrent duplicate creates collide here rather than racing in app code.
    uniqueIndex("jobs_idempotency_key")
      .on(t.queueId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),

    // Job explorer: list a project's jobs newest-first, filter by status.
    index("jobs_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("jobs_queue_status_idx").on(t.queueId, t.status),
    // Batch drill-down.
    index("jobs_batch_idx").on(t.batchId).where(sql`${t.batchId} is not null`),
  ],
);

/**
 * job_executions — one row per attempt. Retrying a job appends a new row rather than
 * mutating the last, giving a complete, auditable attempt history and per-attempt
 * timing. `attemptNo` + `jobId` is unique so a bug that double-runs an attempt is
 * caught by the database, not just by a test assertion.
 */
export const jobExecutions = pgTable(
  "job_executions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workerId: uuid("worker_id").references(() => workers.id, { onDelete: "set null" }),
    attemptNo: integer("attempt_no").notNull(),
    status: executionStatusEnum("status").notNull().default("running"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("job_executions_job_idx").on(t.jobId),
    // Guarantees no attempt number is ever recorded twice for the same job —
    // a database-level backstop for "no double execution".
    uniqueIndex("job_executions_job_attempt_key").on(t.jobId, t.attemptNo),
  ],
);

/**
 * job_logs — structured log lines streamed from a running job, live-tailed by the UI.
 */
export const jobLogs = pgTable(
  "job_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id").references(() => jobExecutions.id, {
      onDelete: "cascade",
    }),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_logs_job_ts_idx").on(t.jobId, t.ts)],
);

/**
 * dead_letter_queue — jobs that exhausted their retries (or hit a non-retryable
 * error). Kept as a distinct table so operators can browse, triage, and bulk-retry
 * failures without scanning the whole jobs table, and so DLQ membership is a first
 * class fact (the reliability tests assert a job "lands in the DLQ").
 */
export const deadLetterQueue = pgTable(
  "dead_letter_queue",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    reason: dlqReasonEnum("reason").notNull(),
    finalError: text("final_error"),
    attempts: integer("attempts").notNull(),
    deadAt: timestamp("dead_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dlq_job_key").on(t.jobId),
    index("dlq_queue_idx").on(t.queueId, t.deadAt.desc()),
  ],
);
