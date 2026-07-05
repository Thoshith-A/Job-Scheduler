"use client";

import { CalendarClock, Trash2 } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useSchedules, useToggleSchedule, useDeleteSchedule } from "@/hooks/use-queries";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/spinner";
import { relativeTime } from "@/lib/format";

export function SchedulesView() {
  const { projectId, canWrite } = useProject();
  const { data: schedules = [], isLoading } = useSchedules(projectId);
  const toggle = useToggleSchedule(projectId ?? "");
  const del = useDeleteSchedule(projectId ?? "");
  const { toast } = useToast();

  return (
    <Card>
      <CardHeader title="Schedules" icon={<CalendarClock className="h-4 w-4" />} subtitle={`${schedules.length} cron schedules`} />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="No schedules" hint="Submit a recurring job to create one." />
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-edge bg-white/[0.02] p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{s.name}</span>
                  {s.enabled ? <Badge tone="good">enabled</Badge> : <Badge>paused</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-ink-faint">
                  <span className="font-mono text-cyan/80">{s.cron}</span>
                  <span>{s.timezone}</span>
                  <span>next {relativeTime(s.nextRunAt)}</span>
                  {s.lastRunAt && <span>last {relativeTime(s.lastRunAt)}</span>}
                </div>
              </div>
              <Toggle
                checked={s.enabled}
                disabled={!canWrite || toggle.isPending}
                onChange={(next) =>
                  toggle.mutate(
                    { scheduleId: s.id, enabled: next },
                    { onError: (e) => toast({ tone: "error", title: "Update failed", message: (e as Error).message }) },
                  )
                }
                labels={["Enabled", "Paused"]}
              />
              <button
                disabled={!canWrite || del.isPending}
                onClick={() => {
                  if (confirm(`Delete schedule "${s.name}"?`)) {
                    del.mutate(s.id, {
                      onSuccess: () => toast({ tone: "success", title: "Schedule deleted", message: s.name }),
                      onError: (e) => toast({ tone: "error", title: "Delete failed", message: (e as Error).message }),
                    });
                  }
                }}
                className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-crit/10 hover:text-crit disabled:opacity-40 focus-ring"
                title="Delete schedule"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
