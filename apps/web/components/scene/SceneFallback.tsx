"use client";

import { motion } from "framer-motion";
import { Cpu, Layers } from "lucide-react";
import type { SceneData } from "./scene-data";
import { cn } from "@/lib/cn";
import { WORKER_STATUS_HEX } from "@/lib/status";
import { formatNumber } from "@/lib/format";

/**
 * 2D representation of the control room. Doubles as:
 *   - the Suspense skeleton while the 3D bundle loads (data undefined → shimmer)
 *   - the full accessible fallback for prefers-reduced-motion (data present → live bars)
 * Crisp DOM, no canvas — always readable.
 */
export function SceneFallback({
  data,
  loading,
  reason,
}: {
  data?: SceneData;
  loading?: boolean;
  reason?: string;
}) {
  const maxDepth = data ? Math.max(1, ...data.queues.map((q) => q.depth)) : 1;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-edge bg-gradient-to-b from-studio to-void p-6">
      {/* floor grid */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to top, black, transparent)",
          transform: "perspective(600px) rotateX(60deg)",
          transformOrigin: "bottom",
        }}
      />

      {loading || !data ? (
        <div className="flex h-full items-end justify-center gap-4 pb-10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="skeleton w-16 rounded-t-lg"
              style={{ height: `${30 + ((i * 37) % 60)}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="relative flex h-full flex-col justify-between">
          {/* Workers row */}
          <div className="flex flex-wrap items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan" />
            <span className="mr-2 text-[11px] uppercase tracking-widest text-ink-faint">
              {data.workers.length} workers
            </span>
            {data.workers.slice(0, 24).map((w) => (
              <span
                key={w.id}
                title={`${w.host} · ${w.status} · ${w.inFlight}/${w.concurrency} in-flight`}
                className={cn("h-3 w-3 rounded-full", w.alive && "animate-pulse-soft")}
                style={{
                  backgroundColor: WORKER_STATUS_HEX[w.status],
                  opacity: w.alive ? 1 : 0.3,
                  boxShadow: w.alive ? `0 0 10px ${WORKER_STATUS_HEX[w.status]}` : "none",
                }}
              />
            ))}
            {data.workers.length === 0 && (
              <span className="text-xs text-ink-faint">no workers online</span>
            )}
          </div>

          {/* Queue pillars */}
          <div className="flex items-end justify-center gap-3 sm:gap-5">
            {data.queues.length === 0 && (
              <div className="flex flex-col items-center gap-2 pb-10 text-ink-faint">
                <Layers className="h-8 w-8" />
                <p className="text-sm">No queues to visualize yet</p>
              </div>
            )}
            {data.queues.slice(0, 8).map((q) => {
              const h = 24 + (q.depth / maxDepth) * 150;
              return (
                <div key={q.id} className="flex flex-col items-center gap-2">
                  <span className="font-mono text-xs text-ink">{formatNumber(q.depth)}</span>
                  <motion.div
                    layout
                    initial={{ height: 24 }}
                    animate={{ height: h }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    className="w-12 rounded-t-lg sm:w-14"
                    style={{
                      background: `linear-gradient(to top, ${q.healthHex}22, ${q.healthHex})`,
                      boxShadow: `0 0 24px -4px ${q.healthHex}`,
                    }}
                  />
                  <span className="max-w-[4.5rem] truncate text-center text-[10px] text-ink-muted">
                    {q.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reason && (
        <div className="absolute right-4 top-4 rounded-full border border-edge bg-void/70 px-2.5 py-1 text-[10px] text-ink-faint backdrop-blur">
          {reason}
        </div>
      )}
    </div>
  );
}
