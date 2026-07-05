import { randomUUID } from "node:crypto";
import { schema, eq, and } from "@flux/db";
import type { Database } from "@flux/db";
import { DomainError, type CreateJobInput, type JobStatus } from "@flux/shared";
import type { EmitFn } from "../types";
import { noopEmit } from "../types";
import { nextCronRun } from "../cron";
import { resolveRetryPolicy } from "./lifecycle";

const { jobs, queues, schedules } = schema;

type JobRow = typeof jobs.$inferSelect;
type ScheduleRow = typeof schedules.$inferSelect;

export type CreateJobResult =
  | { kind: "job"; job: JobRow; deduplicated: boolean }
  | { kind: "batch"; batchId: string; count: number; jobIds: string[] }
  | { kind: "schedule"; schedule: ScheduleRow };

export interface CreateJobOptions {
  idempotencyKey?: string | null;
  /** If set, the queue must belong to this project (tenant scoping). */
  expectedProjectId?: string;
  emit?: EmitFn;
  now?: Date;
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  return code === PG_UNIQUE_VIOLATION || causeCode === PG_UNIQUE_VIOLATION;
}

/**
 * Create a job (or batch, or recurring schedule) from validated input.
 *
 * Effectively-once creation: when an `idempotencyKey` is supplied, the insert relies on
 * the `(queue_id, idempotency_key)` partial-unique index. A concurrent duplicate loses
 * the race at the database, and we return the *original* job with `deduplicated: true`
 * rather than creating a second one.
 */
export async function createJob(
  db: Database,
  input: CreateJobInput,
  opts: CreateJobOptions = {},
): Promise<CreateJobResult> {
  const emit = opts.emit ?? noopEmit;
  const now = opts.now ?? new Date();

  const [queue] = await db
    .select({
      id: queues.id,
      projectId: queues.projectId,
      priorityDefault: queues.priorityDefault,
    })
    .from(queues)
    .where(eq(queues.id, input.queueId));

  if (!queue || (opts.expectedProjectId && queue.projectId !== opts.expectedProjectId)) {
    throw new DomainError("NOT_FOUND", `Queue ${input.queueId} not found`);
  }

  const policy = await resolveRetryPolicy(db, queue.id);
  const priority = input.priority ?? queue.priorityDefault;
  const maxAttempts = input.maxAttempts ?? policy.maxAttempts;

  // ── recurring => create a schedule, not a job ──────────────────────────────
  if (input.type === "recurring") {
    const nextRunAt = nextCronRun(input.cron, input.timezone, now);
    const [schedule] = await db
      .insert(schedules)
      .values({
        projectId: queue.projectId,
        queueId: queue.id,
        name: input.name,
        cron: input.cron,
        timezone: input.timezone,
        payloadTemplate: JSON.stringify(input.payload ?? {}),
        enabled: true,
        nextRunAt,
      })
      .returning();
    return { kind: "schedule", schedule: schedule! };
  }

  // ── batch => one batch_id, many queued rows ────────────────────────────────
  if (input.type === "batch") {
    const batchId = randomUUID();
    const rows = input.payloads.map((payload) => ({
      projectId: queue.projectId,
      queueId: queue.id,
      name: input.name,
      type: "batch" as const,
      status: "queued" as const,
      payload,
      priority,
      maxAttempts,
      runAt: now,
      batchId,
    }));
    const inserted = await db.insert(jobs).values(rows).returning({ id: jobs.id });
    for (const r of inserted) {
      emit({ kind: "job.created", queueId: queue.id, jobId: r.id, status: "queued", at: now.toISOString() });
    }
    return { kind: "batch", batchId, count: inserted.length, jobIds: inserted.map((r) => r.id) };
  }

  // ── single job (immediate / delayed / scheduled) ───────────────────────────
  let runAt = now;
  if (input.type === "delayed") runAt = new Date(now.getTime() + input.delayMs);
  else if (input.type === "scheduled") runAt = input.runAt;

  // A future run_at rests in 'scheduled' (scheduler promotes it); otherwise it's ready.
  const status: JobStatus = runAt.getTime() <= now.getTime() ? "queued" : "scheduled";

  const values = {
    projectId: queue.projectId,
    queueId: queue.id,
    name: input.name,
    type: input.type,
    status,
    payload: input.payload ?? {},
    priority,
    maxAttempts,
    runAt,
    idempotencyKey: opts.idempotencyKey ?? null,
  };

  try {
    const [job] = await db.insert(jobs).values(values).returning();
    emit({ kind: "job.created", queueId: queue.id, jobId: job!.id, status, at: now.toISOString() });
    return { kind: "job", job: job!, deduplicated: false };
  } catch (err) {
    if (opts.idempotencyKey && isUniqueViolation(err)) {
      // Someone already created this (queue, key) — return the original.
      const [existing] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.queueId, queue.id), eq(jobs.idempotencyKey, opts.idempotencyKey)));
      if (existing) return { kind: "job", job: existing, deduplicated: true };
    }
    throw err;
  }
}
