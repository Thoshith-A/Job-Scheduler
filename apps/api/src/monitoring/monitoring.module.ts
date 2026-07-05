import {
  Module,
  Injectable,
  Inject,
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
} from "@nestjs/common";
import { schema, eq, and, desc, sql, count, type DbHandle } from "@flux/db";
import { DomainError, paginationSchema, makePage } from "@flux/shared";
import { z } from "zod";
import { DB } from "../common/tokens";
import { Roles } from "../common/decorators";

@Injectable()
export class MonitoringService {
  constructor(@Inject(DB) private readonly dbh: DbHandle) {}
  private get db() {
    return this.dbh.db;
  }

  /** The worker fleet with derived liveness (heartbeat within 15s). */
  async workers() {
    const rows = await this.db.select().from(schema.workers).orderBy(desc(schema.workers.startedAt)).limit(200);
    const now = Date.now();
    return rows.map((w) => ({
      ...w,
      alive: w.status !== "stopped" && w.status !== "dead" && now - w.lastHeartbeatAt.getTime() < 15_000,
    }));
  }

  async workerHeartbeats(workerId: string, limit = 60) {
    return this.db
      .select({ ts: schema.workerHeartbeats.ts, inFlightCount: schema.workerHeartbeats.inFlightCount })
      .from(schema.workerHeartbeats)
      .where(eq(schema.workerHeartbeats.workerId, workerId))
      .orderBy(desc(schema.workerHeartbeats.ts))
      .limit(limit);
  }

  listSchedules(projectId: string) {
    return this.db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.projectId, projectId))
      .orderBy(desc(schema.schedules.createdAt));
  }

  async setScheduleEnabled(projectId: string, scheduleId: string, enabled: boolean) {
    const [s] = await this.db
      .update(schema.schedules)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.projectId, projectId)))
      .returning();
    if (!s) throw new DomainError("NOT_FOUND", "Schedule not found");
    return s;
  }

  async deleteSchedule(projectId: string, scheduleId: string) {
    await this.db
      .delete(schema.schedules)
      .where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.projectId, projectId)));
  }

  async dlq(projectId: string, page: { limit: number; offset: number }) {
    const where = eq(schema.jobs.projectId, projectId);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: schema.deadLetterQueue.id,
          jobId: schema.deadLetterQueue.jobId,
          queueId: schema.deadLetterQueue.queueId,
          reason: schema.deadLetterQueue.reason,
          finalError: schema.deadLetterQueue.finalError,
          attempts: schema.deadLetterQueue.attempts,
          deadAt: schema.deadLetterQueue.deadAt,
          jobName: schema.jobs.name,
          jobType: schema.jobs.type,
        })
        .from(schema.deadLetterQueue)
        .innerJoin(schema.jobs, eq(schema.deadLetterQueue.jobId, schema.jobs.id))
        .where(where)
        .orderBy(desc(schema.deadLetterQueue.deadAt))
        .limit(page.limit)
        .offset(page.offset),
      this.db
        .select({ total: count() })
        .from(schema.deadLetterQueue)
        .innerJoin(schema.jobs, eq(schema.deadLetterQueue.jobId, schema.jobs.id))
        .where(where),
    ]);
    return makePage(items, total, page);
  }

  /** Project-level rollup for the dashboard's system-health header. */
  async projectOverview(projectId: string) {
    const byStatus = await this.db.execute<{ status: string; c: number }>(
      sql`SELECT status, count(*)::int AS c FROM jobs WHERE project_id = ${projectId} GROUP BY status`,
    );
    const counts: Record<string, number> = {};
    for (const r of byStatus.rows) counts[r.status] = r.c;
    const [{ throughput }] = (
      await this.db.execute<{ throughput: number }>(sql`
        SELECT count(*)::int AS throughput FROM job_executions je
        JOIN jobs j ON j.id = je.job_id
        WHERE j.project_id = ${projectId} AND je.status = 'completed' AND je.finished_at > now() - interval '1 minute'
      `)
    ).rows;
    return { countsByStatus: counts, completedLastMinute: throughput ?? 0 };
  }
}

@Controller()
export class MonitoringController {
  constructor(private readonly svc: MonitoringService) {}

  @Get("projects/:projectId/workers")
  @Roles("member")
  workers(@Param("projectId") _projectId: string) {
    return this.svc.workers();
  }

  @Get("workers/:workerId/heartbeats")
  workerHeartbeats(@Param("workerId") workerId: string) {
    return this.svc.workerHeartbeats(workerId);
  }

  @Get("projects/:projectId/overview")
  @Roles("member")
  overview(@Param("projectId") projectId: string) {
    return this.svc.projectOverview(projectId);
  }

  @Get("projects/:projectId/schedules")
  @Roles("member")
  schedules(@Param("projectId") projectId: string) {
    return this.svc.listSchedules(projectId);
  }

  @Patch("projects/:projectId/schedules/:scheduleId")
  @Roles("admin")
  toggleSchedule(
    @Param("projectId") projectId: string,
    @Param("scheduleId") scheduleId: string,
    @Body() body: { enabled: boolean },
  ) {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(body);
    return this.svc.setScheduleEnabled(projectId, scheduleId, enabled);
  }

  @Delete("projects/:projectId/schedules/:scheduleId")
  @Roles("admin")
  @HttpCode(204)
  async deleteSchedule(@Param("projectId") projectId: string, @Param("scheduleId") scheduleId: string) {
    await this.svc.deleteSchedule(projectId, scheduleId);
  }

  @Get("projects/:projectId/dlq")
  @Roles("member")
  dlq(@Param("projectId") projectId: string, @Query() query: Record<string, unknown>) {
    const page = paginationSchema.parse(query);
    return this.svc.dlq(projectId, page);
  }
}

@Module({
  providers: [MonitoringService],
  controllers: [MonitoringController],
})
export class MonitoringModule {}
