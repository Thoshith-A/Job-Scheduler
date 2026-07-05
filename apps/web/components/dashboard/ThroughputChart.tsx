"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useOverview } from "@/hooks/use-queries";
import { Card, CardHeader } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

interface Point {
  t: number;
  v: number;
}

const MAX_POINTS = 60;
const W = 560;
const H = 150;
const PAD = { top: 12, right: 8, bottom: 18, left: 8 };

/**
 * Live completed-per-minute, sampled from the polled /overview endpoint into a
 * rolling buffer. Single series → one hue, no legend (the title names it). Crosshair
 * + tooltip on hover, per the interaction spec.
 */
export function ThroughputChart() {
  const { projectId } = useProject();
  const { data: overview, dataUpdatedAt } = useOverview(projectId);
  const [points, setPoints] = useState<Point[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const lastAt = useRef(0);

  // Reset history when switching projects.
  useEffect(() => {
    setPoints([]);
  }, [projectId]);

  useEffect(() => {
    if (!overview || dataUpdatedAt === lastAt.current) return;
    lastAt.current = dataUpdatedAt;
    setPoints((prev) => {
      const next = [...prev, { t: dataUpdatedAt, v: overview.completedLastMinute }];
      return next.slice(-MAX_POINTS);
    });
  }, [overview, dataUpdatedAt]);

  const maxV = Math.max(1, ...points.map((p) => p.v));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xAt = (i: number) => PAD.left + (points.length <= 1 ? 0 : (i / (points.length - 1)) * innerW);
  const yAt = (v: number) => PAD.top + innerH - (v / maxV) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.v).toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L ${xAt(points.length - 1).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`
      : "";

  const current = points.length > 0 ? points[points.length - 1]!.v : (overview?.completedLastMinute ?? 0);
  const peak = points.length > 0 ? Math.max(...points.map((p) => p.v)) : 0;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - PAD.left) / innerW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const hoverPoint = hover !== null ? points[hover] : undefined;

  return (
    <Card>
      <CardHeader
        title="Throughput"
        icon={<Activity className="h-4 w-4" />}
        subtitle="Jobs completed per minute"
        action={
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-cyan-soft">{formatNumber(current)}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-faint">peak {formatNumber(peak)}</div>
          </div>
        }
      />
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="Throughput over time"
        >
          <defs>
            <linearGradient id="thpt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* baseline */}
          <line x1={PAD.left} y1={PAD.top + innerH} x2={W - PAD.right} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

          {points.length > 0 ? (
            <>
              <path d={areaPath} fill="url(#thpt-fill)" />
              <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hoverPoint && (
                <>
                  <line x1={xAt(hover!)} y1={PAD.top} x2={xAt(hover!)} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3 3" />
                  <circle cx={xAt(hover!)} cy={yAt(hoverPoint.v)} r={4} fill="#22d3ee" stroke="#0d0f13" strokeWidth={2} />
                </>
              )}
            </>
          ) : (
            <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-ink-faint text-[11px]">
              collecting data…
            </text>
          )}
        </svg>

        {hoverPoint && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-edge bg-studio/95 px-2 py-1 text-[11px] shadow-panel backdrop-blur"
            style={{ left: `${(xAt(hover!) / W) * 100}%`, top: 0 }}
          >
            <div className="font-mono font-semibold text-cyan-soft">{formatNumber(hoverPoint.v)} /min</div>
            <div className="text-ink-faint">{new Date(hoverPoint.t).toLocaleTimeString()}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
