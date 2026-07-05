"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Ban, Sparkles, Terminal, History, Skull, AlertTriangle } from "lucide-react";
import { useJobDetail, useJobAction, useAiSummary } from "@/hooks/use-queries";
import { useToast } from "@/components/ui/toast";
import { Drawer } from "@/components/ui/drawer";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CenteredSpinner } from "@/components/ui/spinner";
import { EXECUTION_STATUS_HEX } from "@/lib/status";
import { formatDateTime, formatDuration, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AiSummary, JobExecution, JobLog } from "@/lib/types";

export function JobDetailDrawer({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useJobDetail(jobId, jobId !== null);
  const retry = useJobAction("retry");
  const cancel = useJobAction("cancel");
  const ai = useAiSummary();
  const [summary, setSummary] = useState<AiSummary | null>(null);

  useEffect(() => {
    setSummary(null);
  }, [jobId]);

  const job = data?.job;
  const canRetry = job ? ["failed", "dead", "canceled"].includes(job.status) : false;
  const canCancel = job ? !["completed", "dead", "canceled"].includes(job.status) : false;
  const canSummarize = job ? job.status === "failed" || job.status === "dead" || !!job.lastError : false;

  const runAction = (
    mutation: typeof retry | typeof cancel,
    label: string,
  ) => {
    if (!jobId) return;
    mutation.mutate(jobId, {
      onSuccess: () => toast({ tone: "success", title: `${label} succeeded` }),
      onError: (e) => toast({ tone: "error", title: `${label} failed`, message: (e as Error).message }),
    });
  };

  const summarize = () => {
    if (!jobId) return;
    ai.mutate(jobId, {
      onSuccess: (res) => setSummary(res),
      onError: (e) => toast({ tone: "error", title: "AI summary failed", message: (e as Error).message }),
    });
  };

  return (
    <Drawer
      open={jobId !== null}
      onClose={onClose}
      title={job?.name ?? "Job detail"}
      subtitle={job ? <span className="font-mono">{job.id}</span> : undefined}
      footer={
        job && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!canRetry || retry.isPending} loading={retry.isPending} onClick={() => runAction(retry, "Retry")}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
            <Button variant="danger" size="sm" disabled={!canCancel || cancel.isPending} loading={cancel.isPending} onClick={() => runAction(cancel, "Cancel")}>
              <Ban className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button variant="outline" size="sm" disabled={!canSummarize || ai.isPending} loading={ai.isPending} onClick={summarize} className="ml-auto">
              <Sparkles className="h-3.5 w-3.5" /> AI summarize failure
            </Button>
          </div>
        )
      }
    >
      {isLoading || !data ? (
        <CenteredSpinner label="Loading job…" />
      ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.job.status} />
            <Badge>{data.job.type}</Badge>
            <Badge tone="amber">priority {data.job.priority}</Badge>
            <Badge tone={data.job.attempts >= data.job.maxAttempts ? "crit" : "neutral"}>
              attempt {data.job.attempts}/{data.job.maxAttempts}
            </Badge>
          </div>

          {/* AI summary */}
          {summary && (
            <div className="rounded-xl border border-cyan/30 bg-cyan/5 p-4">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-cyan-soft">
                <Sparkles className="h-4 w-4" /> AI failure analysis
                <Badge tone="cyan" className="ml-auto">
                  {summary.source}
                  {summary.model ? ` · ${summary.model}` : ""}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{summary.summary}</p>
            </div>
          )}

          {/* Last error */}
          {data.job.lastError && (
            <div className="rounded-xl border border-crit/30 bg-crit/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-crit">
                <AlertTriangle className="h-3.5 w-3.5" /> Last error
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-crit/90">{data.job.lastError}</pre>
            </div>
          )}

          {/* Dead letter */}
          {data.deadLetter && (
            <div className="rounded-xl border border-status-dead/30 bg-status-dead/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-status-dead">
                <Skull className="h-3.5 w-3.5" /> Dead-lettered
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted">
                <Meta label="Reason" value={data.deadLetter.reason} />
                <Meta label="Attempts" value={String(data.deadLetter.attempts)} />
                <Meta label="Dead at" value={formatDateTime(data.deadLetter.deadAt)} />
              </div>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-edge bg-white/[0.02] p-4 sm:grid-cols-3">
            <Meta label="Created" value={formatDateTime(data.job.createdAt)} />
            <Meta label="Run at" value={formatDateTime(data.job.runAt)} />
            <Meta label="Started" value={data.job.startedAt ? formatDateTime(data.job.startedAt) : "—"} />
            <Meta label="Finished" value={data.job.finishedAt ? formatDateTime(data.job.finishedAt) : "—"} />
            <Meta label="Worker" value={data.worker ? data.worker.host : data.job.claimedBy ? "assigned" : "—"} />
            <Meta label="Updated" value={relativeTime(data.job.updatedAt)} />
          </div>

          {/* Payload */}
          <Section title="Payload" icon={<Terminal className="h-3.5 w-3.5" />}>
            <pre className="max-h-40 overflow-auto rounded-lg bg-void/70 p-3 font-mono text-xs text-ink-muted">
              {JSON.stringify(data.job.payload, null, 2)}
            </pre>
          </Section>

          {/* Execution history */}
          <Section title={`Execution history (${data.executions.length})`} icon={<History className="h-3.5 w-3.5" />}>
            {data.executions.length === 0 ? (
              <p className="text-xs text-ink-faint">No attempts recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {data.executions.map((ex) => (
                  <ExecutionRow key={ex.id} ex={ex} />
                ))}
              </div>
            )}
          </Section>

          {/* Live logs */}
          <Section title="Logs (live)" icon={<Terminal className="h-3.5 w-3.5" />}>
            <LogTail logs={data.logs} />
          </Section>
        </div>
      )}
    </Drawer>
  );
}

function ExecutionRow({ ex }: { ex: JobExecution }) {
  const color = EXECUTION_STATUS_HEX[ex.status];
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-mono text-ink-muted">#{ex.attemptNo}</span>
        <span className="capitalize" style={{ color }}>
          {ex.status}
        </span>
        <span className="ml-auto font-mono text-ink-faint">{formatDuration(ex.durationMs)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-ink-faint">
        <span>start {formatDateTime(ex.startedAt)}</span>
        {ex.workerId && <span className="font-mono">worker {ex.workerId.slice(0, 8)}</span>}
      </div>
      {ex.error && <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] text-crit/90">{ex.error}</pre>}
    </div>
  );
}

function LogTail({ logs }: { logs: JobLog[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  if (logs.length === 0) return <p className="text-xs text-ink-faint">No logs yet.</p>;

  return (
    <div ref={ref} className="max-h-52 overflow-y-auto rounded-lg bg-void/70 p-3 font-mono text-[11px] leading-relaxed">
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2">
          <span className="shrink-0 text-ink-faint">{new Date(l.ts).toLocaleTimeString()}</span>
          <span
            className={cn(
              "shrink-0 uppercase",
              l.level === "error" ? "text-crit" : l.level === "warn" ? "text-warn" : "text-cyan/70",
            )}
          >
            {l.level}
          </span>
          <span className="whitespace-pre-wrap break-words text-ink-muted">{l.message}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-0.5 truncate text-xs text-ink">{value}</div>
    </div>
  );
}
