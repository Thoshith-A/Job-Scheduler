# Design Decisions & Trade-offs

This document explains the load-bearing engineering choices in Flux — what we chose, the
alternatives we rejected, the specific failure each mechanism prevents, and the costs we
knowingly accepted. Everything here is backed by the code in
[`packages/core`](../packages/core) and the proofs in
[`packages/core/test`](../packages/core/test).

---

## 1. PostgreSQL *is* the queue — and we did not use a prebuilt one

**Decision.** The `jobs` table is the message queue. Dispatch is the canonical Postgres
work-queue pattern — `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction — not Redis,
BullMQ, Celery, SQS, or RabbitMQ.

**Why not a prebuilt queue?**

- **One source of truth, one transaction.** A job's readiness, its claim, its attempt
  history, its dead-letter status, and the tenancy that owns it all live in the same store.
  Claiming a job and recording the attempt happen in one ACID transaction — there is no
  window where the broker and the database disagree, and no dual-write to reconcile.
- **Correctness is expressible as schema.** "No double execution," "effectively-once
  creation," and "recover a crashed worker's jobs" become index/constraint/`FOR UPDATE`
  problems the database solves natively, rather than application-level coordination on top
  of a queue that only guarantees at-least-once delivery.
- **Operational simplicity.** No second stateful system to provision, secure, back up, or
  reason about during an incident. Backups and PITR cover the work queue for free.
- **It is the interesting part.** Reaching for BullMQ would hide the exact concurrency
  problem this project exists to demonstrate. Building the claim path directly is the point.

**The pattern, exactly** ([`claim.ts`](../packages/core/src/engine/claim.ts)):

```sql
UPDATE jobs SET status='claimed', claimed_by=$w, lease_expires_at=now()+($lease||' seconds')::interval
WHERE id IN (
  SELECT id FROM jobs
  WHERE status='queued' AND queue_id=$q AND run_at <= now()
  ORDER BY priority DESC, run_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $take
)
RETURNING …;
```

`FOR UPDATE SKIP LOCKED` is what makes this safe *and* fast under contention: a competing
worker skips a row another worker has locked rather than blocking on it. The partial
`jobs_claim_idx (queue_id, priority DESC, run_at ASC) WHERE status='queued'` matches the
`WHERE`/`ORDER BY` exactly, so the inner select is a pre-sorted index scan that stays
cache-resident even with millions of completed jobs.

**Accepted trade-off.** Throughput is bounded by a single Postgres primary, and the queue
competes with other OLTP work for connections. We mitigate with tight partial indexes, a
poll-then-claim loop, and per-queue parallelism — and we accept that a workload needing
millions of ops/sec would outgrow this design. For the target scale, operational simplicity
and provable correctness win. Proven by **PROOF 1**: 500 jobs, 8 concurrent claim loops →
each job runs exactly once.

---

## 2. Fleet-wide concurrency limit via per-queue `pg_advisory_xact_lock`

**Decision.** A queue's `concurrency_limit` is enforced **across the whole fleet**, not
per worker. Before claiming, a worker takes a **per-queue advisory transaction lock**, then
checks capacity:

```sql
SELECT pg_advisory_xact_lock(hashtext($queueId));                       -- serialize this queue
SELECT count(*) FROM jobs WHERE queue_id=$q AND status IN ('claimed','running');  -- running R
-- take = min(workerFreeCapacity, concurrency_limit - R)
```

**The race it prevents.** `FOR UPDATE SKIP LOCKED` deliberately hands *disjoint* rows to
concurrent workers. Without serialization, two workers could each independently read
`running = R`, each compute headroom `limit - R`, and each claim that many **different**
rows — together blowing past the limit. `SKIP LOCKED` doesn't help here precisely because
the rows don't overlap. The advisory lock makes the read-check-claim sequence atomic *for a
single queue*, so the capacity accounting is authoritative.

**Why an advisory *xact* lock specifically.**

- `hashtext(queueId)` scopes the lock to one queue, so unrelated queues claim fully in
  parallel — the serialization is surgical, not global.
- The `_xact_` variant auto-releases at `COMMIT`, so a crashed/rolled-back worker can never
  leak a held lock. The lock is held only for the microseconds of the capacity check plus
  the `UPDATE`.

**Accepted trade-off.** Claims against a *single* queue are serialized, capping that
queue's claim rate. This is a deliberate exchange of raw single-queue claim throughput for
an exact, easy-to-reason-about limit. Different queues scale independently, which is the
common case. Proven by **PROOF 4**: queue limit = 2, 10 slow jobs, 6 workers → at most 2
ever run at once, and the limit is fully utilized (it would be 1 if the limit weren't
shared).

---

## 3. Lease-based dead-worker recovery, not fixed timeouts

**Decision.** Each claim carries a `lease_expires_at`. A live worker **extends every lease
it holds on each heartbeat** ([`workers.ts`](../packages/core/src/engine/workers.ts)); the
reaper reclaims only jobs whose lease has actually lapsed
([`reaper.ts`](../packages/core/src/engine/reaper.ts)).

**Why leases beat a fixed timeout.** A naive "reclaim any job running longer than N
seconds" wrongly kills legitimately long jobs and races with slow-but-alive workers,
producing exactly the double-execution it was meant to prevent. A lease inverts the
question: recovery keys off *liveness*, not *duration*. A worker that is slow but still
heartbeating keeps pushing its leases into the future and is **never** reaped; only genuine
silence (crash, kill, partition) lets a lease expire.

**The recovery path.** The reaper scans `jobs_lease_idx (lease_expires_at) WHERE status IN
('claimed','running')` with `FOR UPDATE SKIP LOCKED` (so multiple reaper replicas are safe),
marks the mid-flight attempt `lost`, and then either **requeues** the job (attempts remain)
or **dead-letters** it (`lease_expired_max_attempts`). `beginExecution` is guarded by
`WHERE status='claimed' AND claimed_by=$worker`, so if a job is reaped out from under a
worker between claim and start, that worker cleanly loses the race and drops the job.

**Accepted trade-off.** Recovery latency is bounded by the lease length (default 30s) plus
the scheduler tick — a genuinely crashed worker's jobs wait up to that long before another
picks them up. Shorter leases mean faster recovery but more heartbeat write load; the values
are tunable (`WORKER_LEASE_SECONDS`, `WORKER_HEARTBEAT_MS`). Proven by **PROOF 2**: a job
held by a "crashed" worker (lease forced into the past) is reclaimed, its lost attempt is
recorded, and another worker completes it — with attempt count intact.

---

## 4. At-least-once + idempotency keys = effectively-once creation

**Decision.** Flux delivers **at-least-once** (a crashed worker's job is retried), and turns
that into **effectively-once** at the boundaries where it matters — **enforced by the
database**, not application code.

**Creation.** An optional `Idempotency-Key` (per queue) is backed by the partial-unique
index `jobs_idempotency_key UNIQUE (queue_id, idempotency_key) WHERE idempotency_key IS NOT
NULL`. Two concurrent creates with the same key **collide at the database**; the loser
catches the `23505` unique violation and returns the *original* job with `deduplicated:
true` ([`enqueue.ts`](../packages/core/src/engine/enqueue.ts)). No read-then-write race in
app code, because the uniqueness is a constraint, not a check.

**Why the DB and not app-level "check if exists."** A `SELECT`-then-`INSERT` has a TOCTOU
window under concurrency; a unique index has none. The database is the only component that
sees all writers.

**Accepted trade-off.** Effectively-once creation requires the caller to supply a stable
key; without one, a client that retries a create can produce duplicates (standard
at-least-once). Execution remains at-least-once by design — handlers should be idempotent
for genuinely exactly-once side effects. Proven by **PROOF 5**: two concurrent creates with
the same key produce exactly one row; a different key produces a distinct job.

---

## 5. The status model — and why retries rest in `scheduled`

**Decision.** Job status is `scheduled · queued · claimed · running · completed · failed ·
dead · canceled` ([`enums.ts`](../packages/shared/src/enums.ts)). The key invariant:
**`queued` means "runnable right now."**

Anything not yet runnable — a `delayed` job, a future-dated `scheduled` job, or a job in
**retry backoff** — rests in `scheduled` with a future `run_at`. On failure with retries
remaining, `failJob` sets `status='scheduled', run_at = now + backoff`; the scheduler's
`promoteDueJobs` flips it back to `queued` once due
([`lifecycle.ts`](../packages/core/src/engine/lifecycle.ts),
[`promote.ts`](../packages/core/src/engine/promote.ts)).

**Why this matters.**

- **The claim index stays tiny and hot.** Because it's partial over only `queued` rows,
  jobs sleeping in backoff or waiting for a future time never bloat the hot path — the
  single most performance-critical index in the system stays cache-resident.
- **One promotion path** unifies delayed jobs, future-dated jobs, and retry-backoff jobs.
  There is exactly one place a job becomes runnable, which is easy to reason about and to
  make race-safe (the promotion `UPDATE … FOR UPDATE SKIP LOCKED` is idempotent under
  concurrent schedulers).

`dead` always has a corresponding `dead_letter_queue` row, so the DLQ is a first-class,
browsable table rather than a status filter — the reliability tests literally assert a job
"lands in the DLQ."

---

## 6. Append-only `job_executions` + the `(job_id, attempt_no)` backstop

**Decision.** Every attempt is a **new row** in `job_executions`; retrying never mutates a
prior attempt. The table carries a unique index on `(job_id, attempt_no)`.

**Why append-only.** It yields a complete, immutable audit trail — the UI shows every
attempt with per-attempt timing and error, and can live-tail a running attempt via
`job_logs` — without ever overwriting history. Executions transition through
`running → completed | failed | timed_out | lost`.

**The unique constraint as a correctness backstop.** `job_executions_job_attempt_key`
guarantees an attempt number can be recorded **at most once** per job. This is a second,
*independent* line of defense behind `FOR UPDATE SKIP LOCKED`: even a hypothetical bug that
tried to start the same attempt twice would be rejected by the database. Correctness does
not rest on a single mechanism, and it does not rest on a test passing — it is enforced by a
constraint at write time.

---

## 7. Redis behind interfaces, with in-memory fallbacks (zero external deps)

**Decision.** Three infrastructure concerns — `EventBus`, `DistributedLock`, and
`RateLimiter` — are each an **interface** with a Redis implementation and an in-memory
fallback ([`packages/infra`](../packages/infra)). `createRedis(url)` returns `null` when
`REDIS_URL` is unset, which is the signal for each factory to select its in-memory variant.

**What this buys.**

- **The whole system runs on Postgres alone.** Dev, CI, and the no-Docker local stack need
  zero external services; production opts into Redis by setting one env var.
- **Redis is never on the correctness-critical path.** The queue's guarantees live entirely
  in Postgres. Redis powers cross-process concerns only:
  - **EventBus** — Redis pub/sub fans `flux` events across API replicas; in-memory only
    reaches same-process subscribers (so the dashboard also polls as a baseline).
  - **DistributedLock** — a fenced, TTL'd Redis lock (`SET NX PX` + compare-and-delete via
    Lua) elects a single active scheduler among replicas; in-memory is a process-local guard,
    so with no Redis you run a single scheduler.
  - **RateLimiter** — an atomic token bucket in a single Lua round-trip (correct across API
    replicas); in-memory is per-process.

**Accepted trade-off.** With the in-memory implementations, these features are correct only
within one process: events don't cross replicas, the leader lock doesn't coordinate multiple
schedulers, and rate limits are per-instance. That is exactly the right behavior for
single-node dev and a conscious, clearly-scoped degradation for multi-replica production
(where you enable Redis).

---

## 8. Embedded Postgres for tests — the proofs run against *real* Postgres

**Decision.** The test harness ([`@flux/testing`](../packages/testing)) boots a real,
throwaway Postgres from **embedded binaries** (no Docker), applies the exact production
Drizzle migrations, and hands back a live client.

**Why this is non-negotiable for this project.** The guarantees Flux claims — `FOR UPDATE
SKIP LOCKED` semantics, transaction isolation, advisory locks, unique-index conflict
behavior — **do not exist** in a mock or an in-memory SQL emulation. A test against a fake
would prove nothing. Running against genuine Postgres is what makes the concurrency proofs
*proofs*: they exercise the same primitives production uses, including a 40-connection pool
so 8 claim loops truly contend. The harness even creates the DB as UTF-8 with `template0` so
Windows locales can't reject UTF-8 payloads — the test DB matches the Docker `postgres:16`
database.

**Result.** `pnpm test` runs `@flux/core`'s 15-test suite — the 5 concurrency proofs plus
10 retry/cron unit tests — all green, plus a worker↔scheduler integration test in
[`apps/worker/test`](../apps/worker/test) that drives the *actual* runtimes end-to-end. No
Docker required to prove correctness; Docker is provided only for the graded demo.

---

## 9. Consciously accepted trade-offs (summary)

| Choice | We gave up… | Because… |
| --- | --- | --- |
| Postgres-as-queue | Very-high-throughput ceiling of a dedicated broker | One transactional source of truth; provable correctness; operational simplicity. |
| Per-queue advisory lock | Single-queue claim throughput (serialized) | An exact fleet-wide concurrency limit that's trivial to reason about; other queues stay parallel. |
| Leases (default 30s) | Instant crash recovery | Never mis-reaping a slow-but-alive worker; recovery latency is tunable. |
| Idempotency requires a caller-supplied key | Automatic dedup without a key | Effectively-once where it matters, at-least-once everywhere else (handlers should be idempotent). |
| Offset pagination | Deep-scan efficiency at huge offsets | Simple, jumpable pages with a hard `limit` cap; the hot filters are indexed. |
| In-memory infra fallbacks | Cross-replica correctness without Redis | Zero-dependency dev/CI; production opts into Redis for multi-replica coordination. |
| `gen_random_uuid()` PKs | Index locality of time-ordered UUIDs | Portability across PG 16/18; dedicated `created_at`/`ts` indexes cover time-ordered reads. |
| Poll-based worker loop | Sub-millisecond dispatch latency of push | Simplicity and robustness; poll interval (`WORKER_POLL_MS`) trades latency for load. |

Each row is a deliberate exchange, not an oversight — chosen so that the properties this
system is meant to demonstrate (correctness under concurrency, safe recovery, effectively-once
creation) are the ones it guarantees, provably, against a real database.
