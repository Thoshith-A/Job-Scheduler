import type {
  ApiErrorBody,
  AuthResult,
  MeResult,
  Organization,
  Project,
  Queue,
  QueueStats,
  Job,
  JobDetail,
  JobLog,
  AiSummary,
  Worker,
  Overview,
  Schedule,
  DlqEntry,
  Page,
  CreateJobBody,
  CreateJobResult,
  ErrorCode,
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "") ?? API_URL;

const ACCESS_KEY = "flux.accessToken";
const REFRESH_KEY = "flux.refreshToken";

/* ── Token storage ────────────────────────────────────────────────────────── */

export const tokenStore = {
  get access(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    window.localStorage.setItem(ACCESS_KEY, access);
    window.localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

/* ── Typed error ──────────────────────────────────────────────────────────── */

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(body: Partial<ApiErrorBody> & { statusCode: number }, fallback?: string) {
    super(body.error ?? fallback ?? "Request failed");
    this.name = "ApiError";
    this.code = body.code ?? "INTERNAL_ERROR";
    this.statusCode = body.statusCode;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

/* ── Refresh (single-flight) ──────────────────────────────────────────────── */

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    tokenStore.set(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Emitted when refresh fails so the auth layer can redirect to /login. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

/* ── Core request ─────────────────────────────────────────────────────────── */

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  signal?: AbortSignal;
  /** internal: prevents infinite refresh loops */
  _retried?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, auth = true, signal } = opts;

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) finalHeaders["content-type"] = "application/json";
  if (auth) {
    const token = tokenStore.access;
    if (token) finalHeaders["authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    throw new ApiError(
      { statusCode: 0, code: "INTERNAL_ERROR", error: `Network error: unable to reach ${API_URL}` },
      String(err),
    );
  }

  // Attempt one transparent refresh on 401.
  if (res.status === 401 && auth && !opts._retried) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return request<T>(path, { ...opts, _retried: true });
    }
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    throw new ApiError({ ...(data as ApiErrorBody | undefined), statusCode: res.status });
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/* ── Public API surface ───────────────────────────────────────────────────── */

export interface JobListParams {
  limit?: number;
  offset?: number;
  status?: string; // comma-separated
  type?: string;
  search?: string;
  sort?: "createdAt" | "runAt" | "priority" | "updatedAt";
  order?: "asc" | "desc";
}

export const api = {
  // Auth
  signup: (body: { email: string; password: string; name: string; organizationName?: string }) =>
    request<AuthResult>("/auth/signup", { method: "POST", body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<AuthResult>("/auth/login", { method: "POST", body, auth: false }),
  me: () => request<MeResult>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  // Organizations
  listOrganizations: () => request<Organization[]>("/organizations"),
  createOrganization: (name: string) =>
    request<Organization>("/organizations", { method: "POST", body: { name } }),

  // Projects
  listProjects: (orgId: string) =>
    request<Project[]>(`/organizations/${orgId}/projects`),
  createProject: (orgId: string, body: { name: string; slug: string; description?: string }) =>
    request<Project>(`/organizations/${orgId}/projects`, { method: "POST", body }),
  getProject: (projectId: string) => request<Project>(`/projects/${projectId}`),

  // Queues
  listQueues: (projectId: string) => request<Queue[]>(`/projects/${projectId}/queues`),
  createQueue: (
    projectId: string,
    body: {
      name: string;
      slug: string;
      description?: string;
      priorityDefault?: number;
      concurrencyLimit?: number;
      paused?: boolean;
    },
  ) => request<Queue>(`/projects/${projectId}/queues`, { method: "POST", body }),
  getQueue: (queueId: string) => request<Queue>(`/queues/${queueId}`),
  queueStats: (queueId: string) => request<QueueStats>(`/queues/${queueId}/stats`),
  updateQueue: (
    queueId: string,
    body: Partial<{
      name: string;
      concurrencyLimit: number;
      paused: boolean;
      priorityDefault: number;
      retryPolicyId: string;
    }>,
  ) => request<Queue>(`/queues/${queueId}`, { method: "PATCH", body }),
  deleteQueue: (queueId: string) => request<void>(`/queues/${queueId}`, { method: "DELETE" }),

  // Jobs
  createJob: (queueId: string, body: CreateJobBody, idempotencyKey?: string) =>
    request<CreateJobResult>(`/queues/${queueId}/jobs`, {
      method: "POST",
      body,
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
    }),
  listProjectJobs: (projectId: string, params: JobListParams = {}) =>
    request<Page<Job>>(`/projects/${projectId}/jobs${qs(params)}`),
  listQueueJobs: (queueId: string, params: JobListParams = {}) =>
    request<Page<Job>>(`/queues/${queueId}/jobs${qs(params)}`),
  jobDetail: (jobId: string) => request<JobDetail>(`/jobs/${jobId}`),
  jobLogs: (jobId: string, params: { limit?: number; offset?: number } = {}) =>
    request<JobLog[]>(`/jobs/${jobId}/logs${qs(params)}`),
  retryJob: (jobId: string) => request<Job>(`/jobs/${jobId}/retry`, { method: "POST" }),
  cancelJob: (jobId: string) => request<Job>(`/jobs/${jobId}/cancel`, { method: "POST" }),
  aiSummary: (jobId: string) => request<AiSummary>(`/jobs/${jobId}/ai-summary`, { method: "POST" }),

  // Monitoring
  workers: (projectId: string) => request<Worker[]>(`/projects/${projectId}/workers`),
  overview: (projectId: string) => request<Overview>(`/projects/${projectId}/overview`),
  schedules: (projectId: string) => request<Schedule[]>(`/projects/${projectId}/schedules`),
  setScheduleEnabled: (projectId: string, scheduleId: string, enabled: boolean) =>
    request<Schedule>(`/projects/${projectId}/schedules/${scheduleId}`, {
      method: "PATCH",
      body: { enabled },
    }),
  deleteSchedule: (projectId: string, scheduleId: string) =>
    request<void>(`/projects/${projectId}/schedules/${scheduleId}`, { method: "DELETE" }),
  dlq: (projectId: string, params: { limit?: number; offset?: number } = {}) =>
    request<Page<DlqEntry>>(`/projects/${projectId}/dlq${qs(params)}`),
};
