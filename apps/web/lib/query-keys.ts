import type { JobListParams } from "./api";

/** Centralized React Query keys so invalidation stays consistent. */
export const qk = {
  me: ["me"] as const,
  organizations: ["organizations"] as const,
  projects: (orgId: string) => ["projects", orgId] as const,
  project: (projectId: string) => ["project", projectId] as const,
  queues: (projectId: string) => ["queues", projectId] as const,
  queueStats: (queueId: string) => ["queueStats", queueId] as const,
  overview: (projectId: string) => ["overview", projectId] as const,
  workers: (projectId: string) => ["workers", projectId] as const,
  schedules: (projectId: string) => ["schedules", projectId] as const,
  dlq: (projectId: string, page: number) => ["dlq", projectId, page] as const,
  projectJobs: (projectId: string, params: JobListParams) =>
    ["jobs", "project", projectId, params] as const,
  jobDetail: (jobId: string) => ["jobDetail", jobId] as const,
  jobLogs: (jobId: string) => ["jobLogs", jobId] as const,
};
