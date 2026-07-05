export * from "./client";
export * as schema from "./schema/index";
export { runMigrations } from "./migrate";

// Re-export drizzle-orm query helpers so consumers import them from one place and
// stay on the exact same drizzle-orm instance as the schema (avoids dual-package
// hazards across the monorepo).
export {
  sql,
  eq,
  ne,
  and,
  or,
  not,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  gt,
  gte,
  desc,
  asc,
  count,
  countDistinct,
  ilike,
} from "drizzle-orm";
