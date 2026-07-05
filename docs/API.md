# REST API Reference

Base URL (local): **`http://localhost:4000`**. All request and response bodies are JSON.

- **Authentication** — every endpoint requires a Bearer access token
  (`Authorization: Bearer <accessToken>`) **except** those marked _Public_
  (`/auth/signup`, `/auth/login`, `/auth/refresh`, `/metrics`, `/health`, `/ready`).
- **Authorization (RBAC)** — endpoints that mutate or read tenant data declare a minimum
  org role. Roles rank `owner` > `admin` > `member`; a role satisfies any requirement at or
  below it. The owning organization is resolved automatically from the route's scoping
  parameter (`orgId` / `projectId` / `queueId` / `jobId`), so RBAC and tenant isolation are
  enforced together. Endpoints with no role listed require **authentication only**.
- **Validation** — bodies are validated with the same Zod schemas the frontend uses
  (`@flux/shared`); failures return `400 VALIDATION_ERROR` with a field-level `details`.
- **Request correlation** — send `X-Request-Id` to correlate logs; it is echoed on the
  response (a UUID is generated if you omit it).

## Error envelope

Every error — validation, auth, domain, or unexpected — is serialized to one shape:

```json
{
  "error": "Requires admin role in this organization",
  "code": "FORBIDDEN",
  "details": null,
  "requestId": "0f5c…",
  "statusCode": 403
}
```

Switch on the stable machine-readable `code`, never the human `error` string.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body/query failed schema validation (`details` = field errors). |
| `INVALID_CRON` | 400 | Malformed cron expression / timezone. |
| `UNAUTHENTICATED` | 401 | Missing/invalid Bearer token. |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password. |
| `TOKEN_EXPIRED` | 401 | Access/refresh token expired. |
| `TOKEN_INVALID` | 401 | Token unrecognized, malformed, or reuse detected. |
| `FORBIDDEN` | 403 | Authenticated but lacks the required org role. |
| `NOT_FOUND` | 404 | Resource missing or outside your tenant. |
| `CONFLICT` | 409 | Uniqueness or FK-`RESTRICT` violation (e.g. slug taken, retry policy in use). |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Reserved for idempotency conflicts. |
| `INVALID_STATE_TRANSITION` | 409 | e.g. retrying a `running` job, canceling a terminal job. |
| `QUEUE_PAUSED` | 409 | Reserved for paused-queue rejections. |
| `RATE_LIMITED` | 429 | Token bucket exhausted (`Retry-After` header set). |
| `INTERNAL_ERROR` | 500 | Unexpected server error. |

## Rate limiting

A per-identity token bucket (Redis-backed, in-memory fallback) throttles all requests.
Identity is derived from the `X-API-Key` header if present, else the authenticated user,
else the client IP. Defaults: `RATE_LIMIT_CAPACITY=100`, `RATE_LIMIT_REFILL_PER_SEC=20`.
Every response carries `X-RateLimit-Remaining`; a `429` also sets `Retry-After` (seconds).

> **Note on API keys.** API keys are a first-class managed resource (below): the raw secret
> is shown once, only a hash is stored, and keys carry coarse scopes. Request
> authentication in the current API is Bearer JWT; the `X-API-Key` header is additionally
> recognized as a rate-limit identity.

---

## Auth

### `POST /auth/signup` · _Public_

Creates a user, a first organization (owner membership), and issues a token pair.

Body (`signupSchema`): `email`, `password` (8–200), `name` (1–120), `organizationName?`.

```json
{ "email": "ada@example.com", "password": "correct horse", "name": "Ada", "organizationName": "Acme" }
```

Response `201`:

```json
{
  "user": { "id": "…", "email": "ada@example.com", "name": "Ada" },
  "organization": { "id": "…", "name": "Acme", "slug": "acme-a1b2c3", "role": "owner" },
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…"
}
```

```bash
curl -X POST http://localhost:4000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse","name":"Ada","organizationName":"Acme"}'
```

### `POST /auth/login` · _Public_ · `200`

Body (`loginSchema`): `email`, `password`. Response: `{ user, accessToken, refreshToken }`.

```bash
curl -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse"}'
```

### `POST /auth/refresh` · _Public_ · `200`

Rotates a refresh token. The old token is revoked and a new pair issued; reusing an
already-rotated token is treated as theft and revokes the whole family (`TOKEN_INVALID`).

Body (`refreshSchema`): `refreshToken` (≥10 chars). Response: `{ accessToken, refreshToken }`.

```bash
curl -X POST http://localhost:4000/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"'"$REFRESH"'"}'
```

### `POST /auth/logout` · auth · `204`

Revokes all of the current user's active refresh tokens. No body.

```bash
curl -X POST http://localhost:4000/auth/logout -H "Authorization: Bearer $TOKEN"
```

### `GET /auth/me` · auth

Returns the current user and their organization memberships.

```json
{ "user": { "id": "…", "email": "ada@example.com", "name": "Ada" },
  "organizations": [ { "id": "…", "name": "Acme", "slug": "acme-a1b2c3", "role": "owner" } ] }
```

```bash
curl http://localhost:4000/auth/me -H "Authorization: Bearer $TOKEN"
```

---

## Organizations

### `GET /organizations` · auth

Lists organizations the caller belongs to (`[{ id, name, slug, role, createdAt }]`).

```bash
curl http://localhost:4000/organizations -H "Authorization: Bearer $TOKEN"
```

### `POST /organizations` · auth

Creates an organization; the caller becomes its `owner`. Body: `{ name }`.

```bash
curl -X POST http://localhost:4000/organizations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Acme"}'
```

### `GET /organizations/:orgId/members` · role `member`

`[{ userId, email, name, role, joinedAt }]`.

```bash
curl http://localhost:4000/organizations/$ORG/members -H "Authorization: Bearer $TOKEN"
```

### `POST /organizations/:orgId/members` · role `admin`

Adds (or updates the role of) an existing user by email. Body: `{ email, role }` where
`role` ∈ `admin | member` (default `member`). Response: `{ userId, role }`.

```bash
curl -X POST http://localhost:4000/organizations/$ORG/members \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"grace@example.com","role":"member"}'
```

### `DELETE /organizations/:orgId/members/:userId` · role `admin`

Removes a membership.

```bash
curl -X DELETE http://localhost:4000/organizations/$ORG/members/$USER -H "Authorization: Bearer $TOKEN"
```

---

## Projects

### `GET /organizations/:orgId/projects` · role `member`

Lists projects in an organization, newest first.

### `POST /organizations/:orgId/projects` · role `admin`

Body (`createProjectSchema`): `name` (1–120), `slug` (lowercase alphanumeric + dashes),
`description?`. `409 CONFLICT` if the slug already exists in the org.

```bash
curl -X POST http://localhost:4000/organizations/$ORG/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Billing","slug":"billing"}'
```

### `GET /projects/:projectId` · role `member`

Returns the project, or `404 NOT_FOUND`.

### `PATCH /projects/:projectId` · role `admin`

Body: `{ name?, description? }`.

### `DELETE /projects/:projectId` · role `admin` · `204`

Deletes the project and (via `CASCADE`) everything under it.

---

## API keys

### `GET /projects/:projectId/api-keys` · role `admin`

Lists keys **without** the secret: `[{ id, name, keyPrefix, scopes, lastUsedAt, revokedAt, createdAt }]`.

### `POST /projects/:projectId/api-keys` · role `admin`

Body (`createApiKeySchema`): `name`, `scopes?` (subset of `jobs:write | jobs:read | queues:read`,
default `["jobs:write","jobs:read"]`). The raw `key` is returned **once** — store it now.

```json
{ "id": "…", "name": "ci-runner", "keyPrefix": "flux_ab12cd", "key": "flux_ab12cd…full-secret" }
```

```bash
curl -X POST http://localhost:4000/projects/$PROJECT/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"ci-runner","scopes":["jobs:write"]}'
```

### `DELETE /projects/:projectId/api-keys/:keyId` · role `admin` · `204`

Revokes a key (sets `revoked_at`).

---

## Queues

### `GET /projects/:projectId/queues` · role `member`

Lists queues in a project.

### `POST /projects/:projectId/queues` · role `admin`

Body (`createQueueSchema`): `name`, `slug`, `description?`, `priorityDefault` (0–1000,
default 100), `concurrencyLimit` (1–10000, default 10, **fleet-wide**), `retryPolicyId?`,
`paused` (default false). `409 CONFLICT` on duplicate slug within the project.

```bash
curl -X POST http://localhost:4000/projects/$PROJECT/queues \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Emails","slug":"emails","concurrencyLimit":5}'
```

### `GET /queues/:queueId` · role `member`

Returns the queue row.

### `GET /queues/:queueId/stats` · role `member`

Live operational stats: current depth and per-status counts, plus last-hour throughput,
latency, and failure rate.

```json
{
  "queueId": "…", "depth": 12, "scheduled": 3, "running": 5, "completed": 240, "dead": 2,
  "countsByStatus": { "queued": 12, "running": 5, "completed": 240, "dead": 2 },
  "lastHour": { "completed": 240, "failed": 6, "throughputPerMin": 4.0,
                "avgDurationMs": 312, "p95DurationMs": 900, "failureRate": 0.024 }
}
```

### `PATCH /queues/:queueId` · role `admin`

Body (`updateQueueSchema` — all `createQueueSchema` fields except `slug`, all optional).
Set `{ "paused": true }` to stop new claims without deleting the queue.

### `DELETE /queues/:queueId` · role `admin` · `204`

---

## Retry policies

Controller base: `projects/:projectId/retry-policies`.

### `GET …/retry-policies` · role `member`

Lists policies in the project.

### `POST …/retry-policies` · role `admin`

Body (`createRetryPolicySchema`): `name`, `strategy` (`fixed | linear | exponential`),
`maxAttempts` (1–100, default 3), `baseDelayMs` (default 1000), `maxDelayMs`
(default 300000, must be ≥ `baseDelayMs`), `jitter` (default true).

```bash
curl -X POST http://localhost:4000/projects/$PROJECT/retry-policies \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"aggressive","strategy":"exponential","maxAttempts":5,"baseDelayMs":500}'
```

### `PATCH …/retry-policies/:policyId` · role `admin`

Partial update of any of the above fields.

### `DELETE …/retry-policies/:policyId` · role `admin` · `204`

`409 CONFLICT` if the policy is still assigned to a queue (FK `RESTRICT`) — reassign the
queue first.

---

## Jobs

Job status model: `scheduled → queued → claimed → running → completed | failed | dead | canceled`.
`queued` means "ready now"; delayed/future/retry-backoff jobs rest in `scheduled` until the
scheduler promotes them.

### `POST /queues/:queueId/jobs` · role `member`

Creates a job. The body is a **discriminated union on `type`** (`queueId` comes from the
path). Honors the **`Idempotency-Key`** header: a repeated create with the same key on the
same queue returns the original job instead of creating a duplicate.

Common optional fields: `payload` (object), `priority` (0–1000, defaults to the queue's
default), `maxAttempts` (1–100, defaults to the queue's retry policy).

| `type` | Extra fields | Effect |
| --- | --- | --- |
| `immediate` | — | Enqueued `queued`, runnable now. |
| `delayed` | `delayMs` (0 … 30d) | Rests in `scheduled` until `now + delayMs`. |
| `scheduled` | `runAt` (ISO date) | Rests in `scheduled` until `runAt`. |
| `recurring` | `cron`, `timezone?` (default UTC) | Creates a **schedule**, not a job. |
| `batch` | `payloads` (1…10000 objects) | Creates many `queued` jobs sharing a `batchId`. |

Response is one of:

```json
{ "kind": "job",      "job": { "id": "…", "status": "queued", … }, "deduplicated": false }
{ "kind": "batch",    "batchId": "…", "count": 100, "jobIds": ["…", "…"] }
{ "kind": "schedule", "schedule": { "id": "…", "cron": "*/5 * * * *", "nextRunAt": "…" } }
```

```bash
# immediate job, idempotent on "order-4242"
curl -X POST http://localhost:4000/queues/$QUEUE/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-4242' \
  -d '{"type":"immediate","name":"charge-card","payload":{"amount":4200}}'

# recurring (creates a schedule)
curl -X POST http://localhost:4000/queues/$QUEUE/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"recurring","name":"nightly-report","cron":"0 2 * * *","timezone":"UTC"}'
```

### `GET /queues/:queueId/jobs` · role `member`

### `GET /projects/:projectId/jobs` · role `member`

List jobs by queue or across a project. Supports pagination and filtering (query params):

| Param | Meaning |
| --- | --- |
| `limit` | 1–200 (default 25) |
| `offset` | ≥0 (default 0) |
| `sort` | `createdAt` (default) · `runAt` · `priority` · `updatedAt` |
| `order` | `asc` · `desc` (default) |
| `status` | comma-separated statuses, e.g. `queued,running` |
| `type` | one of the 5 job types |
| `createdAfter` / `createdBefore` | ISO dates |
| `search` | matches job name (`ILIKE`) or exact job id |

Response is a page: `{ items, total, limit, offset, hasMore }`.

```bash
curl "http://localhost:4000/projects/$PROJECT/jobs?status=running,queued&sort=priority&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

### `GET /jobs/:jobId` · role `member`

Full detail: the job, its ordered `executions`, recent `logs` (up to 200), the
`deadLetter` row (or null), and the currently-claiming `worker` (or null).

### `GET /jobs/:jobId/logs` · role `member`

Paginated log lines for a job (oldest-first after pagination). Params: `limit`, `offset`.

### `POST /jobs/:jobId/retry` · role `member`

Manually re-queue a `failed | dead | canceled` job with a **fresh** attempt budget
(`attempts = 0`) and removes any DLQ row. `409 INVALID_STATE_TRANSITION` if the job is
currently `queued | claimed | running`.

```bash
curl -X POST http://localhost:4000/jobs/$JOB/retry -H "Authorization: Bearer $TOKEN"
```

### `POST /jobs/:jobId/cancel` · role `member` · `200`

Cancels a non-terminal job (`status = canceled`). `409 INVALID_STATE_TRANSITION` if the
job is already `completed | dead | canceled`.

---

## Schedules

### `GET /projects/:projectId/schedules` · role `member`

Lists cron schedules in the project.

### `PATCH /projects/:projectId/schedules/:scheduleId` · role `admin`

Enable/disable a schedule. Body: `{ "enabled": true }`.

### `DELETE /projects/:projectId/schedules/:scheduleId` · role `admin` · `204`

---

## Workers & fleet

### `GET /projects/:projectId/workers` · role `member`

The worker roster (up to 200, newest first) with a derived `alive` flag (heartbeat within
the 15s liveness window and not `dead`/`stopped`).

### `GET /workers/:workerId/heartbeats` · auth

The last 60 heartbeat samples: `[{ ts, inFlightCount }]` — the "pulse" for a worker.

### `GET /projects/:projectId/overview` · role `member`

Dashboard rollup: `{ countsByStatus, completedLastMinute }`.

### `GET /projects/:projectId/dlq` · role `member`

Paginated dead-letter queue for the project, joined to job name/type:

```json
{ "items": [ { "id": "…", "jobId": "…", "queueId": "…", "reason": "max_attempts_exhausted",
               "finalError": "boom", "attempts": 3, "deadAt": "…",
               "jobName": "charge-card", "jobType": "immediate" } ],
  "total": 2, "limit": 25, "offset": 0, "hasMore": false }
```

---

## AI

### `POST /jobs/:jobId/ai-summary` · role `member`

Generates a root-cause summary for a failed job from its final error, recent failed
attempts, and logs. Uses the Anthropic Messages API when `ANTHROPIC_API_KEY` is set;
otherwise returns a deterministic heuristic summary so the feature always works.

```json
{ "jobId": "…", "summary": "A downstream call timed out. Suggested fix: …",
  "source": "anthropic", "model": "claude-opus-4-8" }
```

```bash
curl -X POST http://localhost:4000/jobs/$JOB/ai-summary -H "Authorization: Bearer $TOKEN"
```

---

## Metrics & health

### `GET /metrics` · _Public_

Prometheus exposition (`text/plain; version=0.0.4`). Gauges are refreshed from the database
on each scrape, so values always reflect true state: `flux_jobs_total{status}`,
`flux_workers_active`, `flux_dead_letter_total`, `flux_queue_depth`, plus default Node
process metrics (labelled `app="flux"`).

```bash
curl http://localhost:4000/metrics
```

### `GET /health` · _Public_

Liveness: `{ "status": "ok", "service": "flux-api", "ts": "…" }`.

### `GET /ready` · _Public_

Readiness (checks Postgres): `{ "status": "ok", "db": "up" }`, or `500 INTERNAL_ERROR` if
the database is unreachable.

---

## WebSocket event stream

The API runs a **socket.io** gateway (same origin, e.g. `http://localhost:4000`;
transports `websocket` + `polling`). Every job/worker/queue event published by the workers
and scheduler is relayed to clients as a `"flux"` message — a global stream plus per-queue
rooms.

```js
import { io } from "socket.io-client";
const socket = io("http://localhost:4000", { transports: ["websocket", "polling"] });

socket.on("flux", (event) => {
  // event.kind is one of the kinds below
  console.log(event.kind, event);
});

// Optional: scope to a single queue's room
socket.emit("subscribe:queue", queueId);
// …later
socket.emit("unsubscribe:queue", queueId);
```

Event kinds (`FluxEvent` in `@flux/shared`), each carrying an ISO `at` timestamp:

| `kind` | Notable fields |
| --- | --- |
| `job.created` | `queueId`, `jobId`, `status` |
| `job.claimed` | `queueId`, `jobId`, `workerId` |
| `job.started` | `queueId`, `jobId`, `workerId` |
| `job.completed` | `queueId`, `jobId`, `workerId`, `durationMs` |
| `job.failed` | `queueId`, `jobId`, `workerId`, `willRetry`, `attempt`, `error` |
| `job.dead` | `queueId`, `jobId`, `reason` |
| `job.log` | `jobId`, `executionId`, `level`, `message` |
| `worker.registered` | `workerId`, `host` |
| `worker.heartbeat` | `workerId`, `status`, `inFlight` |
| `worker.dead` | `workerId`, `reclaimedJobs` |
| `worker.stopped` | `workerId` |
| `queue.stats` | `queueId`, `depth`, `running` |

> Cross-process delivery requires Redis (pub/sub across replicas). With the in-memory bus
> only same-process events flow, so the dashboard also polls the REST API as a reliable
> baseline.

---

## Getting started with `curl`

A full round trip: sign up → create a project → create a queue → submit a job → poll it →
retry. Requires `jq`.

```bash
BASE=http://localhost:4000

# 1) Sign up — captures the access token and the auto-created org id
resp=$(curl -s -X POST $BASE/auth/signup -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse","name":"Ada","organizationName":"Acme"}')
TOKEN=$(echo "$resp" | jq -r .accessToken)
ORG=$(echo "$resp"  | jq -r .organization.id)

# 2) Create a project (admin+ required — the signup user is owner)
PROJECT=$(curl -s -X POST $BASE/organizations/$ORG/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Billing","slug":"billing"}' | jq -r .id)

# 3) Create a queue (fleet-wide concurrency limit = 5)
QUEUE=$(curl -s -X POST $BASE/projects/$PROJECT/queues \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Emails","slug":"emails","concurrencyLimit":5}' | jq -r .id)

# 4) Submit a job (idempotent). The reference worker understands payloads like
#    {"sleepMs":800}, {"fail":true}, {"failTimes":2}, {"url":"https://…"}
JOB=$(curl -s -X POST $BASE/queues/$QUEUE/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: welcome-email-42' \
  -d '{"type":"immediate","name":"welcome-email","payload":{"sleepMs":500}}' | jq -r .job.id)

# 5) Poll the job until a worker completes it
watch -n1 "curl -s $BASE/jobs/$JOB -H 'Authorization: Bearer $TOKEN' | jq '.job.status, .executions'"

# 6) If it ended up failed/dead, retry it with a fresh attempt budget
curl -s -X POST $BASE/jobs/$JOB/retry -H "Authorization: Bearer $TOKEN" | jq .status
```
