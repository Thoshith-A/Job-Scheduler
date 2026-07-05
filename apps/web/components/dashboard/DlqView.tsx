"use client";

import { useState } from "react";
import { Skull, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useDlq, useJobAction } from "@/hooks/use-queries";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/spinner";
import { relativeTime } from "@/lib/format";

const LIMIT = 8;

export function DlqView() {
  const { projectId, canWrite } = useProject();
  const [page, setPage] = useState(0);
  const { data, isLoading } = useDlq(projectId, page, LIMIT);
  const retry = useJobAction("retry");
  const { toast } = useToast();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const onRetry = (jobId: string, name: string) =>
    retry.mutate(jobId, {
      onSuccess: () => toast({ tone: "success", title: "Requeued from DLQ", message: name }),
      onError: (e) => toast({ tone: "error", title: "Retry failed", message: (e as Error).message }),
    });

  return (
    <Card>
      <CardHeader title="Dead-letter queue" icon={<Skull className="h-4 w-4" />} subtitle={`${total} dead jobs`} />
      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Skull className="h-8 w-8" />} title="Nothing dead" hint="Exhausted / non-retryable jobs land here." />
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-status-dead/20 bg-status-dead/[0.04] p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{d.jobName}</span>
                  <Badge tone="crit">{d.reason.replace(/_/g, " ")}</Badge>
                  <span className="text-[10px] text-ink-faint">{d.attempts} attempts</span>
                </div>
                {d.finalError && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-crit/80">{d.finalError}</p>
                )}
                <p className="mt-0.5 text-[10px] text-ink-faint">died {relativeTime(d.deadAt)}</p>
              </div>
              <Button size="sm" variant="secondary" disabled={!canWrite || retry.isPending} onClick={() => onRetry(d.jobId, d.jobName)}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ))}
        </div>
      )}

      {total > LIMIT && (
        <div className="mt-3 flex items-center justify-between border-t border-edge pt-3 text-xs text-ink-faint">
          <span>
            {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
