"use client";

import { useState } from "react";
import { PieChart } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useOverview } from "@/hooks/use-queries";
import { Card, CardHeader } from "@/components/ui/card";
import { STATUS_HEX, STATUS_ORDER } from "@/lib/status";
import { formatNumber } from "@/lib/format";
import type { JobStatus } from "@/lib/types";

/**
 * System-health rollup: counts by job status as a labeled, gapped stacked bar plus a
 * legend grid. Status colors are always paired with the status label (never alone).
 */
export function StatusOverview() {
  const { projectId } = useProject();
  const { data: overview } = useOverview(projectId);
  const [hover, setHover] = useState<JobStatus | null>(null);

  const counts = overview?.countsByStatus ?? {};
  const entries = STATUS_ORDER.map((s) => ({ status: s, count: counts[s] ?? 0 })).filter((e) => e.count > 0);
  const total = entries.reduce((a, e) => a + e.count, 0);

  return (
    <Card>
      <CardHeader
        title="System health"
        icon={<PieChart className="h-4 w-4" />}
        subtitle="Jobs by status"
        action={
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-ink">{formatNumber(total)}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-faint">total jobs</div>
          </div>
        }
      />

      {total === 0 ? (
        <div className="flex h-24 items-center justify-center text-xs text-ink-faint">No jobs yet</div>
      ) : (
        <>
          {/* Stacked bar with 2px surface gaps between segments */}
          <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full bg-white/[0.03]">
            {entries.map((e) => (
              <div
                key={e.status}
                className="h-full transition-all first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(e.count / total) * 100}%`,
                  backgroundColor: STATUS_HEX[e.status],
                  opacity: hover === null || hover === e.status ? 1 : 0.35,
                }}
                title={`${e.status}: ${e.count}`}
                onMouseEnter={() => setHover(e.status)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </div>

          {/* Legend — label + color + count (identity never color-alone) */}
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {entries.map((e) => (
              <div
                key={e.status}
                className="flex items-center gap-2"
                onMouseEnter={() => setHover(e.status)}
                onMouseLeave={() => setHover(null)}
                style={{ opacity: hover === null || hover === e.status ? 1 : 0.5 }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: STATUS_HEX[e.status] }} />
                <span className="text-xs capitalize text-ink-muted">{e.status}</span>
                <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-ink">
                  {formatNumber(e.count)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
