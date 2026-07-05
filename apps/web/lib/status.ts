import type { JobStatus, WorkerStatus, ExecutionStatus } from "./types";

/**
 * Job-status is a reserved *status* palette — every use is paired with the status
 * label (never color alone), which is what makes the 8-way set accessible.
 * Hex values mirror tailwind.config `status.*` so the 3D scene (which needs raw
 * hex for emissive materials) and the DOM stay in lockstep.
 */
export const STATUS_HEX: Record<JobStatus, string> = {
  scheduled: "#60a5fa",
  queued: "#22d3ee",
  claimed: "#a78bfa",
  running: "#fbbf24",
  completed: "#34d399",
  failed: "#f87171",
  dead: "#e11d48",
  canceled: "#94a3b8",
};

/** Tailwind text/bg/border classes per status for DOM badges. */
export const STATUS_CLASS: Record<JobStatus, string> = {
  scheduled: "text-status-scheduled bg-status-scheduled/10 border-status-scheduled/30",
  queued: "text-status-queued bg-status-queued/10 border-status-queued/30",
  claimed: "text-status-claimed bg-status-claimed/10 border-status-claimed/30",
  running: "text-status-running bg-status-running/10 border-status-running/30",
  completed: "text-status-completed bg-status-completed/10 border-status-completed/30",
  failed: "text-status-failed bg-status-failed/10 border-status-failed/30",
  dead: "text-status-dead bg-status-dead/10 border-status-dead/30",
  canceled: "text-status-canceled bg-status-canceled/10 border-status-canceled/30",
};

/** Order used for the status overview bar (keeps low-CVD hues non-adjacent). */
export const STATUS_ORDER: JobStatus[] = [
  "running",
  "queued",
  "scheduled",
  "claimed",
  "completed",
  "failed",
  "dead",
  "canceled",
];

export const WORKER_STATUS_HEX: Record<WorkerStatus, string> = {
  starting: "#fbbf24",
  active: "#34d399",
  draining: "#60a5fa",
  dead: "#e11d48",
  stopped: "#94a3b8",
};

export const EXECUTION_STATUS_HEX: Record<ExecutionStatus, string> = {
  running: "#fbbf24",
  completed: "#34d399",
  failed: "#f87171",
  timed_out: "#f97316",
  lost: "#e11d48",
};

/**
 * Queue health derived from failure rate + backlog depth.
 * Returns a 0..1 score plus a hex color on a green→amber→red scale for the 3D pillars.
 */
export function queueHealth(failureRate: number, depth: number): { score: number; hex: string; label: string } {
  // 0 = perfect, 1 = critical. Weight failure rate heavily; depth is a softer signal.
  const depthPenalty = Math.min(depth / 500, 1) * 0.4;
  const score = Math.min(failureRate * 1.4 + depthPenalty, 1);
  let hex = "#34d399";
  let label = "healthy";
  if (score > 0.66) {
    hex = "#f87171";
    label = "critical";
  } else if (score > 0.3) {
    hex = "#fbbf24";
    label = "degraded";
  }
  return { score, hex, label };
}

/** Interpolate green→amber→red for arbitrary 0..1 values (used for smooth gradients). */
export function healthColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  const stops: [number, [number, number, number]][] = [
    [0, [52, 211, 153]],
    [0.5, [251, 191, 36]],
    [1, [248, 113, 113]],
  ];
  let lo = stops[0]!;
  let hi = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (s >= stops[i]![0] && s <= stops[i + 1]![0]) {
      lo = stops[i]!;
      hi = stops[i + 1]!;
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const t = (s - lo[0]) / span;
  const c = lo[1].map((v, i) => Math.round(v + (hi[1][i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
