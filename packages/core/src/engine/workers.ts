import { sql, schema, eq, and } from "@flux/db";
import type { Database } from "@flux/db";
import type { EmitFn } from "../types";
import { noopEmit } from "../types";

const { workers, workerHeartbeats, jobs } = schema;

export interface RegisterWorkerInput {
  host: string;
  pid?: number;
  concurrency: number;
  projectId?: string | null;
}

/** Register a worker process in the fleet on startup. */
export async function registerWorker(
  db: Database,
  input: RegisterWorkerInput,
  emit: EmitFn = noopEmit,
): Promise<string> {
  const [row] = await db
    .insert(workers)
    .values({
      host: input.host,
      pid: input.pid ?? null,
      concurrency: input.concurrency,
      projectId: input.projectId ?? null,
      status: "starting",
    })
    .returning({ id: workers.id });
  emit({ kind: "worker.registered", workerId: row!.id, host: input.host, at: new Date().toISOString() });
  return row!.id;
}

/**
 * Heartbeat: prove liveness and — crucially — **extend the lease** on every in-flight job
 * this worker holds. This is the live half of the lease protocol: a healthy worker keeps
 * pushing its jobs' `lease_expires_at` into the future so the reaper never touches them;
 * the moment it stops (crash/kill), the leases expire and the reaper reclaims the work.
 * Returns how many in-flight leases were extended.
 */
export async function heartbeat(
  db: Database,
  args: { workerId: string; inFlight: number; leaseSeconds: number },
  emit: EmitFn = noopEmit,
): Promise<number> {
  const { workerId, inFlight, leaseSeconds } = args;

  const extended = await db.transaction(async (tx) => {
    await tx
      .update(workers)
      .set({
        lastHeartbeatAt: new Date(),
        inFlightCount: inFlight,
        // starting -> active on first beat; leave draining/dead untouched.
        status: sql`CASE WHEN ${workers.status} = 'starting' THEN 'active' ELSE ${workers.status} END`,
      })
      .where(eq(workers.id, workerId));

    await tx.insert(workerHeartbeats).values({ workerId, inFlightCount: inFlight });

    const res = await tx.execute(
      sql`UPDATE jobs
          SET lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval
          WHERE claimed_by = ${workerId} AND status IN ('claimed','running')`,
    );
    return res.rowCount ?? 0;
  });

  emit({
    kind: "worker.heartbeat",
    workerId,
    status: "active",
    inFlight,
    at: new Date().toISOString(),
  });
  return extended;
}

/** Enter draining mode (SIGTERM): stop accepting new claims, finish in-flight work. */
export async function markDraining(db: Database, workerId: string): Promise<void> {
  await db.update(workers).set({ status: "draining" }).where(eq(workers.id, workerId));
}

/**
 * Release jobs this worker claimed but had not yet started, back to `queued`, so a
 * shutting-down worker doesn't strand ready work waiting for the reaper.
 */
export async function releaseClaims(db: Database, workerId: string): Promise<number> {
  const res = await db.execute(
    sql`UPDATE jobs
        SET status='queued', claimed_by=NULL, claimed_at=NULL, lease_expires_at=NULL, updated_at=now()
        WHERE claimed_by = ${workerId} AND status = 'claimed'`,
  );
  return res.rowCount ?? 0;
}

/** Deregister on clean shutdown. */
export async function deregisterWorker(
  db: Database,
  workerId: string,
  emit: EmitFn = noopEmit,
): Promise<void> {
  await releaseClaims(db, workerId);
  await db
    .update(workers)
    .set({ status: "stopped", stoppedAt: new Date(), inFlightCount: 0 })
    .where(eq(workers.id, workerId));
  emit({ kind: "worker.stopped", workerId, at: new Date().toISOString() });
}
