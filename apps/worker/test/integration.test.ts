import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, seedQueue, type TestDb } from "@flux/testing";
import { schema, eq, and, count, sql } from "@flux/db";
import { Worker } from "../src/worker";
import { Scheduler } from "@flux/scheduler/scheduler";

/**
 * End-to-end proof that the *actual* Worker and Scheduler runtimes (not just the engine
 * functions) cooperate to drain a queue against a real Postgres: normal jobs complete,
 * always-failing jobs exhaust retries into the DLQ, a cron schedule produces instances,
 * and the worker registers + heartbeats.
 */
let tdb: TestDb;

beforeAll(async () => {
  tdb = await createTestDb();
}, 120_000);

afterAll(async () => {
  await tdb?.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("worker + scheduler integration", () => {
  it("drains normal jobs, DLQs permanent failures, and fires a cron schedule", async () => {
    const { projectId, queueId } = await seedQueue(tdb.db, {
      concurrencyLimit: 5,
      retryPolicy: { strategy: "fixed", maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 50, jitter: false },
    });

    // 12 normal jobs (quick) + 2 that always fail (retry then DLQ).
    await tdb.db.insert(schema.jobs).values([
      ...Array.from({ length: 12 }, (_, i) => ({
        projectId,
        queueId,
        name: `ok-${i}`,
        type: "immediate" as const,
        status: "queued" as const,
        payload: { sleepMs: 60 },
        maxAttempts: 2,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        projectId,
        queueId,
        name: `boom-${i}`,
        type: "immediate" as const,
        status: "queued" as const,
        payload: { fail: true, error: "always fails" },
        maxAttempts: 2,
      })),
    ]);

    // A cron schedule that fires every second (6-field cron with seconds).
    await tdb.db.insert(schema.schedules).values({
      projectId,
      queueId,
      name: "heartbeat-cron",
      cron: "*/1 * * * * *",
      timezone: "UTC",
      payloadTemplate: JSON.stringify({ sleepMs: 30 }),
      enabled: true,
      nextRunAt: new Date(),
    });

    const scheduler = new Scheduler({
      databaseUrl: tdb.url,
      tickMs: 250,
      singletonLock: false,
      workerStaleMs: 15_000,
    });
    const worker = new Worker({
      databaseUrl: tdb.url,
      pollMs: 100,
      heartbeatMs: 400,
      leaseSeconds: 5,
      maxConcurrency: 5,
      drainTimeoutMs: 5_000,
    });

    await scheduler.start();
    await worker.start();

    // Let the system run for a few seconds.
    await sleep(4_000);

    await worker.stop();
    await scheduler.stop();

    // Normal jobs all completed.
    const [{ c: completed }] = await tdb.db
      .select({ c: count() })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.queueId, queueId), eq(schema.jobs.status, "completed")));
    expect(completed).toBeGreaterThanOrEqual(12);

    // The 2 always-fail jobs exhausted retries and landed in the DLQ.
    const dlq = await tdb.db.select().from(schema.deadLetterQueue);
    expect(dlq.length).toBe(2);
    expect(dlq.every((d) => d.reason === "max_attempts_exhausted")).toBe(true);

    // Failed jobs recorded 2 attempts each (maxAttempts=2).
    const [{ c: boomExecs }] = await tdb.db
      .select({ c: count() })
      .from(schema.jobExecutions)
      .where(eq(schema.jobExecutions.status, "failed"));
    expect(boomExecs).toBe(4); // 2 jobs × 2 attempts

    // The cron schedule produced at least a couple of instances and advanced.
    const [{ c: cronInstances }] = await tdb.db
      .select({ c: count() })
      .from(schema.jobs)
      .where(sql`${schema.jobs.scheduleId} is not null`);
    expect(cronInstances).toBeGreaterThanOrEqual(2);

    const [sched] = await tdb.db.select().from(schema.schedules);
    expect(sched!.lastRunAt).not.toBeNull();
    expect(sched!.nextRunAt.getTime()).toBeGreaterThan(Date.now() - 2000);

    // The worker registered and heartbeated.
    const [{ c: hb }] = await tdb.db.select({ c: count() }).from(schema.workerHeartbeats);
    expect(hb).toBeGreaterThanOrEqual(1);
    const workers = await tdb.db.select().from(schema.workers);
    expect(workers.length).toBe(1);
    expect(workers[0]!.status).toBe("stopped"); // deregistered cleanly on stop()
  });
});
