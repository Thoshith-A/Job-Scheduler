import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client backed by a node-postgres connection pool.
 * Every service (api / scheduler / worker) creates its own handle sized for its
 * workload — workers need a pool large enough for their concurrency + heartbeat.
 */
export function createDb(
  connectionString: string,
  opts: { max?: number; applicationName?: string } = {},
): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? "flux",
    // Keep-alive so idle pooled connections survive between claim polls.
    keepAlive: true,
  });

  // An idle backend can drop (server restart, network blip, shutdown). Without a handler,
  // node-postgres emits an 'error' on the Pool that crashes the process. Swallow it here —
  // the pool transparently reconnects on the next checkout.
  pool.on("error", (err) => {
    console.error(`[flux/db] idle pool client error: ${err.message}`);
  });

  const db = drizzle(pool, { schema, casing: "snake_case" });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
