import { Injectable, Inject } from "@nestjs/common";
import {
  schema,
  eq,
  and,
  or,
  inArray,
  ilike,
  gte,
  lte,
  desc,
  asc,
  count,
  sql,
  type DbHandle,
  type Database,
} from "@flux/db";
import {
  DomainError,
  makePage,
  type CreateJobInput,
  type JobStatus,
  type PaginationQuery,
} from "@flux/shared";
import { createJob, type EmitFn } from "@flux/core";
import type { EventBus } from "@flux/infra";
import { DB, EVENT_BUS } from "../common/tokens";

export interface JobFilter {
  status?: string;
  type?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string;
}

const SORT_COLUMNS = {
  createdAt: schema.jobs.createdAt,
  runAt: schema.jobs.runAt,
  priority: schema.jobs.priority,
  updatedAt: schema.jobs.updatedAt,
} as const;

@Injectable()
export class JobsService {
  private readonly emit: EmitFn;
  constructor(
    @Inject(DB) private readonly dbh: DbHandle,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {
    this.emit = (event) => void this.bus.publish(event).catch(() => {});
  }
  private get db(): Database {
    return this.dbh.db;
  }

  create(input: CreateJobInput, idempotencyKey?: string) {
    return createJob(this.db, input, { idempotencyKey: idempotencyKey ?? null, emit: this.emit });
  }

  private buildWhere(base: ReturnType<typeof eq>, filter: JobFilter) {
    const conds = [base];
    if (filter.status) {
      const statuses = filter.status.split(",").map((s) => s.trim()) as JobStatus[];
      conds.push(inArray(schema.jobs.status, statuses));
    }
    if (filter.type) conds.push(eq(schema.jobs.type, filter.type as never));
    if (filter.createdAfter) conds.push(gte(schema.jobs.createdAt, filter.createdAfter));
    if (filter.createdBefore) conds.push(lte(schema.jobs.createdAt, filter.createdBefore));
    if (filter.search) {
      conds.push(or(ilike(schema.jobs.name, `%${filter.search}%`), sql`${schema.jobs.id}::text = ${filter.search}`)!);
    }
    return and(...conds);
  }

  async list(
    scope: { queueId: string } | { projectId: string },
    filter: JobFilter,
    page: PaginationQuery,
  ) {
    const base =
      "queueId" in scope
        ? eq(schema.jobs.queueId, scope.queueId)
        : eq(schema.jobs.projectId, scope.projectId);
    const where = this.buildWhere(base, filter);

    const sortCol =
      SORT_COLUMNS[(page.sort as keyof typeof SORT_COLUMNS) ?? "createdAt"] ?? schema.jobs.createdAt;
    const orderBy = page.order === "asc" ? asc(sortCol) : desc(sortCol);

    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(schema.jobs).where(where).orderBy(orderBy).limit(page.limit).offset(page.offset),
      this.db.select({ total: count() }).from(schema.jobs).where(where),
    ]);
    return makePage(items, total, page);
  }

  async detail(jobId: string) {
    const [job] = await this.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!job) throw new DomainError("NOT_FOUND", "Job not found");

    const [executions, logs, dlq, worker] = await Promise.all([
      this.db
        .select()
        .from(schema.jobExecutions)
        .where(eq(schema.jobExecutions.jobId, jobId))
        .orderBy(asc(schema.jobExecutions.attemptNo)),
      this.db
        .select()
        .from(schema.jobLogs)
        .where(eq(schema.jobLogs.jobId, jobId))
        .orderBy(desc(schema.jobLogs.ts))
        .limit(200),
      this.db.select().from(schema.deadLetterQueue).where(eq(schema.deadLetterQueue.jobId, jobId)),
      job.claimedBy
        ? this.db.select().from(schema.workers).where(eq(schema.workers.id, job.claimedBy))
        : Promise.resolve([]),
    ]);

    return {
      job,
      executions,
      logs: logs.reverse(),
      deadLetter: dlq[0] ?? null,
      worker: worker[0] ?? null,
    };
  }

  async logs(jobId: string, page: PaginationQuery) {
    const rows = await this.db
      .select()
      .from(schema.jobLogs)
      .where(eq(schema.jobLogs.jobId, jobId))
      .orderBy(desc(schema.jobLogs.ts))
      .limit(page.limit)
      .offset(page.offset);
    return rows.reverse();
  }

  /** Manual retry of a failed/dead/canceled job: fresh attempt budget, back to queued. */
  async retry(jobId: string) {
    const [job] = await this.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!job) throw new DomainError("NOT_FOUND", "Job not found");
    if (job.status === "running" || job.status === "claimed" || job.status === "queued") {
      throw new DomainError("INVALID_STATE_TRANSITION", `Cannot retry a ${job.status} job`);
    }
    const updated = await this.db.transaction(async (tx) => {
      await tx.delete(schema.deadLetterQueue).where(eq(schema.deadLetterQueue.jobId, jobId));
      const [j] = await tx
        .update(schema.jobs)
        .set({
          status: "queued",
          attempts: 0,
          runAt: new Date(),
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          finishedAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.jobs.id, jobId))
        .returning();
      return j!;
    });
    this.emit({ kind: "job.created", queueId: updated.queueId, jobId, status: "queued", at: new Date().toISOString() });
    return updated;
  }

  async cancel(jobId: string) {
    const [job] = await this.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!job) throw new DomainError("NOT_FOUND", "Job not found");
    if (["completed", "dead", "canceled"].includes(job.status)) {
      throw new DomainError("INVALID_STATE_TRANSITION", `Job is already ${job.status}`);
    }
    const [updated] = await this.db
      .update(schema.jobs)
      .set({ status: "canceled", claimedBy: null, leaseExpiresAt: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.jobs.id, jobId))
      .returning();
    return updated!;
  }
}
