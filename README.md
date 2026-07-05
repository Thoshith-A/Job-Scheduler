# Flux — Distributed Job Scheduler

![tests](https://img.shields.io/badge/tests-15%2F15%20green-brightgreen)
![queue](https://img.shields.io/badge/queue-Postgres--native-336791)
![claim](https://img.shields.io/badge/claim-FOR%20UPDATE%20SKIP%20LOCKED-0a7cff)
![node](https://img.shields.io/badge/node-%3E%3D20-43853d)
![pnpm](https://img.shields.io/badge/pnpm%20workspaces-turborepo-f69220)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

Flux is a distributed job scheduler whose queue **is a PostgreSQL table** — not Redis,
not BullMQ, not Celery. Work is dispatched with the canonical Postgres work-queue
pattern (`FOR UPDATE SKIP LOCKED` inside a transaction), dead workers are recovered
through time-boxed **leases**, and every reliability guarantee is backed by a concurrency
proof that runs against a **real** Postgres.

> **Headline:** A Postgres-native queue with atomic `FOR UPDATE SKIP LOCKED` claiming,
> lease-based dead-worker recovery, and effectively-once job creation — **provably
> correct**: `@flux/core`'s 15-test suite (5 concurrency proofs on a real embedded
> Postgres + 10 retry/cron unit tests) is 15/15 green, plus a worker↔scheduler
> integration test.

---

## Why it's interesting

- **The database is the message broker.** No separate queue system to operate, back up,
  or reason about. One transactional store holds the work, the attempt history, the
  dead-letter queue, and the tenancy model — and enforces correctness with indexes and
  constraints instead of application-level locking.
- **Correctness is demonstrated, not asserted.** The hard guarantees (no double
  execution, no lost jobs, fleet-wide concurrency limits, effectively-once creation) are
  each pinned by a test that exercises real `FOR UPDATE SKIP LOCKED`, real transactions,
  and real advisory locks on an embedded Postgres — **no Docker required to prove it**.
- **Runs with zero external dependencies in dev.** Redis powers rate limiting, the
  distributed leader lock, and event pub/sub — but each has an in-memory fallback, so the
  whole system boots on Postgres alone.

---

## Architecture at a glance

```
                    ┌───────────────┐        ┌──────────────────────┐
   browser ───────▶ │ web (Next.js) │ ─────▶ │  api (NestJS, :4000)  │
                    │  control room │  REST  │  auth · RBAC · CRUD   │
                    └───────▲───────┘  + WS  │  jobs · metrics · AI  │
                            │ socket.io      └───────────┬───────────┘
                            └── flux events ─────────────┤
                                                         │ SQL
                    ┌────────────────────┐               ▼
                    │ scheduler (leader   │ ◀────────▶ ┌─────────────────┐
                    │  lock) promote·cron │    SQL     │  PostgreSQL     │
                    │  ·reaper            │            │  :5432          │
                    └────────────────────┘            │  (THE QUEUE)    │
                    ┌────────────────────┐    SQL     └─────────────────┘
                    │ worker × N          │ ◀────────────────┘
                    │ claim·run·heartbeat │
                    └────────────────────┘
                    ┌────────────────────┐
                    │ redis :6379         │  rate limit · leader lock · pub/sub
                    │ (optional)          │  (in-memory fallback if absent)
                    └────────────────────┘
```

- **`web`** — Next.js 14 real-time dashboard (React Three Fiber control room, TanStack
  Query, socket.io-client). Reads the REST API and animates from live `flux` events.
- **`api`** — NestJS. Auth (JWT + argon2id + refresh-token rotation), org-scoped RBAC,
  all CRUD, job submission (all 5 types), retry policies, DLQ, worker/fleet views,
  Prometheus `/metrics`, the socket.io gateway, and AI failure summaries.
- **`scheduler`** — promotes due jobs, fires cron schedules, and runs the lease reaper.
  A distributed leader lock means you can run replicas for HA without double-work.
- **`worker`** — claims work atomically, executes it with bounded concurrency,
  heartbeats to extend leases, and drains gracefully on `SIGTERM`.
- **`postgres`** — the system of record **and** the queue.
- **`redis`** — rate limiting, the scheduler leader lock, and cross-process event fan-out.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture and sequence
diagrams.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Language | TypeScript (Node ≥ 20, ESM) |
| Queue / store | PostgreSQL (16 in Docker, embedded PG for tests/local) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| API | NestJS, JWT (`@nestjs/jwt`), argon2, socket.io, Zod, prom-client |
| AI | Anthropic Messages API (`@anthropic-ai/sdk`), with a deterministic fallback |
| Redis (optional) | ioredis — pub/sub, token-bucket rate limit, leader lock |
| Web | Next.js 14, React Three Fiber, TanStack Query, Tailwind, Framer Motion |
| Tests | Vitest against a real embedded Postgres (`embedded-postgres`) |

---

## Quick start

Copy the environment template first (both paths read it):

```bash
cp .env.example .env
```

Ports used across the stack: **api `4000`**, **web `3000`**, **postgres `5432`**,
**redis `6379`**.

### Option A — Docker (one command)

```bash
docker compose up
```

This boots Postgres, Redis, the API, the scheduler, one worker, and the web dashboard.
Open the dashboard at **http://localhost:3000** and the API at **http://localhost:4000**.

**Prove distribution across a worker fleet** — scale workers horizontally and watch the
same queue drained by multiple independent processes without a single job running twice:

```bash
docker compose up --scale worker=3
```

The three workers compete for the same rows; `FOR UPDATE SKIP LOCKED` and per-queue
advisory locks guarantee each job is claimed by exactly one of them, and the fleet-wide
concurrency limit is honored across all three.

### Option B — No Docker (embedded Postgres)

No database to install — tests and the local stack spin up an embedded Postgres.

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Build the packages the apps/tests depend on
pnpm --filter @flux/db build && pnpm --filter @flux/shared build

# 3. Run the concurrency proofs against a REAL embedded Postgres (no Docker)
pnpm test

# 4. Boot the whole system locally on embedded Postgres
pnpm stack:local
```

- **`pnpm test`** runs the reliability proofs in `@flux/core` (and the
  worker↔scheduler integration test) against a genuine, throwaway Postgres cluster —
  real `FOR UPDATE SKIP LOCKED`, real transactions, real advisory locks.
- **`pnpm stack:local`** boots an embedded Postgres, applies the production migrations,
  and starts the API, scheduler, worker, and web dashboard against it — the full system
  with no external services.

> **Redis is optional.** Leave `REDIS_URL` unset and Flux falls back to in-memory
> implementations of the event bus, rate limiter, and distributed lock, so everything
> runs on Postgres alone. Set `REDIS_URL` (docker-compose does) to fan events across
> replicas and enable the multi-replica scheduler leader lock.

---

## What makes this correct

Reliability isn't a claim in Flux — it's a test suite. `@flux/core`'s proofs run against
a real embedded Postgres (see [`packages/core/test`](packages/core/test)):

| Proof | What it demonstrates |
| --- | --- |
| **No double execution** | 500 jobs, 8 concurrent claim loops → every job runs **exactly once** (N execution rows over N distinct jobs, all `attempt_no = 1`). |
| **Dead-worker recovery** | A worker claims + starts a job then "crashes"; the reaper reclaims the expired lease, marks the lost attempt `lost`, and another worker completes it — no lost work. |
| **Retry → backoff → DLQ** | Attempts increment, `run_at` advances exponentially, and after the budget is exhausted the job lands in the dead-letter queue with the right reason. |
| **Fleet-wide concurrency** | Queue limit = 2, 10 slow jobs, 6 workers → **at most 2** ever run simultaneously (and the limit is fully utilized). |
| **Idempotency / effectively-once** | Two concurrent creates with the same idempotency key produce **exactly one** job; the loser gets the original back. |

Plus 10 pure unit tests for backoff math and cron, and a full worker↔scheduler
integration test in [`apps/worker/test`](apps/worker/test) that drains a queue,
dead-letters permanent failures, and fires a cron schedule end-to-end.

The mechanics behind each guarantee are dissected in
[`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md) and
[`docs/DATABASE.md`](docs/DATABASE.md).

---

## Project structure

```
.
├── apps/
│   ├── api/          NestJS REST API + socket.io gateway (:4000)
│   ├── scheduler/    Promotion + cron + reaper (leader-locked)
│   ├── worker/       Claim loop, heartbeat, graceful drain (scale to N)
│   └── web/          Next.js 14 real-time control room (:3000)
├── packages/
│   ├── shared/       @flux/shared — enums, Zod schemas, events, errors, config
│   ├── db/           @flux/db — Drizzle schema (15 tables) + migrations
│   ├── core/         @flux/core — the engine (claim, reaper, promote, lifecycle,
│   │                 workers, enqueue) + the concurrency PROOFS
│   ├── infra/        @flux/infra — EventBus / DistributedLock / RateLimiter
│   │                 (Redis + in-memory) + pino logger
│   └── testing/      embedded-postgres harness (real PG, no Docker)
├── docs/             ARCHITECTURE · ER · API · DESIGN_DECISIONS · DATABASE
├── .env.example      copy to .env
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, service responsibilities, the job lifecycle, and the claim / lease / reaper protocols (with sequence diagrams). |
| [`docs/ER.md`](docs/ER.md) | Entity-relationship diagram of all 15 tables with keys, FKs, and cascade rules. |
| [`docs/API.md`](docs/API.md) | Full REST reference (every endpoint, auth, body, response, `curl`), the error envelope, and the WebSocket event stream. |
| [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md) | The key decisions and trade-offs — Postgres-as-queue, advisory-lock concurrency, leases, idempotency, and more. |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Deep dive on the schema: every table, key, cascade, and index, and why each exists. |

---

## License

MIT.
