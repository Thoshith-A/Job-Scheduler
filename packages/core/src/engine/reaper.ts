import { sql, schema, eq, and } from "@flux/db";
import type { Database } from "@flux/db";
import type { EmitFn } from "../types";
import { noopEmit } from "../types";

const { jobs, jobExecutions, deadLetterQueue, workers } = schema;

export interface ReapResult {
  requeued: number;
  deadLettered: number;
}

/**
 * Dead-worker recovery. Reclaim jobs whose lease has expired — i.e. the worker holding
 * them stopped heartbeating (crashed, was killed, or partitioned). Recovery keys off the
 * **lease**, never a wall-clock timeout, so a slow-but-alive worker (which keeps extending
 * its lease via heartbeats) is never wrongly reclaimed.
 *
 * Each reclaimed job:
 *   - has its still-"running" execution row marked `lost`,
 *   - is requeued (`status='queued'`, run immediately) if attempts remain, or
 *   - is dead-lettered (`lease_expired_max_attempts`) if it has exhausted them.
 *
 * `FOR UPDATE SKIP LOCKED` lets multiple scheduler/reaper replicas run this safely in
 * parallel without reclaiming the same job twice. Processes up to `batch` jobs per call.
 */
export async function reapExpiredLeases(
  db: Database,
  opts: { batch?: number; emit?: EmitFn } = {},
): Promise<ReapResult> {
  const batch = opts.batch ?? 100;
  const emit = opts.emit ?? noopEmit;
  const result: ReapResult = { requeued: 0, deadLettered: 0 };

  const events: Array<{ jobId: string; queueId: string; requeued: boolean; attempts: number }> = [];

  await db.transaction(async (tx) => {
    const expired = await tx.execute<{
      id: string;
      queue_id: string;
      attempts: number;
      max_attempts: number;
    }>(sql`
      SELECT id, queue_id, attempts, max_attempts
      FROM jobs
      WHERE status IN ('claimed','running') AND lease_expires_at < now()
      ORDER BY lease_expires_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    `);

    for (const job of expired.rows) {
      // Any attempt that was mid-flight when the worker died is lost.
      await tx
        .update(jobExecutions)
        .set({ status: "lost", finishedAt: new Date() })
        .where(and(eq(jobExecutions.jobId, job.id), eq(jobExecutions.status, "running")));

      if (job.attempts < job.max_attempts) {
        await tx
          .update(jobs)
          .set({
            status: "queued",
            runAt: new Date(),
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            lastError: "reclaimed after worker lease expired",
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, job.id));
        result.requeued += 1;
        events.push({ jobId: job.id, queueId: job.queue_id, requeued: true, attempts: job.attempts });
      } else {
        await tx
          .update(jobs)
          .set({
            status: "dead",
            claimedBy: null,
            leaseExpiresAt: null,
            finishedAt: new Date(),
            lastError: "worker lease expired with no attempts remaining",
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, job.id));
        await tx
          .insert(deadLetterQueue)
          .values({
            jobId: job.id,
            queueId: job.queue_id,
            reason: "lease_expired_max_attempts",
            finalError: "worker lease expired with no attempts remaining",
            attempts: job.attempts,
          })
          .onConflictDoNothing({ target: deadLetterQueue.jobId });
        result.deadLettered += 1;
        events.push({ jobId: job.id, queueId: job.queue_id, requeued: false, attempts: job.attempts });
      }
    }
  });

  for (const e of events) {
    const at = new Date().toISOString();
    if (e.requeued) {
      emit({ kind: "job.created", queueId: e.queueId, jobId: e.jobId, status: "queued", at });
    } else {
      emit({ kind: "job.dead", queueId: e.queueId, jobId: e.jobId, reason: "lease_expired_max_attempts", at });
    }
  }
  return result;
}

/**
 * Mark workers whose heartbeat has gone stale as `dead` (fleet-view bookkeeping). The
 * jobs those workers held are recovered independently by {@link reapExpiredLeases}; this
 * just updates the visible worker roster and emits `worker.dead`.
 */
export async function reapDeadWorkers(
  db: Database,
  opts: { staleMs: number; emit?: EmitFn },
): Promise<string[]> {
  const emit = opts.emit ?? noopEmit;
  const cutoff = new Date(Date.now() - opts.staleMs);
  const dead = await db
    .update(workers)
    .set({ status: "dead" })
    .where(
      and(
        sql`${workers.status} IN ('starting','active','draining')`,
        sql`${workers.lastHeartbeatAt} < ${cutoff}`,
      ),
    )
    .returning({ id: workers.id });

  for (const w of dead) {
    emit({ kind: "worker.dead", workerId: w.id, reclaimedJobs: 0, at: new Date().toISOString() });
  }
  return dead.map((w) => w.id);
}
