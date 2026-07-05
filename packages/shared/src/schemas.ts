import { z } from "zod";
import { JOB_TYPES, RETRY_STRATEGIES } from "./enums";

/* ── Auth ─────────────────────────────────────────────────────────────────── */

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

/* ── Projects & queues ────────────────────────────────────────────────────── */

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  description: z.string().max(2000).optional(),
});

export const createQueueSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).optional(),
  priorityDefault: z.number().int().min(0).max(1000).default(100),
  concurrencyLimit: z.number().int().min(1).max(10_000).default(10),
  retryPolicyId: z.string().uuid().optional(),
  paused: z.boolean().default(false),
});
export type CreateQueueInput = z.infer<typeof createQueueSchema>;

export const updateQueueSchema = createQueueSchema.partial().omit({ slug: true });

/* ── Retry policies ───────────────────────────────────────────────────────── */

export const createRetryPolicySchema = z
  .object({
    name: z.string().min(1).max(120),
    strategy: z.enum(RETRY_STRATEGIES),
    maxAttempts: z.number().int().min(1).max(100).default(3),
    baseDelayMs: z.number().int().min(0).max(86_400_000).default(1000),
    maxDelayMs: z.number().int().min(0).max(86_400_000).default(300_000),
    jitter: z.boolean().default(true),
  })
  .refine((p) => p.maxDelayMs >= p.baseDelayMs, {
    message: "maxDelayMs must be >= baseDelayMs",
    path: ["maxDelayMs"],
  });
export type CreateRetryPolicyInput = z.infer<typeof createRetryPolicySchema>;

/* ── Jobs ─────────────────────────────────────────────────────────────────── */

const cronField = z
  .string()
  .min(1)
  .max(120)
  .describe("5- or 6-field cron expression, e.g. '*/5 * * * *'");

/**
 * Discriminated on `type`. Each variant only accepts the fields that make sense,
 * so an `immediate` job can't smuggle a cron, and a `recurring` job must supply one.
 */
export const createJobSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("immediate"),
    queueId: z.string().uuid(),
    name: z.string().min(1).max(200),
    payload: z.record(z.unknown()).default({}),
    priority: z.number().int().min(0).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    type: z.literal("delayed"),
    queueId: z.string().uuid(),
    name: z.string().min(1).max(200),
    payload: z.record(z.unknown()).default({}),
    delayMs: z.number().int().min(0).max(30 * 86_400_000),
    priority: z.number().int().min(0).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    type: z.literal("scheduled"),
    queueId: z.string().uuid(),
    name: z.string().min(1).max(200),
    payload: z.record(z.unknown()).default({}),
    runAt: z.coerce.date(),
    priority: z.number().int().min(0).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    type: z.literal("recurring"),
    queueId: z.string().uuid(),
    name: z.string().min(1).max(200),
    payload: z.record(z.unknown()).default({}),
    cron: cronField,
    timezone: z.string().min(1).max(64).default("UTC"),
    priority: z.number().int().min(0).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    type: z.literal("batch"),
    queueId: z.string().uuid(),
    name: z.string().min(1).max(200),
    payloads: z.array(z.record(z.unknown())).min(1).max(10_000),
    priority: z.number().int().min(0).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
  }),
]);
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const jobFilterSchema = z.object({
  status: z.string().optional(), // comma-separated statuses
  type: z.enum(JOB_TYPES).optional(),
  queueId: z.string().uuid().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
});

/* ── API keys ─────────────────────────────────────────────────────────────── */

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(["jobs:write", "jobs:read", "queues:read"])).default(["jobs:write", "jobs:read"]),
});
