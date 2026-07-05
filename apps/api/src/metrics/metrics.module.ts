import { Module, Injectable, Inject, Controller, Get, Header, OnModuleInit } from "@nestjs/common";
import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import { sql, type DbHandle } from "@flux/db";
import { DB } from "../common/tokens";
import { Public } from "../common/decorators";

/**
 * Prometheus metrics. Gauges are refreshed from the database on each scrape (a cheap set
 * of aggregate queries), so the exported values always reflect true system state without
 * needing cross-process counters.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();
  private jobsByStatus!: Gauge<"status">;
  private workersActive!: Gauge<string>;
  private dlqTotal!: Gauge<string>;
  private queueDepth!: Gauge<string>;

  constructor(@Inject(DB) private readonly dbh: DbHandle) {}

  onModuleInit(): void {
    this.registry.setDefaultLabels({ app: "flux" });
    collectDefaultMetrics({ register: this.registry });
    this.jobsByStatus = new Gauge({
      name: "flux_jobs_total",
      help: "Number of jobs by status",
      labelNames: ["status"],
      registers: [this.registry],
    });
    this.workersActive = new Gauge({
      name: "flux_workers_active",
      help: "Workers heartbeating within the liveness window",
      registers: [this.registry],
    });
    this.dlqTotal = new Gauge({
      name: "flux_dead_letter_total",
      help: "Jobs currently in the dead-letter queue",
      registers: [this.registry],
    });
    this.queueDepth = new Gauge({
      name: "flux_queue_depth",
      help: "Total queued (ready) jobs across all queues",
      registers: [this.registry],
    });
  }

  async scrape(): Promise<string> {
    const [byStatus, workers, dlq] = await Promise.all([
      this.dbh.db.execute<{ status: string; c: number }>(
        sql`SELECT status, count(*)::int AS c FROM jobs GROUP BY status`,
      ),
      this.dbh.db.execute<{ c: number }>(
        sql`SELECT count(*)::int AS c FROM workers WHERE status IN ('active','starting') AND last_heartbeat_at > now() - interval '15 seconds'`,
      ),
      this.dbh.db.execute<{ c: number }>(sql`SELECT count(*)::int AS c FROM dead_letter_queue`),
    ]);

    this.jobsByStatus.reset();
    let queued = 0;
    for (const r of byStatus.rows) {
      this.jobsByStatus.set({ status: r.status }, r.c);
      if (r.status === "queued") queued = r.c;
    }
    this.queueDepth.set(queued);
    this.workersActive.set(workers.rows[0]?.c ?? 0);
    this.dlqTotal.set(dlq.rows[0]?.c ?? 0);

    return this.registry.metrics();
  }
}

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4")
  scrape(): Promise<string> {
    return this.metrics.scrape();
  }
}

@Module({
  providers: [MetricsService],
  controllers: [MetricsController],
})
export class MetricsModule {}
