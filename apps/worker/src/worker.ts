import { hostname } from "node:os";
import {
  claimJobs,
  beginExecution,
  completeJob,
  failJob,
  resolveRetryPolicy,
  registerWorker,
  heartbeat,
  markDraining,
  deregisterWorker,
  type ClaimedJob,
  type EmitFn,
} from "@flux/core";
import { createDb, sql, type DbHandle } from "@flux/db";
import { createRedis, createEventBus, createLogger, type EventBus, type Logger, type Redis } from "@flux/infra";
import { runJob } from "./run-job";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl?: string;
  pollMs: number;
  heartbeatMs: number;
  leaseSeconds: number;
  maxConcurrency: number;
  drainTimeoutMs: number;
}

/**
 * A worker process. It is a thin, well-behaved runtime around the (independently proven)
 * engine in @flux/core:
 *   - registers itself + heartbeats (extending its jobs' leases every beat),
 *   - polls queues with due work and atomically claims up to its free capacity,
 *   - executes claimed jobs concurrently (bounded by maxConcurrency),
 *   - on SIGTERM/SIGINT drains: stop claiming, let in-flight finish, release un-started
 *     claims, deregister — so a rolling deploy never loses or double-runs a job.
 */
export class Worker {
  private readonly handle: DbHandle;
  private readonly redis: Redis | null;
  private readonly bus: EventBus;
  private readonly log: Logger;
  private readonly emit: EmitFn;

  private workerId!: string;
  private readonly inFlight = new Set<string>();
  private running = false;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly cfg: WorkerConfig) {
    this.handle = createDb(cfg.databaseUrl, {
      max: cfg.maxConcurrency + 5,
      applicationName: "flux-worker",
    });
    this.redis = createRedis(cfg.redisUrl);
    this.bus = createEventBus(this.redis);
    this.log = createLogger("worker");
    // Engine side-effects flow to the event bus (best-effort; never block execution).
    this.emit = (event) => {
      void this.bus.publish(event).catch(() => {});
    };
  }

  get id(): string {
    return this.workerId;
  }

  async start(): Promise<void> {
    this.workerId = await registerWorker(
      this.handle.db,
      { host: hostname(), pid: process.pid, concurrency: this.cfg.maxConcurrency },
      this.emit,
    );
    this.running = true;
    this.log.info({ workerId: this.workerId, concurrency: this.cfg.maxConcurrency }, "worker ready");

    this.heartbeatTimer = setInterval(() => void this.beat(), this.cfg.heartbeatMs);
    void this.beat();
    void this.loop();
  }

  private async beat(): Promise<void> {
    try {
      await heartbeat(
        this.handle.db,
        { workerId: this.workerId, inFlight: this.inFlight.size, leaseSeconds: this.cfg.leaseSeconds },
        this.emit,
      );
    } catch (err) {
      this.log.warn({ err: String(err) }, "heartbeat failed");
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.log.error({ err: String(err) }, "claim tick failed");
      }
      await sleep(this.cfg.pollMs);
    }
  }

  private async tick(): Promise<void> {
    const free = this.cfg.maxConcurrency - this.inFlight.size;
    if (free <= 0) return;

    // Which queues have ready work right now? (One cheap query, then per-queue claims.)
    const due = await this.handle.db.execute<{ queue_id: string }>(
      sql`SELECT DISTINCT queue_id FROM jobs WHERE status='queued' AND run_at <= now() LIMIT 50`,
    );

    let budget = free;
    for (const { queue_id } of due.rows) {
      if (budget <= 0) break;
      const claimed = await claimJobs(
        this.handle.db,
        { queueId: queue_id, workerId: this.workerId, limit: budget, leaseSeconds: this.cfg.leaseSeconds, emit: this.emit },
      );
      for (const job of claimed) {
        budget -= 1;
        this.execute(job);
      }
    }
  }

  /** Fire-and-forget execution of a single claimed job. */
  private execute(job: ClaimedJob): void {
    this.inFlight.add(job.id);
    void (async () => {
      const startedAt = Date.now();
      try {
        const begun = await beginExecution(this.handle.db, job, this.workerId, this.emit);
        if (!begun) return; // lost the race (reaped/canceled) — safe to drop
        const policy = await resolveRetryPolicy(this.handle.db, job.queueId);
        try {
          await runJob(job, {
            db: this.handle.db,
            executionId: begun.executionId,
            attemptNo: begun.attemptNo,
            emit: this.emit,
          });
          await completeJob(
            this.handle.db,
            { job, executionId: begun.executionId, workerId: this.workerId, durationMs: Date.now() - startedAt },
            this.emit,
          );
        } catch (err) {
          await failJob(
            this.handle.db,
            {
              job: { ...job, attempts: begun.attemptNo },
              executionId: begun.executionId,
              workerId: this.workerId,
              error: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - startedAt,
              policy,
            },
            this.emit,
          );
        }
      } catch (err) {
        this.log.error({ err: String(err), jobId: job.id }, "execute failed");
      } finally {
        this.inFlight.delete(job.id);
      }
    })();
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.log.info({ inFlight: this.inFlight.size }, "draining worker");
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await markDraining(this.handle.db, this.workerId).catch(() => {});

    const deadline = Date.now() + this.cfg.drainTimeoutMs;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      // Keep extending leases while we finish in-flight work.
      await this.beat();
      await sleep(200);
    }

    await deregisterWorker(this.handle.db, this.workerId, this.emit).catch(() => {});
    await this.bus.close().catch(() => {});
    await this.handle.close().catch(() => {});
    this.redis?.disconnect();
    this.log.info("worker stopped");
  }
}
