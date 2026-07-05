"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Activity, Boxes, Cpu, Gauge } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useQueues, useQueueStats, useWorkers, useOverview } from "@/hooks/use-queries";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { queueHealth } from "@/lib/status";
import { formatNumber } from "@/lib/format";
import type { SceneData } from "@/components/scene/scene-data";
import { SceneFallback } from "@/components/scene/SceneFallback";

// The entire R3F bundle is client-only and lazy-loaded; a crisp 2D skeleton shows
// while it streams in.
const ControlRoomScene = dynamic(() => import("@/components/scene/ControlRoomScene"), {
  ssr: false,
  loading: () => <SceneFallback loading />,
});

export function Hero3D() {
  const { projectId } = useProject();
  const reducedMotion = usePrefersReducedMotion();

  const { data: queues = [] } = useQueues(projectId);
  const withStats = useQueueStats(queues);
  const { data: workers = [] } = useWorkers(projectId);
  const { data: overview } = useOverview(projectId);

  const data: SceneData = useMemo(() => {
    const sceneQueues = withStats.map(({ queue, stats }) => {
      const failureRate = stats?.lastHour.failureRate ?? 0;
      const depth = stats?.depth ?? 0;
      const health = queueHealth(failureRate, depth);
      return {
        id: queue.id,
        name: queue.name,
        depth,
        running: stats?.running ?? 0,
        completed: stats?.completed ?? 0,
        failureRate,
        throughputPerMin: stats?.lastHour.throughputPerMin ?? 0,
        healthHex: health.hex,
        healthLabel: health.label,
      };
    });
    const sceneWorkers = workers.map((w) => ({
      id: w.id,
      host: w.host,
      status: w.status,
      alive: w.alive,
      inFlight: w.inFlightCount,
      concurrency: w.concurrency,
    }));
    return {
      queues: sceneQueues,
      workers: sceneWorkers,
      completedLastMinute: overview?.completedLastMinute ?? 0,
      totalDepth: sceneQueues.reduce((a, q) => a + q.depth, 0),
      totalRunning: sceneQueues.reduce((a, q) => a + q.running, 0),
    };
  }, [withStats, workers, overview]);

  const workersAlive = data.workers.filter((w) => w.alive).length;

  return (
    <div className="relative h-[440px] w-full overflow-hidden rounded-3xl border border-edge bg-void shadow-panel md:h-[540px]">
      {/* HUD — crisp DOM over the canvas */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink">Control Room</h2>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {reducedMotion ? "2D view · reduced motion" : "Live cinematic render · click a pillar to focus"}
            </p>
          </div>
          <HudStats
            items={[
              { icon: <Gauge className="h-4 w-4" />, label: "throughput/min", value: formatNumber(data.completedLastMinute) },
              { icon: <Boxes className="h-4 w-4" />, label: "backlog", value: formatNumber(data.totalDepth) },
              { icon: <Activity className="h-4 w-4" />, label: "running", value: formatNumber(data.totalRunning) },
              { icon: <Cpu className="h-4 w-4" />, label: "workers", value: `${workersAlive}/${data.workers.length}` },
            ]}
          />
        </div>

        {/* Health legend */}
        <div className="flex items-center gap-4 text-[11px] text-ink-muted">
          <LegendDot color="#34d399" label="healthy" />
          <LegendDot color="#fbbf24" label="degraded" />
          <LegendDot color="#f87171" label="critical" />
          <span className="ml-2 hidden sm:inline">pillar height ∝ queue depth · spheres = workers</span>
        </div>
      </div>

      {reducedMotion ? (
        <SceneFallback data={data} reason="reduced motion" />
      ) : (
        <ControlRoomScene data={data} />
      )}
    </div>
  );
}

function HudStats({ items }: { items: { icon: React.ReactNode; label: string; value: string }[] }) {
  return (
    <div className="flex gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-xl border border-edge bg-void/50 px-3 py-2 backdrop-blur-md"
        >
          <div className="flex items-center gap-1.5 text-amber">{it.icon}</div>
          <div className="mt-1 font-mono text-lg font-semibold leading-none text-ink">{it.value}</div>
          <div className="mt-1 text-[9px] uppercase tracking-wide text-ink-faint">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
      {label}
    </span>
  );
}
