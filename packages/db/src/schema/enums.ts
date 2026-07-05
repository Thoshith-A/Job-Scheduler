import { pgEnum } from "drizzle-orm/pg-core";
import {
  JOB_STATUSES,
  JOB_TYPES,
  EXECUTION_STATUSES,
  WORKER_STATUSES,
  ORG_ROLES,
  RETRY_STRATEGIES,
  DLQ_REASONS,
} from "@flux/shared";

// Postgres enum types, sourced from the single shared enum tuples so the DB and
// application code can never drift out of sync. The cast preserves the *literal* union
// (e.g. "fixed" | "linear" | "exponential"), not just `string`, so Drizzle infers the
// precise column type for status/type/etc. across the whole codebase.
const tuple = <T extends readonly [string, ...string[]]>(a: T) =>
  a as unknown as [T[number], ...T[number][]];

export const jobStatusEnum = pgEnum("job_status", tuple(JOB_STATUSES));
export const jobTypeEnum = pgEnum("job_type", tuple(JOB_TYPES));
export const executionStatusEnum = pgEnum("execution_status", tuple(EXECUTION_STATUSES));
export const workerStatusEnum = pgEnum("worker_status", tuple(WORKER_STATUSES));
export const orgRoleEnum = pgEnum("org_role", tuple(ORG_ROLES));
export const retryStrategyEnum = pgEnum("retry_strategy", tuple(RETRY_STRATEGIES));
export const dlqReasonEnum = pgEnum("dlq_reason", tuple(DLQ_REASONS));
