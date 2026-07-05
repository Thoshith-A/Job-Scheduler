import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestDb, seedQueue, type TestDb } from "@flux/testing";
import { schema, eq, and, sql, count } from "@flux/db";
import {
  claimJobs,
  beginExecution,
  completeJob,
  failJob,
  reapExpiredLeases,
  promoteDueJobs,
  createJob,
  registerWorker,
  resolveRetryPolicy,
  type ClaimedJob,
  type RetryPolicySpec,
} from "../src/index";

/**
 * These are the reliability proofs — the heart of the whole submission. They run against
 * a REAL, throwaway PostgreSQL (embedded binaries, no Docker), so `FOR UPDATE SKIP LOCKED`,
 * transactions, and advisory locks behave exactly as they would in production.
 */

let tdb: TestDb;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  tdb = await createTestDb();
}, 120_000);

afterAll(async () => {
  await tdb?.stop();
});

beforeEach(async () => {
  await tdb.reset();
});

/** Execute a claimed job end-to-end (begin -> optional work -> complete/fail). */
async function execute(
  job: ClaimedJob,
  workerId: string,
  opts: { workMs?: number; fail?: boolean; policy?: RetryPolicySpec; hooks?: { onRunning?: () => void; onDone?: () => void } } = {},
): Promise<void> {
  const begun = await beginExecution(tdb.db, job, workerId);
  if (!begun) return; // lost the race (reaped/stolen) — correct to skip
  opts.hooks?.onRunning?.();
  if (opts.workMs) await sleep(opts.workMs);
  if (opts.fail) {
    const policy = opts.policy ?? (await resolveRetryPolicy(tdb.db, job.queueId));
    await failJob(tdb.db, {
      job,
      executionId: begun.executionId,
      workerId,
      error: "simulated failure",
      durationMs: opts.workMs ?? 0,
      policy,
    });
  } else {
    await completeJob(tdb.db, { job, executionId: begun.executionId, workerId, durationMs: opts.workMs ?? 0 });
  }
  opts.hooks?.onDone?.();
}

async function statusCount(queueId: string, status: string): Promise<number> {
  const [row] = await tdb.db
    .select({ c: count() })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.queueId, queueId), eq(schema.jobs.status, status as never)));
  return row?.c ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("PROOF 1 — no double execution under heavy concurrency", () => {
  it("500 jobs, 8 concurrent claim loops => each job runs exactly once", async () => {
    const { projectId, queueId } = await seedQueue(tdb.db, { concurrencyLimit: 1000 });

    const N = 500;
    await tdb.db.insert(schema.jobs).values(
      Array.from({ length: N }, (_, i) => ({
        projectId,
        queueId,
        name: `job-${i}`,
        type: "immediate" as const,
        status: "queued" as const,
        payload: { i },
        priority: 100,
        maxAttempts: 1,
      })),
    );

    const worker = async (workerId: string) => {
      for (;;) {
        const claimed = await claimJobs(tdb.db, { queueId, workerId, limit: 10, leaseSeconds: 30 });
        if (claimed.length === 0) break;
        for (const job of claimed) await execute(job, workerId);
      }
    };

    const workerIds = await Promise.all(
      Array.from({ length: 8 }, (_, i) => registerWorker(tdb.db, { host: `host-${i}`, concurrency: 10 })),
    );
    await Promise.all(workerIds.map((id) => worker(id)));

    // Every job completed…
    expect(await statusCount(queueId, "completed")).toBe(N);
    expect(await statusCount(queueId, "queued")).toBe(0);

    // …and each was executed EXACTLY once: exactly N execution rows over N distinct jobs.
    const execs = await tdb.db
      .select({ jobId: schema.jobExecutions.jobId, attemptNo: schema.jobExecutions.attemptNo })
      .from(schema.jobExecutions);
    expect(execs.length).toBe(N);
    expect(new Set(execs.map((e) => e.jobId)).size).toBe(N);
    expect(execs.every((e) => e.attemptNo === 1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PROOF 2 — dead-worker recovery (no lost jobs)", () => {
  it("a job held by a crashed worker is reclaimed and completed by another", async () => {
    const { projectId, queueId } = await seedQueue(tdb.db, {
      concurrencyLimit: 10,
      retryPolicy: { strategy: "fixed", maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });
    const workerA = await registerWorker(tdb.db, { host: "hostA", concurrency: 1 });
    const workerB = await registerWorker(tdb.db, { host: "hostB", concurrency: 1 });

    await tdb.db.insert(schema.jobs).values({
      projectId,
      queueId,
      name: "victim",
      type: "immediate",
      status: "queued",
      maxAttempts: 3,
    });

    // Worker A claims and STARTS the job, then "crashes" (never completes/heartbeats).
    const [job] = await claimJobs(tdb.db, { queueId, workerId: workerA, limit: 1, leaseSeconds: 30 });
    expect(job).toBeDefined();
    const begun = await beginExecution(tdb.db, job!, workerA);
    expect(begun).not.toBeNull();

    // Simulate the crash: force the lease into the past (as if heartbeats stopped).
    await tdb.db.execute(
      sql`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = ${job!.id}`,
    );

    // The reaper reclaims it.
    const reaped = await reapExpiredLeases(tdb.db);
    expect(reaped.requeued).toBe(1);
    expect(reaped.deadLettered).toBe(0);

    // The lost attempt is recorded as 'lost'; the job is queued again with attempts intact.
    const lost = await tdb.db
      .select()
      .from(schema.jobExecutions)
      .where(eq(schema.jobExecutions.status, "lost"));
    expect(lost.length).toBe(1);
    expect(await statusCount(queueId, "queued")).toBe(1);

    // Worker B picks it up and finishes it.
    const [job2] = await claimJobs(tdb.db, { queueId, workerId: workerB, limit: 1, leaseSeconds: 30 });
    expect(job2!.id).toBe(job!.id);
    expect(job2!.attempts).toBe(1); // the lost attempt still counts
    await execute(job2!, workerB);

    expect(await statusCount(queueId, "completed")).toBe(1);
    const allExecs = await tdb.db.select().from(schema.jobExecutions);
    expect(allExecs.length).toBe(2); // attempt 1 (lost) + attempt 2 (completed)
    expect(allExecs.find((e) => e.attemptNo === 2)?.status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PROOF 3 — retry with exponential backoff, then dead-letter", () => {
  it("attempts increment, run_at advances exponentially, then lands in the DLQ", async () => {
    const policy: RetryPolicySpec = {
      strategy: "exponential",
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: false,
    };
    const { projectId, queueId } = await seedQueue(tdb.db, { concurrencyLimit: 10, retryPolicy: policy });
    const w = await registerWorker(tdb.db, { host: "host", concurrency: 1 });

    await tdb.db.insert(schema.jobs).values({
      projectId,
      queueId,
      name: "always-fails",
      type: "immediate",
      status: "queued",
      maxAttempts: 3,
    });

    const backoffs: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [job] = await claimJobs(tdb.db, { queueId, workerId: w, limit: 1, leaseSeconds: 30 });
      expect(job, `attempt ${attempt} should have a claimable job`).toBeDefined();
      const begun = await beginExecution(tdb.db, job!, w);
      const before = Date.now();
      const res = await failJob(tdb.db, {
        job: { ...job!, attempts: begun!.attemptNo }, // attempts already bumped by begin
        executionId: begun!.executionId,
        workerId: w,
        error: `fail ${attempt}`,
        durationMs: 0,
        policy,
      });

      if (attempt < 3) {
        expect(res.willRetry).toBe(true);
        backoffs.push(res.nextRunAt!.getTime() - before);
        // Make it claimable again for the next iteration.
        await tdb.db.execute(sql`UPDATE jobs SET run_at = now() WHERE id = ${job!.id}`);
        expect(await promoteDueJobs(tdb.db)).toBe(1);
      } else {
        expect(res.willRetry).toBe(false);
      }
    }

    // Exponential progression (100ms, then 200ms) — approximately, allowing for clock.
    expect(backoffs[0]).toBeGreaterThanOrEqual(90);
    expect(backoffs[0]).toBeLessThan(180);
    expect(backoffs[1]).toBeGreaterThanOrEqual(190);
    expect(backoffs[1]).toBeLessThan(320);

    // Terminal state: dead + a DLQ row with the right reason and attempt count.
    expect(await statusCount(queueId, "dead")).toBe(1);
    const dlq = await tdb.db.select().from(schema.deadLetterQueue);
    expect(dlq.length).toBe(1);
    expect(dlq[0]!.reason).toBe("max_attempts_exhausted");
    expect(dlq[0]!.attempts).toBe(3);

    const execs = await tdb.db.select().from(schema.jobExecutions);
    expect(execs.length).toBe(3);
    expect(execs.every((e) => e.status === "failed")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PROOF 4 — fleet-wide concurrency limit is never exceeded", () => {
  it("queue limit=2, 10 slow jobs, 6 workers => at most 2 run at once", async () => {
    const { projectId, queueId } = await seedQueue(tdb.db, { concurrencyLimit: 2 });

    await tdb.db.insert(schema.jobs).values(
      Array.from({ length: 10 }, (_, i) => ({
        projectId,
        queueId,
        name: `slow-${i}`,
        type: "immediate" as const,
        status: "queued" as const,
        maxAttempts: 1,
      })),
    );

    let running = 0;
    let maxRunning = 0;

    const remaining = async () => {
      const [row] = await tdb.db
        .select({ c: count() })
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.queueId, queueId),
            sql`${schema.jobs.status} IN ('scheduled','queued','claimed','running')`,
          ),
        );
      return row?.c ?? 0;
    };

    const worker = async (workerId: string) => {
      for (;;) {
        if ((await remaining()) === 0) break;
        const claimed = await claimJobs(tdb.db, { queueId, workerId, limit: 1, leaseSeconds: 30 });
        if (claimed.length === 0) {
          await sleep(5);
          continue;
        }
        for (const job of claimed) {
          await execute(job, workerId, {
            workMs: 40,
            hooks: {
              onRunning: () => {
                running += 1;
                maxRunning = Math.max(maxRunning, running);
              },
              onDone: () => {
                running -= 1;
              },
            },
          });
        }
      }
    };

    const workerIds = await Promise.all(
      Array.from({ length: 6 }, (_, i) => registerWorker(tdb.db, { host: `host-${i}`, concurrency: 1 })),
    );
    await Promise.all(workerIds.map((id) => worker(id)));

    // The hard guarantee: never more than the limit ran simultaneously.
    expect(maxRunning).toBeLessThanOrEqual(2);
    // And the limit was actually utilised (this would be 1 if the limit weren't shared).
    expect(maxRunning).toBe(2);
    expect(await statusCount(queueId, "completed")).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PROOF 5 — idempotency-key deduplication", () => {
  it("two concurrent creates with the same key produce exactly one job", async () => {
    const { queueId } = await seedQueue(tdb.db, { concurrencyLimit: 10 });
    const key = "order-4242";

    const [r1, r2] = await Promise.all([
      createJob(tdb.db, { type: "immediate", queueId, name: "charge", payload: { amount: 10 } }, { idempotencyKey: key }),
      createJob(tdb.db, { type: "immediate", queueId, name: "charge", payload: { amount: 10 } }, { idempotencyKey: key }),
    ]);

    const id1 = r1.kind === "job" ? r1.job.id : null;
    const id2 = r2.kind === "job" ? r2.job.id : null;
    expect(id1).toBe(id2); // same job returned to both callers
    expect(Number(r1.kind === "job") + Number(r2.kind === "job")).toBe(2);
    expect((r1.kind === "job" && r1.deduplicated) || (r2.kind === "job" && r2.deduplicated)).toBe(true);

    const [{ c }] = await tdb.db
      .select({ c: count() })
      .from(schema.jobs)
      .where(eq(schema.jobs.idempotencyKey, key));
    expect(c).toBe(1); // exactly one row in the DB

    // A different key creates a distinct job.
    await createJob(tdb.db, { type: "immediate", queueId, name: "charge", payload: {} }, { idempotencyKey: "other" });
    const [{ c: total }] = await tdb.db.select({ c: count() }).from(schema.jobs);
    expect(total).toBe(2);
  });
});
