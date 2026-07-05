import { schema, eq, and, sql } from "@flux/db";
import type { Database } from "@flux/db";
import type { DlqReason } from "@flux/shared";
import type { ClaimedJob, EmitFn } from "../types";
import { noopEmit } from "../types";
import { computeBackoffMs, DEFAULT_RETRY_POLICY, type RetryPolicySpec } from "../retry-policy";

const { jobs, jobExecutions, jobLogs, deadLetterQueue, queues, retryPolicies } = schema;

/** Resolve the effective retry policy for a queue (its policy, or engine defaults). */
export async function resolveRetryPolicy(db: Database, queueId: string): Promise<RetryPolicySpec> {
  const [row] = await db
    .select({
      strategy: retryPolicies.strategy,
      maxAttempts: retryPolicies.maxAttempts,
      baseDelayMs: retryPolicies.baseDelayMs,
      maxDelayMs: retryPolicies.maxDelayMs,
      jitter: retryPolicies.jitter,
    })
    .from(queues)
    .leftJoin(retryPolicies, eq(queues.retryPolicyId, retryPolicies.id))
    .where(eq(queues.id, queueId));

  if (!row || row.strategy === null) return DEFAULT_RETRY_POLICY;
  return {
    strategy: row.strategy,
    maxAttempts: row.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
    baseDelayMs: row.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
    maxDelayMs: row.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
    jitter: row.jitter ?? DEFAULT_RETRY_POLICY.jitter,
  };
}

export interface BeginResult {
  executionId: string;
  attemptNo: number;
}

/**
 * Transition a claimed job into `running` and open a new `job_executions` row.
 * `attempts` is bumped here (attempt N), and the execution row's `(job_id, attempt_no)`
 * unique constraint is a hard, DB-level guard against the same attempt running twice.
 * Guarded by `status='claimed'` so a reaped/stolen job can't be double-started.
 */
export async function beginExecution(
  db: Database,
  job: ClaimedJob,
  workerId: string,
  emit: EmitFn = noopEmit,
): Promise<BeginResult | null> {
  const attemptNo = job.attempts + 1;
  return db.transaction(async (tx) => {
    const updated = await tx.execute(
      sql`UPDATE jobs SET status='running', attempts=${attemptNo},
              started_at = COALESCE(started_at, now()), updated_at = now()
          WHERE id = ${job.id} AND status = 'claimed' AND claimed_by = ${workerId}`,
    );
    // Lost the race (reaped, canceled, or stolen) — do not start.
    if (updated.rowCount === 0) return null;

    const [exec] = await tx
      .insert(jobExecutions)
      .values({ jobId: job.id, workerId, attemptNo, status: "running" })
      .returning({ id: jobExecutions.id });

    emit({
      kind: "job.started",
      queueId: job.queueId,
      jobId: job.id,
      workerId,
      at: new Date().toISOString(),
    });
    return { executionId: exec!.id, attemptNo };
  });
}

/** Mark a running job (and its execution) completed. */
export async function completeJob(
  db: Database,
  args: {
    job: ClaimedJob;
    executionId: string;
    workerId: string;
    durationMs: number;
  },
  emit: EmitFn = noopEmit,
): Promise<void> {
  const { job, executionId, workerId, durationMs } = args;
  await db.transaction(async (tx) => {
    await tx
      .update(jobExecutions)
      .set({ status: "completed", finishedAt: new Date(), durationMs })
      .where(eq(jobExecutions.id, executionId));
    await tx
      .update(jobs)
      .set({
        status: "completed",
        finishedAt: new Date(),
        lastError: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
  });
  emit({
    kind: "job.completed",
    queueId: job.queueId,
    jobId: job.id,
    workerId,
    durationMs,
    at: new Date().toISOString(),
  });
}

/**
 * Mark an attempt failed and decide its fate:
 *  - retries remain and the error is retryable -> reschedule with backoff (status='scheduled',
 *    run_at = now + backoff). The scheduler promotes it to 'queued' when due.
 *  - otherwise -> move to the dead-letter queue (status='dead' + a dead_letter_queue row).
 */
export async function failJob(
  db: Database,
  args: {
    job: ClaimedJob;
    executionId: string;
    workerId: string;
    error: string;
    durationMs: number;
    policy: RetryPolicySpec;
    nonRetryable?: boolean;
    rng?: () => number;
  },
  emit: EmitFn = noopEmit,
): Promise<{ willRetry: boolean; nextRunAt: Date | null }> {
  const { job, executionId, workerId, error, durationMs, policy, nonRetryable, rng } = args;
  const attemptsSoFar = job.attempts; // already incremented in beginExecution
  // The job's own maxAttempts is the source of truth for the cap (it defaults from the
  // queue's retry policy at creation but can be overridden per job). The policy governs
  // the backoff *strategy/delays*.
  const willRetry = !nonRetryable && attemptsSoFar < job.maxAttempts;

  let nextRunAt: Date | null = null;
  await db.transaction(async (tx) => {
    await tx
      .update(jobExecutions)
      .set({ status: "failed", error, finishedAt: new Date(), durationMs })
      .where(eq(jobExecutions.id, executionId));

    if (willRetry) {
      const backoff = computeBackoffMs(policy, attemptsSoFar, rng);
      nextRunAt = new Date(Date.now() + backoff);
      await tx
        .update(jobs)
        .set({
          status: "scheduled",
          runAt: nextRunAt,
          lastError: error,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
    } else {
      await tx
        .update(jobs)
        .set({
          status: "dead",
          lastError: error,
          finishedAt: new Date(),
          claimedBy: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      const reason: DlqReason = nonRetryable ? "non_retryable_error" : "max_attempts_exhausted";
      await tx
        .insert(deadLetterQueue)
        .values({
          jobId: job.id,
          queueId: job.queueId,
          reason,
          finalError: error,
          attempts: attemptsSoFar,
        })
        .onConflictDoNothing({ target: deadLetterQueue.jobId });
    }
  });

  const at = new Date().toISOString();
  emit({
    kind: "job.failed",
    queueId: job.queueId,
    jobId: job.id,
    workerId,
    willRetry,
    attempt: attemptsSoFar,
    error,
    at,
  });
  if (!willRetry) {
    emit({
      kind: "job.dead",
      queueId: job.queueId,
      jobId: job.id,
      reason: nonRetryable ? "non_retryable_error" : "max_attempts_exhausted",
      at,
    });
  }
  return { willRetry, nextRunAt };
}

/** Stream a structured log line for a running job. */
export async function recordLog(
  db: Database,
  args: { jobId: string; executionId?: string; level?: string; message: string },
  emit: EmitFn = noopEmit,
): Promise<void> {
  const level = args.level ?? "info";
  const [row] = await db
    .insert(jobLogs)
    .values({
      jobId: args.jobId,
      executionId: args.executionId ?? null,
      level,
      message: args.message,
    })
    .returning({ id: jobLogs.id });
  emit({
    kind: "job.log",
    jobId: args.jobId,
    executionId: args.executionId ?? "",
    level,
    message: args.message,
    at: new Date().toISOString(),
  });
  void row;
}
