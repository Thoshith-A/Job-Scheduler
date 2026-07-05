"use client";

import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { api, type JobListParams } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { CreateJobBody, Queue, QueueStats } from "@/lib/types";
import { useFluxEvents } from "./use-socket";

/** Reliable polling baseline (WS layered on top). */
export const POLL_MS = 1500;
export const SLOW_POLL_MS = 4000;

/* ── Reads ────────────────────────────────────────────────────────────────── */

export function useQueues(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.queues(projectId) : ["queues", "none"],
    queryFn: () => api.listQueues(projectId!),
    enabled: !!projectId,
    refetchInterval: SLOW_POLL_MS,
  });
}

export interface QueueWithStats {
  queue: Queue;
  stats: QueueStats | undefined;
  isLoading: boolean;
}

/** Fan out one stats query per queue, combined into a single array. */
export function useQueueStats(queues: Queue[]): QueueWithStats[] {
  return useQueries({
    queries: queues.map((q) => ({
      queryKey: qk.queueStats(q.id),
      queryFn: () => api.queueStats(q.id),
      refetchInterval: POLL_MS,
    })),
    combine: (results) =>
      queues.map((queue, i) => ({
        queue,
        stats: results[i]?.data,
        isLoading: results[i]?.isLoading ?? false,
      })),
  });
}

export function useOverview(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.overview(projectId) : ["overview", "none"],
    queryFn: () => api.overview(projectId!),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useWorkers(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.workers(projectId) : ["workers", "none"],
    queryFn: () => api.workers(projectId!),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useSchedules(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.schedules(projectId) : ["schedules", "none"],
    queryFn: () => api.schedules(projectId!),
    enabled: !!projectId,
    refetchInterval: SLOW_POLL_MS,
  });
}

export function useDlq(projectId: string | null, page: number, limit = 25) {
  return useQuery({
    queryKey: projectId ? qk.dlq(projectId, page) : ["dlq", "none", page],
    queryFn: () => api.dlq(projectId!, { limit, offset: page * limit }),
    enabled: !!projectId,
    refetchInterval: SLOW_POLL_MS,
  });
}

export function useProjectJobs(projectId: string | null, params: JobListParams) {
  return useQuery({
    queryKey: projectId ? qk.projectJobs(projectId, params) : ["jobs", "none"],
    queryFn: () => api.listProjectJobs(projectId!, params),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
    placeholderData: (prev) => prev,
  });
}

export function useJobDetail(jobId: string | null, live = true) {
  return useQuery({
    queryKey: jobId ? qk.jobDetail(jobId) : ["jobDetail", "none"],
    queryFn: () => api.jobDetail(jobId!),
    enabled: !!jobId,
    refetchInterval: live ? POLL_MS : false,
  });
}

/* ── Mutations ────────────────────────────────────────────────────────────── */

export function useUpdateQueue(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, patch }: { queueId: string; patch: Parameters<typeof api.updateQueue>[1] }) =>
      api.updateQueue(queueId, patch),
    onSuccess: (_data, { queueId }) => {
      void qc.invalidateQueries({ queryKey: qk.queueStats(queueId) });
      if (projectId) void qc.invalidateQueries({ queryKey: qk.queues(projectId) });
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      queueId,
      body,
      idempotencyKey,
    }: {
      queueId: string;
      body: CreateJobBody;
      idempotencyKey?: string;
    }) => api.createJob(queueId, body, idempotencyKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useJobAction(kind: "retry" | "cancel") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => (kind === "retry" ? api.retryJob(jobId) : api.cancelJob(jobId)),
    onSuccess: (_data, jobId) => {
      void qc.invalidateQueries({ queryKey: qk.jobDetail(jobId) });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["dlq"] });
    },
  });
}

export function useAiSummary() {
  return useMutation({ mutationFn: (jobId: string) => api.aiSummary(jobId) });
}

export function useToggleSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) =>
      api.setScheduleEnabled(projectId, scheduleId, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.schedules(projectId) }),
  });
}

export function useDeleteSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => api.deleteSchedule(projectId, scheduleId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.schedules(projectId) }),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, body }: { orgId: string; body: { name: string; slug: string; description?: string } }) =>
      api.createProject(orgId, body),
    onSuccess: (_data, { orgId }) => void qc.invalidateQueries({ queryKey: qk.projects(orgId) }),
  });
}

export function useCreateQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createQueue>[1]) => api.createQueue(projectId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.queues(projectId) }),
  });
}

/**
 * Bridge WS → cache: when a live event lands, nudge the relevant queries to refetch
 * (throttled). This makes the DOM feel instant while polling remains the safety net.
 */
export function useLiveInvalidation() {
  const qc = useQueryClient();
  const last = useRef(0);
  useFluxEvents(() => {
    const now = Date.now();
    if (now - last.current < 400) return; // throttle bursts
    last.current = now;
    void qc.invalidateQueries({ queryKey: ["overview"] });
    void qc.invalidateQueries({ queryKey: ["workers"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
    void qc.invalidateQueries({ queryKey: ["queueStats"] });
  });
}
