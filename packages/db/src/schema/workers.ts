import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { workerStatusEnum } from "./enums";
import { projects } from "./auth";

/**
 * A worker is a running process in the fleet. It registers on startup, heartbeats
 * every few seconds, and deregisters on graceful shutdown. Liveness is derived from
 * `lastHeartbeatAt` / lease expiry — a worker that stops heartbeating is considered
 * dead and the reaper reclaims its in-flight jobs.
 */
export const workers = pgTable(
  "workers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Nullable: a worker may serve queues across a project or the whole instance.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    pid: integer("pid"),
    status: workerStatusEnum("status").notNull().default("starting"),
    concurrency: integer("concurrency").notNull().default(1),
    inFlightCount: integer("in_flight_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    // The reaper scans for workers whose heartbeat has gone stale.
    index("workers_liveness_idx").on(t.status, t.lastHeartbeatAt),
  ],
);

/**
 * Append-only heartbeat log — one row per beat. Powers the "worker pulse" in the
 * dashboard and gives an audit trail of in-flight counts over time. Old rows are
 * pruned by a maintenance job (see scheduler).
 */
export const workerHeartbeats = pgTable(
  "worker_heartbeats",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    inFlightCount: integer("in_flight_count").notNull().default(0),
  },
  (t) => [
    // "Latest N beats for this worker" — the pulse query.
    index("worker_heartbeats_worker_ts_idx").on(t.workerId, t.ts.desc()),
  ],
);
