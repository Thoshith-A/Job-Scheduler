import type { JobStatus, WorkerStatus } from "./enums";

/**
 * Real-time events published by the worker/scheduler onto the EventBus (Redis pub/sub
 * in production, in-memory otherwise) and fanned out to dashboards over socket.io.
 * The frontend never fabricates these — every animation is driven by a real event.
 */
export type FluxEvent =
  | { kind: "job.created"; queueId: string; jobId: string; status: JobStatus; at: string }
  | { kind: "job.claimed"; queueId: string; jobId: string; workerId: string; at: string }
  | { kind: "job.started"; queueId: string; jobId: string; workerId: string; at: string }
  | {
      kind: "job.completed";
      queueId: string;
      jobId: string;
      workerId: string;
      durationMs: number;
      at: string;
    }
  | {
      kind: "job.failed";
      queueId: string;
      jobId: string;
      workerId: string;
      willRetry: boolean;
      attempt: number;
      error: string;
      at: string;
    }
  | { kind: "job.dead"; queueId: string; jobId: string; reason: string; at: string }
  | { kind: "job.log"; jobId: string; executionId: string; level: string; message: string; at: string }
  | { kind: "worker.registered"; workerId: string; host: string; at: string }
  | {
      kind: "worker.heartbeat";
      workerId: string;
      status: WorkerStatus;
      inFlight: number;
      at: string;
    }
  | { kind: "worker.dead"; workerId: string; reclaimedJobs: number; at: string }
  | { kind: "worker.stopped"; workerId: string; at: string }
  | { kind: "queue.stats"; queueId: string; depth: number; running: number; at: string };

export type FluxEventKind = FluxEvent["kind"];

/** Redis pub/sub channel used to fan events between backend replicas. */
export const FLUX_EVENT_CHANNEL = "flux:events";

/** socket.io room a dashboard joins to receive all events for a project. */
export const projectRoom = (projectId: string) => `project:${projectId}`;
export const queueRoom = (queueId: string) => `queue:${queueId}`;
