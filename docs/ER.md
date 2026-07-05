# Entity-Relationship Model

Flux's schema is **15 tables in five domains**, defined in
[`packages/db/src/schema`](../packages/db/src/schema) as the single source of truth (its
enums are shared with the application via `@flux/shared` so the two can never drift). Every
table has a `uuid` primary key defaulted with `gen_random_uuid()`; the one composite PK is
`organization_members (organization_id, user_id)`.

This document is the map. For the full rationale behind every key, cascade rule, and index,
see [`docs/DATABASE.md`](DATABASE.md).

| Domain | Tables |
| --- | --- |
| Identity & tenancy | `users`, `organizations`, `organization_members`, `refresh_tokens`, `projects`, `api_keys` |
| Catalog | `retry_policies`, `queues`, `schedules` |
| The queue | `jobs`, `job_executions`, `job_logs`, `dead_letter_queue` |
| Fleet | `workers`, `worker_heartbeats` |

## Diagram

```mermaid
erDiagram
    users ||--o{ organization_members : "member of"
    organizations ||--o{ organization_members : "has member"
    users ||--o{ refresh_tokens : "owns"
    organizations ||--o{ projects : "owns"
    projects ||--o{ api_keys : "has"
    projects ||--o{ retry_policies : "defines"
    projects ||--o{ queues : "contains"
    projects ||--o{ schedules : "scopes"
    projects ||--o{ jobs : "scopes"
    projects ||--o{ workers : "may scope"
    retry_policies ||--o{ queues : "backs (RESTRICT)"
    queues ||--o{ schedules : "has"
    queues ||--o{ jobs : "holds"
    queues ||--o{ dead_letter_queue : "collects"
    schedules ||--o{ jobs : "spawns (SET NULL)"
    jobs ||--o{ job_executions : "has attempts"
    jobs ||--o{ job_logs : "logs"
    jobs ||--o| dead_letter_queue : "dead-letters (0..1)"
    workers ||--o{ jobs : "claims (SET NULL)"
    workers ||--o{ job_executions : "runs (SET NULL)"
    workers ||--o{ worker_heartbeats : "beats"
    job_executions ||--o{ job_logs : "scopes (SET NULL)"

    users {
        uuid id PK
        text email UK "unique"
        text password_hash "argon2id"
        text name
        timestamptz created_at
        timestamptz updated_at
    }

    organizations {
        uuid id PK
        text name
        text slug UK "unique"
        timestamptz created_at
        timestamptz updated_at
    }

    organization_members {
        uuid organization_id PK,FK "-> organizations (CASCADE)"
        uuid user_id PK,FK "-> users (CASCADE)"
        org_role role "owner|admin|member, default member"
        timestamptz created_at
    }

    refresh_tokens {
        uuid id PK
        uuid user_id FK "-> users (CASCADE)"
        text token_hash UK "sha-256"
        uuid replaced_by "rotation chain"
        timestamptz revoked_at
        timestamptz expires_at
        timestamptz created_at
    }

    projects {
        uuid id PK
        uuid organization_id FK "-> organizations (CASCADE)"
        text name
        text slug "unique per org"
        text description
        timestamptz created_at
        timestamptz updated_at
    }

    api_keys {
        uuid id PK
        uuid project_id FK "-> projects (CASCADE)"
        text name
        text key_hash UK "sha-256"
        text key_prefix "public display prefix"
        jsonb scopes "string[]"
        timestamptz last_used_at
        timestamptz revoked_at
        timestamptz created_at
    }

    retry_policies {
        uuid id PK
        uuid project_id FK "-> projects (CASCADE)"
        text name
        retry_strategy strategy "fixed|linear|exponential"
        integer max_attempts "default 3"
        integer base_delay_ms "default 1000"
        integer max_delay_ms "default 300000"
        boolean jitter "default true"
        timestamptz created_at
        timestamptz updated_at
    }

    queues {
        uuid id PK
        uuid project_id FK "-> projects (CASCADE)"
        text name
        text slug "unique per project"
        text description
        integer priority_default "default 100"
        integer concurrency_limit "fleet-wide, default 10"
        uuid retry_policy_id FK "-> retry_policies (RESTRICT), nullable"
        boolean paused "default false"
        timestamptz created_at
        timestamptz updated_at
    }

    schedules {
        uuid id PK
        uuid project_id FK "-> projects (CASCADE)"
        uuid queue_id FK "-> queues (CASCADE)"
        text name
        text cron
        text timezone "IANA, default UTC"
        text payload_template "JSON string"
        boolean enabled "default true"
        timestamptz next_run_at "indexed WHERE enabled"
        timestamptz last_run_at
        uuid last_job_id
        timestamptz created_at
        timestamptz updated_at
    }

    jobs {
        uuid id PK
        uuid project_id FK "-> projects (CASCADE), denormalized"
        uuid queue_id FK "-> queues (CASCADE)"
        text name
        job_type type "immediate|delayed|scheduled|recurring|batch"
        job_status status "default queued"
        jsonb payload
        integer priority "default 100"
        timestamptz run_at "when it becomes runnable"
        integer attempts "default 0"
        integer max_attempts "default 3"
        text last_error
        text idempotency_key "UNIQUE per (queue_id,key) when set"
        uuid claimed_by FK "-> workers (SET NULL)"
        timestamptz claimed_at
        timestamptz lease_expires_at "linchpin of recovery"
        uuid batch_id
        uuid parent_job_id
        uuid schedule_id FK "-> schedules (SET NULL)"
        timestamptz started_at
        timestamptz finished_at
        timestamptz created_at
        timestamptz updated_at
    }

    job_executions {
        uuid id PK
        uuid job_id FK "-> jobs (CASCADE)"
        uuid worker_id FK "-> workers (SET NULL)"
        integer attempt_no "UNIQUE per (job_id,attempt_no)"
        execution_status status "running|completed|failed|timed_out|lost"
        text error
        timestamptz started_at
        timestamptz finished_at
        integer duration_ms
    }

    job_logs {
        uuid id PK
        uuid job_id FK "-> jobs (CASCADE)"
        uuid execution_id FK "-> job_executions (CASCADE), nullable"
        text level "default info"
        text message
        timestamptz ts
    }

    dead_letter_queue {
        uuid id PK
        uuid job_id FK "-> jobs (CASCADE), UNIQUE"
        uuid queue_id FK "-> queues (CASCADE)"
        dlq_reason reason "max_attempts_exhausted|non_retryable_error|lease_expired_max_attempts|manually_killed"
        text final_error
        integer attempts
        timestamptz dead_at
    }

    workers {
        uuid id PK
        uuid project_id FK "-> projects (CASCADE), nullable"
        text host
        integer pid
        worker_status status "starting|active|draining|dead|stopped"
        integer concurrency "default 1"
        integer in_flight_count "write-time maintained"
        timestamptz started_at
        timestamptz last_heartbeat_at
        timestamptz stopped_at
    }

    worker_heartbeats {
        uuid id PK
        uuid worker_id FK "-> workers (CASCADE)"
        timestamptz ts
        integer in_flight_count
    }
```

## Cascade & restrict rules (summary)

The deletion model follows one principle: **tearing down a tenant is a single `DELETE`,
but you can never accidentally strand live work.**

- **`CASCADE` down the tenancy tree.** Deleting an organization removes its projects, and
  with them every queue, retry policy, schedule, job, and worker
  (`*.project_id → projects` and `projects.organization_id → organizations` are all
  `CASCADE`). Job-owned rows (`job_executions`, `job_logs`, `dead_letter_queue`) and
  `worker_heartbeats` cascade from their parents. Membership and refresh tokens cascade
  from the user/org.
- **`RESTRICT` on `queues.retry_policy_id → retry_policies`.** A retry policy that is in use
  by a queue **cannot be deleted directly** — you must reassign the queue first. This
  protects a running queue from silently losing its backoff configuration. The API surfaces
  the resulting FK error as a `CONFLICT`.
- **`SET NULL` where history must outlive a relationship.** `jobs.claimed_by → workers`,
  `jobs.schedule_id → schedules`, `job_executions.worker_id → workers`, and
  `job_logs.execution_id → job_executions` all `SET NULL`, so removing a worker or schedule
  preserves the job's attempt/log history (the reaper then requeues any dangling claims).

The `RESTRICT + CASCADE` "diamond" (`project → queues`, `project → retry_policies`,
`queues → retry_policies`) is a known footgun — a full analysis, plus the exact index list
and the reasoning behind each denormalization, lives in [`docs/DATABASE.md`](DATABASE.md).
