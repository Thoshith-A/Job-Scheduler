import {
  Module,
  Injectable,
  Inject,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
} from "@nestjs/common";
import { schema, eq, sql, desc, type DbHandle } from "@flux/db";
import {
  DomainError,
  createQueueSchema,
  updateQueueSchema,
  type CreateQueueInput,
  type JobStatus,
} from "@flux/shared";
import { DB } from "../common/tokens";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/decorators";

@Injectable()
export class QueuesService {
  constructor(@Inject(DB) private readonly dbh: DbHandle) {}
  private get db() {
    return this.dbh.db;
  }

  list(projectId: string) {
    return this.db
      .select()
      .from(schema.queues)
      .where(eq(schema.queues.projectId, projectId))
      .orderBy(desc(schema.queues.createdAt));
  }

  async get(queueId: string) {
    const [q] = await this.db.select().from(schema.queues).where(eq(schema.queues.id, queueId));
    if (!q) throw new DomainError("NOT_FOUND", "Queue not found");
    return q;
  }

  async create(projectId: string, input: CreateQueueInput) {
    try {
      const [q] = await this.db
        .insert(schema.queues)
        .values({
          projectId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          priorityDefault: input.priorityDefault,
          concurrencyLimit: input.concurrencyLimit,
          retryPolicyId: input.retryPolicyId,
          paused: input.paused,
        })
        .returning();
      return q!;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DomainError("CONFLICT", "A queue with that slug already exists in this project");
      }
      throw err;
    }
  }

  async update(queueId: string, input: Partial<CreateQueueInput>) {
    const [q] = await this.db
      .update(schema.queues)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.queues.id, queueId))
      .returning();
    if (!q) throw new DomainError("NOT_FOUND", "Queue not found");
    return q;
  }

  async remove(queueId: string) {
    await this.db.delete(schema.queues).where(eq(schema.queues.id, queueId));
  }

  /** Live operational stats for a queue: depth, per-status counts, throughput, latency, failure rate. */
  async stats(queueId: string) {
    const byStatus = await this.db.execute<{ status: JobStatus; c: number }>(
      sql`SELECT status, count(*)::int AS c FROM jobs WHERE queue_id = ${queueId} GROUP BY status`,
    );
    const counts: Record<string, number> = {};
    for (const r of byStatus.rows) counts[r.status] = r.c;

    const perf = await this.db.execute<{
      completed: number;
      failed: number;
      avg_ms: number;
      p95_ms: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE je.status = 'completed')::int AS completed,
        count(*) FILTER (WHERE je.status = 'failed')::int AS failed,
        coalesce(avg(je.duration_ms) FILTER (WHERE je.status = 'completed'), 0)::float AS avg_ms,
        coalesce(
          percentile_cont(0.95) WITHIN GROUP (ORDER BY je.duration_ms)
            FILTER (WHERE je.status = 'completed'), 0)::float AS p95_ms
      FROM job_executions je
      JOIN jobs j ON j.id = je.job_id
      WHERE j.queue_id = ${queueId} AND je.finished_at > now() - interval '1 hour'
    `);
    const p = perf.rows[0] ?? { completed: 0, failed: 0, avg_ms: 0, p95_ms: 0 };
    const totalTerminal = p.completed + p.failed;

    return {
      queueId,
      depth: counts.queued ?? 0,
      scheduled: counts.scheduled ?? 0,
      running: (counts.running ?? 0) + (counts.claimed ?? 0),
      completed: counts.completed ?? 0,
      dead: counts.dead ?? 0,
      countsByStatus: counts,
      lastHour: {
        completed: p.completed,
        failed: p.failed,
        throughputPerMin: Math.round((p.completed / 60) * 100) / 100,
        avgDurationMs: Math.round(p.avg_ms),
        p95DurationMs: Math.round(p.p95_ms),
        failureRate: totalTerminal === 0 ? 0 : Math.round((p.failed / totalTerminal) * 1000) / 1000,
      },
    };
  }
}

@Controller()
export class QueuesController {
  constructor(private readonly svc: QueuesService) {}

  @Get("projects/:projectId/queues")
  @Roles("member")
  list(@Param("projectId") projectId: string) {
    return this.svc.list(projectId);
  }

  @Post("projects/:projectId/queues")
  @Roles("admin")
  create(
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createQueueSchema)) body: CreateQueueInput,
  ) {
    return this.svc.create(projectId, body);
  }

  @Get("queues/:queueId")
  @Roles("member")
  get(@Param("queueId") queueId: string) {
    return this.svc.get(queueId);
  }

  @Get("queues/:queueId/stats")
  @Roles("member")
  stats(@Param("queueId") queueId: string) {
    return this.svc.stats(queueId);
  }

  @Patch("queues/:queueId")
  @Roles("admin")
  update(
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(updateQueueSchema)) body: Partial<CreateQueueInput>,
  ) {
    return this.svc.update(queueId, body);
  }

  @Delete("queues/:queueId")
  @Roles("admin")
  @HttpCode(204)
  async remove(@Param("queueId") queueId: string) {
    await this.svc.remove(queueId);
  }
}

@Module({
  providers: [QueuesService],
  controllers: [QueuesController],
  exports: [QueuesService],
})
export class QueuesModule {}
