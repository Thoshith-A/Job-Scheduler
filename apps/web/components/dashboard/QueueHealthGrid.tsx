"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Layers, Pause, Play, Check, X, Pencil, Gauge, TimerReset, AlertTriangle } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useQueues, useQueueStats, useUpdateQueue } from "@/hooks/use-queries";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/spinner";
import { queueHealth } from "@/lib/status";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Queue, QueueStats } from "@/lib/types";

export function QueueHealthGrid() {
  const { projectId, canWrite } = useProject();
  const { data: queues = [], isLoading } = useQueues(projectId);
  const withStats = useQueueStats(queues);

  return (
    <Card>
      <CardHeader title="Queue health" icon={<Layers className="h-4 w-4" />} subtitle="Live depth, throughput & latency" />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : queues.length === 0 ? (
        <EmptyState icon={<Layers className="h-8 w-8" />} title="No queues yet" hint="Create a queue to start scheduling work." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {withStats.map(({ queue, stats }) => (
            <QueueCard key={queue.id} queue={queue} stats={stats} canWrite={canWrite} projectId={projectId} />
          ))}
        </div>
      )}
    </Card>
  );
}

function QueueCard({
  queue,
  stats,
  canWrite,
  projectId,
}: {
  queue: Queue;
  stats: QueueStats | undefined;
  canWrite: boolean;
  projectId: string | null;
}) {
  const { toast } = useToast();
  const update = useUpdateQueue(projectId);
  const [editing, setEditing] = useState(false);
  const [concurrency, setConcurrency] = useState(queue.concurrencyLimit);

  const failureRate = stats?.lastHour.failureRate ?? 0;
  const depth = stats?.depth ?? 0;
  const health = queueHealth(failureRate, depth);

  const togglePause = () => {
    update.mutate(
      { queueId: queue.id, patch: { paused: !queue.paused } },
      {
        onSuccess: () => toast({ tone: "success", title: queue.paused ? "Queue resumed" : "Queue paused", message: queue.name }),
        onError: (e) => toast({ tone: "error", title: "Update failed", message: String((e as Error).message) }),
      },
    );
  };

  const saveConcurrency = () => {
    update.mutate(
      { queueId: queue.id, patch: { concurrencyLimit: Math.max(1, concurrency) } },
      {
        onSuccess: () => {
          toast({ tone: "success", title: "Concurrency updated", message: `${queue.name} → ${concurrency}` });
          setEditing(false);
        },
        onError: (e) => toast({ tone: "error", title: "Update failed", message: String((e as Error).message) }),
      },
    );
  };

  return (
    <motion.div
      layout
      className="glass glass-hover flex flex-col gap-3 p-4"
      style={{ borderColor: `${health.hex}33` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: health.hex, boxShadow: `0 0 8px ${health.hex}` }} />
            <h4 className="truncate text-sm font-semibold text-ink">{queue.name}</h4>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{queue.slug}</p>
        </div>
        {queue.paused ? <Badge tone="warn">paused</Badge> : <Badge tone={health.label === "healthy" ? "good" : health.label === "degraded" ? "warn" : "crit"}>{health.label}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Depth" value={formatNumber(depth)} accent={depth > 0} />
        <Metric label="Running" value={formatNumber(stats?.running ?? 0)} />
        <Metric label="Thpt/min" value={formatNumber(stats?.lastHour.throughputPerMin ?? 0)} icon={<Gauge className="h-3 w-3" />} />
        <Metric
          label="Failure"
          value={formatPercent(failureRate)}
          icon={<AlertTriangle className="h-3 w-3" />}
          tone={failureRate > 0.1 ? "crit" : undefined}
        />
        <Metric label="Avg" value={formatDuration(stats?.lastHour.avgDurationMs)} icon={<TimerReset className="h-3 w-3" />} />
        <Metric label="p95" value={formatDuration(stats?.lastHour.p95DurationMs)} />
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-edge pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-faint">concurrency</span>
          {editing ? (
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="h-7 w-16 rounded-lg border border-edge bg-void px-2 text-sm text-ink focus-ring"
              />
              <button onClick={saveConcurrency} className="rounded-md p-1 text-good hover:bg-good/10" title="Save">
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setConcurrency(queue.concurrencyLimit);
                  setEditing(false);
                }}
                className="rounded-md p-1 text-ink-faint hover:bg-white/5"
                title="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => canWrite && setEditing(true)}
              disabled={!canWrite}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-sm text-ink",
                canWrite ? "hover:bg-white/5" : "cursor-default",
              )}
            >
              {queue.concurrencyLimit}
              {canWrite && <Pencil className="h-3 w-3 text-ink-faint" />}
            </button>
          )}
        </div>

        <Button
          size="sm"
          variant={queue.paused ? "secondary" : "ghost"}
          onClick={togglePause}
          disabled={!canWrite || update.isPending}
          loading={update.isPending && update.variables?.patch.paused !== undefined}
        >
          {queue.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {queue.paused ? "Resume" : "Pause"}
        </Button>
      </div>
    </motion.div>
  );
}

function Metric({
  label,
  value,
  icon,
  accent,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: boolean;
  tone?: "crit";
}) {
  return (
    <div className="rounded-lg bg-white/[0.02] px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-ink-faint">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-sm font-semibold tabular-nums",
          tone === "crit" ? "text-crit" : accent ? "text-amber-soft" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}
