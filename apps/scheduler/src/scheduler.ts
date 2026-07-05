import {
  promoteDueJobs,
  tickSchedules,
  reapExpiredLeases,
  reapDeadWorkers,
  type EmitFn,
} from "@flux/core";
import { createDb, sql, type DbHandle } from "@flux/db";
import {
  createRedis,
  createEventBus,
  createDistributedLock,
  createLogger,
  type EventBus,
  type DistributedLock,
  type Logger,
  type Redis,
} from "@flux/infra";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LEADER_KEY = "flux:scheduler:leader";

export interface SchedulerConfig {
  databaseUrl: string;
  redisUrl?: string;
  tickMs: number;
  singletonLock: boolean;
  workerStaleMs: number;
}

/**
 * The scheduler runs three duties on a fixed interval. Each tick is guarded by a
 * distributed leader lock so that when multiple scheduler replicas run for HA, only one
 * performs the work (no double-promotion, no duplicated cron fires):
 *
 *   1. promoteDueJobs   — delayed/scheduled/retry-backoff jobs whose run_at has arrived → queued
 *   2. tickSchedules    — fire due cron schedules and advance their next_run_at
 *   3. reapExpiredLeases— dead-worker recovery: reclaim jobs whose lease expired
 *
 * plus periodic maintenance (mark stale workers dead, prune old heartbeats).
 */
export class Scheduler {
  private readonly handle: DbHandle;
  private readonly redis: Redis | null;
  private readonly bus: EventBus;
  private readonly lock: DistributedLock;
  private readonly log: Logger;
  private readonly emit: EmitFn;
  private running = false;
  private ticks = 0;

  constructor(private readonly cfg: SchedulerConfig) {
    this.handle = createDb(cfg.databaseUrl, { max: 6, applicationName: "flux-scheduler" });
    this.redis = createRedis(cfg.redisUrl);
    this.bus = createEventBus(this.redis);
    this.lock = createDistributedLock(this.redis);
    this.log = createLogger("scheduler");
    this.emit = (event) => void this.bus.publish(event).catch(() => {});
  }

  async start(): Promise<void> {
    this.running = true;
    this.log.info({ tickMs: this.cfg.tickMs, singletonLock: this.cfg.singletonLock }, "scheduler ready");
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const started = Date.now();
      try {
        await this.tick();
      } catch (err) {
        this.log.error({ err: String(err) }, "scheduler tick failed");
      }
      // Keep a steady cadence regardless of how long the tick took.
      await sleep(Math.max(0, this.cfg.tickMs - (Date.now() - started)));
    }
  }

  private async tick(): Promise<void> {
    // Leader election: hold the lock only for the duration of this tick.
    const release = this.cfg.singletonLock
      ? await this.lock.acquire(LEADER_KEY, this.cfg.tickMs * 3)
      : async () => {};
    if (!release) return; // another replica is the leader this tick

    try {
      this.ticks += 1;
      const promoted = await promoteDueJobs(this.handle.db, { emit: this.emit });
      const cronFired = await tickSchedules(this.handle.db, { emit: this.emit });
      const reaped = await reapExpiredLeases(this.handle.db, { emit: this.emit });
      const deadWorkers = await reapDeadWorkers(this.handle.db, {
        staleMs: this.cfg.workerStaleMs,
        emit: this.emit,
      });

      if (promoted || cronFired || reaped.requeued || reaped.deadLettered || deadWorkers.length) {
        this.log.info(
          {
            promoted,
            cronFired,
            requeued: reaped.requeued,
            deadLettered: reaped.deadLettered,
            deadWorkers: deadWorkers.length,
          },
          "scheduler work",
        );
      }

      // Light maintenance: prune heartbeats older than an hour every ~60 ticks.
      if (this.ticks % 60 === 0) {
        await this.handle.db.execute(
          sql`DELETE FROM worker_heartbeats WHERE ts < now() - interval '1 hour'`,
        );
      }
    } finally {
      await release();
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.bus.close().catch(() => {});
    await this.handle.close().catch(() => {});
    this.redis?.disconnect();
    this.log.info("scheduler stopped");
  }
}
