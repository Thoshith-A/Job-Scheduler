import type { Database } from "@flux/db";
import type { FluxEvent } from "@flux/shared";

/** Either a pooled Database or an open transaction — engine helpers accept both. */
export type Executor = Database;

/** Emitted side-effects (job/worker events) are decoupled from the engine via this sink. */
export type EmitFn = (event: FluxEvent) => void;
export const noopEmit: EmitFn = () => {};

/** The subset of a job row a worker needs to execute it. */
export interface ClaimedJob {
  id: string;
  projectId: string;
  queueId: string;
  name: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  leaseExpiresAt: Date;
}

export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}
