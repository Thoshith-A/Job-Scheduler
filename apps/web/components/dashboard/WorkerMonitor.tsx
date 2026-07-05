"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Server } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useWorkers } from "@/hooks/use-queries";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/spinner";
import { WORKER_STATUS_HEX } from "@/lib/status";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Worker } from "@/lib/types";

export function WorkerMonitor() {
  const { projectId } = useProject();
  const { data: workers = [], isLoading } = useWorkers(projectId);

  // Tick so relative-heartbeat times stay fresh between polls.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const alive = workers.filter((w) => w.alive).length;

  return (
    <Card>
      <CardHeader
        title="Worker fleet"
        icon={<Cpu className="h-4 w-4" />}
        subtitle={`${alive} of ${workers.length} alive`}
      />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : workers.length === 0 ? (
        <EmptyState
          icon={<Server className="h-8 w-8" />}
          title="No workers registered"
          hint="Start a worker process (pnpm --filter @flux/worker dev) to see it here."
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {workers.map((w) => (
              <WorkerRow key={w.id} worker={w} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}

function WorkerRow({ worker }: { worker: Worker }) {
  const color = WORKER_STATUS_HEX[worker.status];
  const load = worker.concurrency > 0 ? Math.min(worker.inFlightCount / worker.concurrency, 1) : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-3 rounded-xl border border-edge bg-white/[0.02] p-3"
    >
      <span className="relative flex h-3 w-3 shrink-0">
        {worker.alive && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex h-3 w-3 rounded-full"
          style={{ backgroundColor: color, opacity: worker.alive ? 1 : 0.4 }}
        />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-ink">{worker.host}</span>
          {worker.pid !== null && <span className="text-[10px] text-ink-faint">pid {worker.pid}</span>}
        </div>
        <div className="mt-0.5 text-[11px] capitalize" style={{ color }}>
          {worker.status} · beat {relativeTime(worker.lastHeartbeatAt)}
        </div>
      </div>

      <div className="w-24 shrink-0">
        <div className="flex items-center justify-between text-[10px] text-ink-faint">
          <span>in-flight</span>
          <span className="font-mono text-ink">
            {worker.inFlightCount}/{worker.concurrency}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn("h-full rounded-full transition-all", load > 0.85 ? "bg-crit" : load > 0.5 ? "bg-warn" : "bg-good")}
            style={{ width: `${Math.round(load * 100)}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}
