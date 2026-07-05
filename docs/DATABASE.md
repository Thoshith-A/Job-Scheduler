# Database Design

> PostgreSQL is not just Flux's system of record — **it _is_ the queue**. There is no
> Redis/BullMQ behind it. Every reliability guarantee (no double execution, dead-worker
> recovery, effectively-once creation) is enforced by the schema and the transactional
> claim path below. This document explains every table, key, cascade rule, and index,
> and _why_ each exists.

Migrations are generated and applied only via Drizzle (`pnpm db:generate` /
`pnpm db:migrate`) — the DB is never hand-edited. The schema lives in
[`packages/db/src/schema`](../packages/db/src/schema) as the single source of truth,
sharing its enum definitions with the application layer via `@flux/shared` so the two
can never drift.

## Entity overview

```
organizations ─┬─< organization_members >── users ──< refresh_tokens
               └─< projects ─┬─< api_keys
                             ├─< retry_policies ──(RESTRICT)── queues
                             ├─< queues ─┬─< schedules
                             │           └─< jobs ─┬─< job_executions ─< job_logs
                             │                     └─< dead_letter_queue
                             └─< workers ──< worker_heartbeats
```

15 tables in five domains:

| Domain | Tables |
| --- | --- |
| Identity & tenancy | `users`, `organizations`, `organization_members`, `refresh_tokens`, `projects`, `api_keys` |
| Catalog | `retry_policies`, `queues`, `schedules` |
| The queue | `jobs`, `job_executions`, `job_logs`, `dead_letter_queue` |
| Fleet | `workers`, `worker_heartbeats` |

## Primary keys

Every table uses a **UUID** primary key defaulted via `gen_random_uuid()` (Postgres's
built-in `pgcrypto`-free generator, available since PG 13 — portable across the
docker `postgres:16` image and the embedded PG 18 used for local/CI tests).

- UUIDs let clients generate ids offline, avoid leaking row counts, and keep foreign
  keys stable across environments/imports.
- The one composite PK is `organization_members (organization_id, user_id)` — a pure
  join table where the pair _is_ the identity, so a user can hold exactly one role per org.

> **UUID v7 note:** on PG 18 (`uuidv7()`) we could switch to time-ordered UUIDs for better
> index locality on the append-heavy `jobs`/`job_executions` tables. We default to
> `gen_random_uuid()` for portability to PG 16 and rely on dedicated `created_at`/`ts`
> indexes for time-ordered reads instead.

## Foreign keys & cascade behavior

Deletes are modelled around one principle: **tearing down a tenant is one `DELETE`, but
you can't accidentally strand live work.**

| FK | On delete | Rationale |
| --- | --- | --- |
| `organization_members.{organization_id,user_id}` | CASCADE | Membership is meaningless without both sides. |
| `refresh_tokens.user_id` | CASCADE | Tokens die with the user. |
| `projects.organization_id` | CASCADE | Deleting an org removes its projects… |
| `retry_policies.project_id`, `queues.project_id`, `schedules.project_id`, `jobs.project_id`, `workers.project_id` | CASCADE | …and everything under those projects, in one operation. |
| `queues.retry_policy_id` | **RESTRICT** | A retry policy **in use by a queue cannot be deleted directly** — you must reassign the queue first. Protects running queues from silently losing their backoff config. |
| `jobs.queue_id`, `schedules.queue_id` | CASCADE | Jobs/schedules belong to their queue. |
| `jobs.claimed_by → workers.id` | SET NULL | If a worker row is removed, its jobs keep their history but drop the dangling claim (the reaper then requeues them). |
| `jobs.schedule_id → schedules.id` | SET NULL | A recurring instance outlives the schedule that spawned it. |
| `job_executions.job_id`, `job_logs.job_id`, `dead_letter_queue.job_id` | CASCADE | Attempt history/logs/DLQ rows are owned by the job. |
| `job_executions.worker_id → workers.id` | SET NULL | Preserve attempt history even after a worker deregisters. |

### The RESTRICT + CASCADE "diamond"

`project → queues (CASCADE)`, `project → retry_policies (CASCADE)`, and
`queues → retry_policies (RESTRICT)` form a diamond. This is a classic footgun — a naive
design would let the RESTRICT edge abort a legitimate tenant teardown. We verified with a
real Postgres that deleting an organization cascades cleanly (queues are removed, dropping
the references, before the policies are), **while a direct `DELETE` of an in-use policy
still fails**. Both behaviors are asserted in
[`packages/db` migration verification](../packages/db) and in the concurrency test suite.

## Normalization & deliberate denormalization

The schema is 3NF with two conscious denormalizations, each earning its keep on a hot path:

1. **`jobs.project_id`** is denormalized from `jobs → queues → projects`. The job explorer
   and every tenant-scoped read filters by project; carrying `project_id` on `jobs` turns a
   two-join tenant filter into a single indexed predicate on the largest table in the system.
2. **`workers.in_flight_count`** duplicates a value derivable from
   `count(jobs WHERE claimed_by = worker)`. The heartbeat writes it directly so the fleet
   dashboard and the concurrency accounting never scan `jobs` to render a worker's load.

Both are write-time maintained and tolerant of small skew (the authoritative counts always
come from `jobs`/`job_executions`).

## Index rationale

43 indexes total. The ones that matter for correctness and throughput:

### `jobs` — the hot table

| Index | Definition | Why |
| --- | --- | --- |
| `jobs_claim_idx` | `(queue_id, priority DESC, run_at ASC) WHERE status = 'queued'` | **The claim path.** Column order exactly matches the claim query's `WHERE queue_id=$1 … ORDER BY priority DESC, run_at ASC`, so the planner reads pre-sorted rows with no sort node. It's **partial** — only `queued` rows are indexed — so it stays tiny and cache-resident even with millions of completed jobs. This is the single most performance-critical index in the system. |
| `jobs_lease_idx` | `(lease_expires_at) WHERE status IN ('claimed','running')` | **The reaper path.** Finds in-flight jobs whose lease expired (dead worker) in an index range scan; partial over only in-flight rows. |
| `jobs_promote_idx` | `(run_at) WHERE status = 'scheduled'` | **The scheduler promotion path.** Finds delayed/scheduled/retry-backoff jobs that are now due. |
| `jobs_idempotency_key` | `UNIQUE (queue_id, idempotency_key) WHERE idempotency_key IS NOT NULL` | **Effectively-once creation, enforced by the DB.** Concurrent duplicate submissions collide on this unique index instead of racing in application code. |
| `jobs_project_created_idx` | `(project_id, created_at DESC)` | Job explorer: newest-first tenant listing. |
| `jobs_queue_status_idx` | `(queue_id, status)` | Queue stats (counts by status) and status filters. |
| `jobs_batch_idx` | `(batch_id) WHERE batch_id IS NOT NULL` | Batch drill-down. |

### Other hot paths

| Index | Why |
| --- | --- |
| `job_executions_job_idx` `(job_id)` | Load a job's full attempt history. |
| `job_executions_job_attempt_key` **UNIQUE** `(job_id, attempt_no)` | Database-level backstop for **"no double execution"** — an attempt number can never be recorded twice for a job. |
| `worker_heartbeats_worker_ts_idx` `(worker_id, ts DESC)` | The "pulse" query — latest N beats per worker. |
| `workers_liveness_idx` `(status, last_heartbeat_at)` | Reaper scan for stale workers. |
| `schedules_due_idx` `(next_run_at) WHERE enabled` | Scheduler's cron scan of due, enabled schedules. |
| `users_email_key`, `refresh_tokens_hash_key`, `api_keys_hash_key` | Unique auth lookups. |

## How the schema supports the core guarantees

### Atomic claiming (no double execution)

Workers claim in a single transaction:

```sql
UPDATE jobs SET status='claimed', claimed_by=$worker, claimed_at=now(),
       lease_expires_at = now() + ($lease || ' seconds')::interval
WHERE id IN (
  SELECT id FROM jobs
  WHERE status='queued' AND queue_id=$queue AND run_at <= now()
  ORDER BY priority DESC, run_at ASC
  FOR UPDATE SKIP LOCKED         -- ← concurrent workers skip locked rows instead of blocking
  LIMIT $n
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` means two workers never receive the same row: the first locks it
inside its transaction, the second skips past it. `jobs_claim_idx` makes the inner
`SELECT` an index-only, pre-sorted scan. The `job_executions_job_attempt_key` unique
constraint is a second, independent line of defense. This is exercised directly by the
`no double execution` test (500 jobs, 8 concurrent claim loops, real Postgres).

### Dead-worker recovery (no lost jobs)

Every claim carries `lease_expires_at`. A live worker extends the lease on each heartbeat;
a dead worker stops, so its jobs' leases expire. The reaper scans `jobs_lease_idx` for
in-flight jobs past their lease and either requeues them (`attempts < max_attempts`) or
moves them to `dead_letter_queue`. Recovery keys off the **lease**, not a fixed timeout, so
a merely-slow-but-alive worker (still heartbeating) is never wrongly reaped.

### Effectively-once creation

At-least-once delivery + an idempotency key = effectively-once. The
`jobs_idempotency_key` partial-unique index makes the second concurrent create with the
same `(queue_id, idempotency_key)` fail at the database; the API catches the conflict and
returns the original job.

### Full auditability

`job_executions` is append-only (one row per attempt) and `job_logs` streams per-execution
log lines, so the UI can show a complete retry history and live-tail a running job without
mutating prior attempts.
