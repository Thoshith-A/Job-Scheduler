import { sql, schema, and, eq, inArray } from "@flux/db";
import type { Database } from "@flux/db";
import { count } from "drizzle-orm";
import type { ClaimedJob, EmitFn } from "../types";
import { noopEmit } from "../types";

const { jobs } = schema;

export interface ClaimOptions {
  queueId: string;
  workerId: string;
  /** Max jobs this call wants (usually the worker's free capacity). */
  limit: number;
  /** Lease duration in seconds; the claim is valid until now()+lease. */
  leaseSeconds: number;
  emit?: EmitFn;
}

/** Count jobs currently occupying a queue's concurrency budget (claimed or running). */
export async function countQueueRunning(db: Database, queueId: string): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(jobs)
    .where(and(eq(jobs.queueId, queueId), inArray(jobs.status, ["claimed", "running"])));
  return row?.c ?? 0;
}

/**
 * Atomically claim up to `limit` due jobs from a queue for a worker.
 *
 * Correctness is the whole point of this function:
 *
 *  1. A per-queue **advisory transaction lock** serialises claims *for this queue only*
 *     (other queues proceed in parallel). This makes the concurrency-limit check below
 *     authoritative: without it, two workers could both read `running=R`, both claim up
 *     to `limit-R` *different* rows (SKIP LOCKED hands them disjoint rows), and together
 *     exceed the limit. The lock is held only for the microseconds of the UPDATE and
 *     released at COMMIT.
 *
 *  2. Respect `paused` and the fleet-wide `concurrency_limit`.
 *
 *  3. The claim itself is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 *     LOCKED)` — the canonical Postgres work-queue pattern. Two workers never receive the
 *     same row: the first locks it, the second skips it. `jobs_claim_idx` (partial, over
 *     only `queued` rows, ordered priority DESC/run_at ASC) makes the inner select a
 *     pre-sorted index scan.
 *
 * Returns the claimed jobs (possibly empty).
 */
export async function claimJobs(db: Database, opts: ClaimOptions): Promise<ClaimedJob[]> {
  const { queueId, workerId, limit, leaseSeconds } = opts;
  const emit = opts.emit ?? noopEmit;
  if (limit <= 0) return [];

  const claimed = await db.transaction(async (tx) => {
    // (1) Serialise claims for this queue.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${queueId}))`);

    // (2) Capacity check — paused queues yield nothing.
    const queueRes = await tx.execute<{ concurrency_limit: number; paused: boolean }>(
      sql`SELECT concurrency_limit, paused FROM queues WHERE id = ${queueId}`,
    );
    const queue = queueRes.rows[0];
    if (!queue || queue.paused) return [];

    const runningRes = await tx.execute<{ running: number }>(
      sql`SELECT count(*)::int AS running FROM jobs
          WHERE queue_id = ${queueId} AND status IN ('claimed','running')`,
    );
    const running = runningRes.rows[0]?.running ?? 0;
    const capacity = queue.concurrency_limit - running;
    const take = Math.min(limit, capacity);
    if (take <= 0) return [];

    // (3) The atomic claim.
    const res = await tx.execute<{
      id: string;
      project_id: string;
      queue_id: string;
      name: string;
      type: string;
      payload: Record<string, unknown>;
      priority: number;
      attempts: number;
      max_attempts: number;
      lease_expires_at: Date;
    }>(sql`
      UPDATE jobs
      SET status = 'claimed',
          claimed_by = ${workerId},
          claimed_at = now(),
          lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
          updated_at = now()
      WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'queued'
          AND queue_id = ${queueId}
          AND run_at <= now()
        ORDER BY priority DESC, run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${take}
      )
      RETURNING id, project_id, queue_id, name, type, payload, priority,
                attempts, max_attempts, lease_expires_at
    `);

    return res.rows;
  });

  const result: ClaimedJob[] = claimed.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    queueId: r.queue_id,
    name: r.name,
    type: r.type,
    payload: r.payload ?? {},
    priority: r.priority,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    leaseExpiresAt: new Date(r.lease_expires_at),
  }));

  for (const job of result) {
    emit({
      kind: "job.claimed",
      queueId: job.queueId,
      jobId: job.id,
      workerId,
      at: new Date().toISOString(),
    });
  }
  return result;
}
