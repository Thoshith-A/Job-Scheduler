import { sql, schema, eq } from "@flux/db";
import type { Database } from "@flux/db";
import type { EmitFn } from "../types";
import { noopEmit } from "../types";
import { nextCronRun } from "../cron";
import { resolveRetryPolicy } from "./lifecycle";

const { jobs, schedules, queues } = schema;

/**
 * Promote due, not-yet-runnable jobs to `queued`. Covers delayed/scheduled jobs and
 * retry-backoff jobs (which rest in `scheduled` until their backoff elapses). The single
 * `UPDATE ... RETURNING` is atomic; if two scheduler replicas race, the second simply
 * updates zero already-promoted rows.
 */
export async function promoteDueJobs(
  db: Database,
  opts: { batch?: number; emit?: EmitFn } = {},
): Promise<number> {
  const batch = opts.batch ?? 500;
  const emit = opts.emit ?? noopEmit;
  const res = await db.execute<{ id: string; queue_id: string }>(sql`
    UPDATE jobs SET status='queued', updated_at=now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status='scheduled' AND run_at <= now()
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    )
    RETURNING id, queue_id
  `);
  for (const row of res.rows) {
    emit({
      kind: "job.created",
      queueId: row.queue_id,
      jobId: row.id,
      status: "queued",
      at: new Date().toISOString(),
    });
  }
  return res.rows.length;
}

/**
 * Fire due cron schedules. For each enabled schedule whose `next_run_at <= now`, enqueue
 * one job instance and advance `next_run_at` using the cron expression in its timezone.
 * `FOR UPDATE SKIP LOCKED` keeps this safe across scheduler replicas.
 */
export async function tickSchedules(
  db: Database,
  opts: { now?: Date; batch?: number; emit?: EmitFn } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? 200;
  const emit = opts.emit ?? noopEmit;

  const enqueued: Array<{ jobId: string; queueId: string }> = [];

  await db.transaction(async (tx) => {
    const due = await tx.execute<{
      id: string;
      project_id: string;
      queue_id: string;
      name: string;
      cron: string;
      timezone: string;
      payload_template: string;
    }>(sql`
      SELECT id, project_id, queue_id, name, cron, timezone, payload_template
      FROM schedules
      WHERE enabled = true AND next_run_at <= ${now}
      ORDER BY next_run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    `);

    for (const sched of due.rows) {
      const [queue] = await tx
        .select({ priorityDefault: queues.priorityDefault })
        .from(queues)
        .where(eq(queues.id, sched.queue_id));
      const policy = await resolveRetryPolicy(tx as unknown as Database, sched.queue_id);

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(sched.payload_template) as Record<string, unknown>;
      } catch {
        payload = {};
      }

      const [job] = await tx
        .insert(jobs)
        .values({
          projectId: sched.project_id,
          queueId: sched.queue_id,
          name: sched.name,
          type: "recurring",
          status: "queued",
          payload,
          priority: queue?.priorityDefault ?? 100,
          maxAttempts: policy.maxAttempts,
          runAt: now,
          scheduleId: sched.id,
        })
        .returning({ id: jobs.id });

      const next = nextCronRun(sched.cron, sched.timezone, now);
      await tx
        .update(schedules)
        .set({ lastRunAt: now, lastJobId: job!.id, nextRunAt: next, updatedAt: new Date() })
        .where(eq(schedules.id, sched.id));

      enqueued.push({ jobId: job!.id, queueId: sched.queue_id });
    }
  });

  for (const e of enqueued) {
    emit({
      kind: "job.created",
      queueId: e.queueId,
      jobId: e.jobId,
      status: "queued",
      at: new Date().toISOString(),
    });
  }
  return enqueued.length;
}
