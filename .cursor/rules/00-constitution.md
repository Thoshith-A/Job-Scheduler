# Project: Flux — Distributed Job Scheduler

Production-inspired distributed job scheduling platform.
Optimize for correctness, reliability, and clean modular architecture over feature count.

## Stack
- Monorepo: pnpm workspaces + Turborepo
- Backend API: NestJS + TypeScript, class-validator DTOs, global exception filter
- DB: PostgreSQL via Drizzle ORM. The job queue lives in Postgres.
- Local/CI without Docker: `embedded-postgres` (real Postgres binaries). docker-compose for the demo.
- Redis via ioredis for rate limiting, distributed locks, pub/sub ONLY — never the queue core.
  All three are behind interfaces with in-memory fallbacks so the system runs with zero deps.
- Scheduler + Worker are SEPARATE processes, not part of the API.
- Frontend: Next.js App Router, React Three Fiber + drei + postprocessing, TanStack Query,
  socket.io-client, Tailwind + shadcn-style UI, Framer Motion.
- Tests: Vitest + embedded-postgres (real Postgres, no DB mocks for concurrency tests).
- Logging: pino, structured JSON, correlation IDs.

## Hard rules
- NEVER use a prebuilt queue library (BullMQ/Celery/etc.) for the core scheduler. Build it.
- Claim jobs atomically with `FOR UPDATE SKIP LOCKED` inside a transaction. Never race.
- Every mutating endpoint validates input and returns structured errors: {error, code, details, requestId}.
- List endpoints support pagination, filtering, and sorting.
- Support idempotency keys on job creation.
- All count/time-critical operations run in transactions.
- Migrations only via Drizzle. Never hand-edit the DB.
- Write a test alongside every non-trivial reliability feature.

## Code quality
- Small modules, dependency injection, single responsibility.
- No `any`. Strict TypeScript. Domain logic is pure and lives in packages/core.
