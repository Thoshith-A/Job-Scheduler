import type { WorkerStatus } from "@/lib/types";

/** Normalized, render-ready data the hero scene consumes (2D and 3D share it). */
export interface SceneQueue {
  id: string;
  name: string;
  depth: number;
  running: number;
  completed: number;
  failureRate: number;
  throughputPerMin: number;
  healthHex: string;
  healthLabel: string;
}

export interface SceneWorker {
  id: string;
  host: string;
  status: WorkerStatus;
  alive: boolean;
  inFlight: number;
  concurrency: number;
}

export interface SceneData {
  queues: SceneQueue[];
  workers: SceneWorker[];
  completedLastMinute: number;
  totalDepth: number;
  totalRunning: number;
}
