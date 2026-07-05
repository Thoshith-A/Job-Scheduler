import { recordLog, type ClaimedJob, type EmitFn } from "@flux/core";
import type { Database } from "@flux/db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunContext {
  db: Database;
  executionId: string;
  attemptNo: number;
  emit: EmitFn;
}

/**
 * The pluggable job handler. Since Flux is a *platform*, the actual work is described by
 * the job's payload. This reference handler is enough to exercise every path end-to-end
 * and to make the live demo tangible:
 *
 *   { "sleepMs": 800 }                     → simulate work for 800ms then succeed
 *   { "fail": true, "error": "boom" }      → always throw (drives the retry→DLQ path)
 *   { "failTimes": 2 }                     → fail the first 2 attempts, then succeed
 *   { "failRate": 0.3 }                    → fail ~30% of attempts (flaky-job simulation)
 *   { "url": "https://..." }               → perform a real HTTP GET; non-2xx → failure
 *   { "steps": ["a","b","c"] }             → stream a log line per step
 *
 * It streams structured logs to `job_logs` so the dashboard can live-tail execution.
 */
export async function runJob(job: ClaimedJob, ctx: RunContext): Promise<void> {
  const p = job.payload as Record<string, unknown>;
  const log = (message: string, level = "info") =>
    recordLog(ctx.db, { jobId: job.id, executionId: ctx.executionId, level, message }, ctx.emit);

  await log(`▶ attempt ${ctx.attemptNo} of "${job.name}" started`);

  const steps = Array.isArray(p.steps) ? (p.steps as unknown[]) : [];
  for (const step of steps) {
    await sleep(120);
    await log(`• step: ${String(step)}`);
  }

  const sleepMs = typeof p.sleepMs === "number" ? p.sleepMs : 200 + Math.floor(Math.random() * 500);
  await sleep(sleepMs);

  if (typeof p.url === "string") {
    const res = await fetch(p.url);
    await log(`↳ GET ${p.url} → ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${p.url}`);
  }

  if (p.fail === true) {
    throw new Error(typeof p.error === "string" ? p.error : "job configured to always fail");
  }
  if (typeof p.failTimes === "number" && ctx.attemptNo <= p.failTimes) {
    throw new Error(`transient failure (${ctx.attemptNo}/${p.failTimes})`);
  }
  if (typeof p.failRate === "number" && Math.random() < p.failRate) {
    throw new Error("random transient failure");
  }

  await log(`✔ "${job.name}" completed in ~${sleepMs}ms`, "info");
}
