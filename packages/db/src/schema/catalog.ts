import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { retryStrategyEnum } from "./enums";
import { projects } from "./auth";

/**
 * Retry policy — how a queue's failed jobs back off before the next attempt.
 * Referenced by queues; a queue without one uses the engine defaults.
 */
export const retryPolicies = pgTable(
  "retry_policies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    strategy: retryStrategyEnum("strategy").notNull().default("exponential"),
    maxAttempts: integer("max_attempts").notNull().default(3),
    baseDelayMs: integer("base_delay_ms").notNull().default(1000),
    maxDelayMs: integer("max_delay_ms").notNull().default(300_000),
    jitter: boolean("jitter").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("retry_policies_project_idx").on(t.projectId)],
);

/**
 * A queue is a named channel of work with its own concurrency ceiling and retry policy.
 * `concurrencyLimit` is enforced fleet-wide (not per worker) — the claim path counts
 * running jobs for the queue before granting new claims.
 */
export const queues = pgTable(
  "queues",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    priorityDefault: integer("priority_default").notNull().default(100),
    concurrencyLimit: integer("concurrency_limit").notNull().default(10),
    // RESTRICT: a retry policy that is in use by a queue cannot be deleted directly;
    // you must reassign the queue first. Protects live queues from losing their policy.
    retryPolicyId: uuid("retry_policy_id").references(() => retryPolicies.id, {
      onDelete: "restrict",
    }),
    paused: boolean("paused").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Queue slugs are unique within a project.
    uniqueIndex("queues_project_slug_key").on(t.projectId, t.slug),
    index("queues_project_idx").on(t.projectId),
  ],
);

/**
 * Recurring schedule (cron). The scheduler scans enabled schedules whose
 * `nextRunAt <= now()`, enqueues a job, then advances `nextRunAt` using the
 * cron expression in the given timezone.
 */
export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    // Template payload copied onto each enqueued instance.
    payloadTemplate: text("payload_template").notNull().default("{}"),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastJobId: uuid("last_job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The scheduler's hot scan: enabled schedules that are due. Partial index keeps it
    // tiny — only enabled schedules are indexed, ordered by when they next fire.
    index("schedules_due_idx")
      .on(t.nextRunAt)
      .where(sql`${t.enabled} = true`),
    index("schedules_queue_idx").on(t.queueId),
  ],
);
