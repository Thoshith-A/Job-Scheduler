import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDb, runMigrations, schema, type DbHandle, type Database } from "@flux/db";
import type { RetryStrategy } from "@flux/shared";

export interface TestDb extends DbHandle {
  url: string;
  /** Truncate every table so a fresh test starts from an empty schema. */
  reset: () => Promise<void>;
  /** Stop the pool and the embedded Postgres cluster. */
  stop: () => Promise<void>;
}

/**
 * Boot a REAL, throwaway Postgres (embedded binaries — no Docker), apply the exact
 * production migrations, and hand back a Drizzle client. This is what makes the
 * concurrency proofs meaningful: they run against a genuine multi-connection Postgres
 * with real `FOR UPDATE SKIP LOCKED` semantics, not a mock or an in-memory emulation.
 */
export async function createTestDb(): Promise<TestDb> {
  // Random high port so parallel clusters (if any) don't collide.
  const port = 54000 + Math.floor(Math.random() * 4000);
  const dataDir = path.join(os.tmpdir(), `flux-test-${process.pid}-${randomUUID().slice(0, 8)}`);

  const embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  await embedded.initialise();
  await embedded.start();

  // Create the app database explicitly as UTF-8. On Windows the cluster's default locale
  // can be WIN1252 (which would reject UTF-8 payloads/log lines); template0 + explicit
  // ENCODING guarantees we match the production (docker postgres) UTF-8 database.
  const admin = new pg.Client({
    host: "localhost",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE flux_test WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await admin.end();

  const url = `postgres://postgres:postgres@localhost:${port}/flux_test`;
  await runMigrations(url);

  // Pool large enough for many concurrent claim loops + heartbeats in tests.
  const handle = createDb(url, { max: 40, applicationName: "flux-test" });

  return {
    ...handle,
    url,
    reset: async () => {
      await handle.pool.query(`TRUNCATE TABLE
        dead_letter_queue, job_logs, job_executions, jobs, schedules, queues, retry_policies,
        worker_heartbeats, workers, api_keys, projects, refresh_tokens, organization_members,
        organizations, users RESTART IDENTITY CASCADE`);
    },
    stop: async () => {
      // Defensive: a dropped idle client while the cluster shuts down must not fail the run.
      try {
        await handle.close();
      } catch {
        /* pool already draining */
      }
      try {
        await embedded.stop();
      } catch {
        /* cluster already stopped */
      }
    },
  };
}

export interface SeedResult {
  organizationId: string;
  projectId: string;
  queueId: string;
  retryPolicyId: string | null;
}

/**
 * Seed a minimal org -> project -> queue (with an optional retry policy) so tests can
 * get straight to exercising the engine.
 */
export async function seedQueue(
  db: Database,
  opts: {
    concurrencyLimit?: number;
    paused?: boolean;
    retryPolicy?: {
      strategy: RetryStrategy;
      maxAttempts: number;
      baseDelayMs: number;
      maxDelayMs: number;
      jitter: boolean;
    };
  } = {},
): Promise<SeedResult> {
  const suffix = randomUUID().slice(0, 8);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning({ id: schema.organizations.id });
  const [project] = await db
    .insert(schema.projects)
    .values({ organizationId: org!.id, name: `Project ${suffix}`, slug: `proj-${suffix}` })
    .returning({ id: schema.projects.id });

  let retryPolicyId: string | null = null;
  if (opts.retryPolicy) {
    const [rp] = await db
      .insert(schema.retryPolicies)
      .values({ projectId: project!.id, name: `rp-${suffix}`, ...opts.retryPolicy })
      .returning({ id: schema.retryPolicies.id });
    retryPolicyId = rp!.id;
  }

  const [queue] = await db
    .insert(schema.queues)
    .values({
      projectId: project!.id,
      name: `Queue ${suffix}`,
      slug: `queue-${suffix}`,
      concurrencyLimit: opts.concurrencyLimit ?? 100,
      paused: opts.paused ?? false,
      retryPolicyId,
    })
    .returning({ id: schema.queues.id });

  return {
    organizationId: org!.id,
    projectId: project!.id,
    queueId: queue!.id,
    retryPolicyId,
  };
}
