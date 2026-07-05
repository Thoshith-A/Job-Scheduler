"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronLeft, ChevronRight, ListFilter, X } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useProjectJobs } from "@/hooks/use-queries";
import type { JobListParams } from "@/lib/api";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/spinner";
import { JobDetailDrawer } from "./JobDetailDrawer";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { JobStatus, JobType } from "@/lib/types";

const ALL_STATUSES: JobStatus[] = [
  "scheduled",
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "dead",
  "canceled",
];
const ALL_TYPES: JobType[] = ["immediate", "delayed", "scheduled", "recurring", "batch"];
const LIMIT = 12;

export function JobExplorer() {
  const { projectId } = useProject();

  const [statuses, setStatuses] = useState<JobStatus[]>([]);
  const [type, setType] = useState<JobType | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<NonNullable<JobListParams["sort"]>>("createdAt");
  const [order, setOrder] = useState<NonNullable<JobListParams["order"]>>("desc");
  const [page, setPage] = useState(0);
  const [openJob, setOpenJob] = useState<string | null>(null);

  // Debounce search.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any filter change resets to first page.
  useEffect(() => setPage(0), [statuses, type, search, sort, order, projectId]);

  const params: JobListParams = useMemo(
    () => ({
      limit: LIMIT,
      offset: page * LIMIT,
      status: statuses.length ? statuses.join(",") : undefined,
      type: type || undefined,
      search: search || undefined,
      sort,
      order,
    }),
    [page, statuses, type, search, sort, order],
  );

  const { data, isLoading, isFetching } = useProjectJobs(projectId, params);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const toggleStatus = (s: JobStatus) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <Card>
      <CardHeader
        title="Job explorer"
        icon={<ListFilter className="h-4 w-4" />}
        subtitle={`${total} matching jobs`}
        action={isFetching ? <span className="text-[10px] text-ink-faint">refreshing…</span> : undefined}
      />

      {/* Filters — one row above the table */}
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or job id…"
              className="pl-9"
            />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value as JobType | "")} className="w-auto">
            <option value="">All types</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            value={`${sort}:${order}`}
            onChange={(e) => {
              const [s, o] = e.target.value.split(":");
              setSort((s as NonNullable<JobListParams["sort"]>) ?? "createdAt");
              setOrder((o as NonNullable<JobListParams["order"]>) ?? "desc");
            }}
            className="w-auto"
          >
            <option value="createdAt:desc">Newest</option>
            <option value="createdAt:asc">Oldest</option>
            <option value="updatedAt:desc">Recently updated</option>
            <option value="priority:desc">Priority high→low</option>
            <option value="runAt:asc">Run time</option>
          </Select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.map((s) => {
            const active = statuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors focus-ring",
                  active ? "border-amber/50 bg-amber/15 text-amber-soft" : "border-edge text-ink-faint hover:text-ink-muted",
                )}
              >
                {s}
              </button>
            );
          })}
          {statuses.length > 0 && (
            <button onClick={() => setStatuses([])} className="flex items-center gap-1 px-2 text-[11px] text-ink-faint hover:text-ink">
              <X className="h-3 w-3" /> clear
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <EmptyState icon={<ListFilter className="h-8 w-8" />} title="No jobs match" hint="Try clearing filters or submit a job." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint">
                <th className="pb-2 pl-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Attempts</th>
                <th className="pb-2 pr-2 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((job) => (
                <motion.tr
                  key={job.id}
                  layout
                  onClick={() => setOpenJob(job.id)}
                  className="group cursor-pointer border-t border-edge/60 transition-colors hover:bg-white/[0.03]"
                >
                  <td className="py-2.5 pl-2">
                    <div className="max-w-[220px] truncate font-medium text-ink group-hover:text-amber-soft">{job.name}</div>
                    <div className="truncate font-mono text-[10px] text-ink-faint">{job.id}</div>
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="py-2.5 text-xs capitalize text-ink-muted">{job.type}</td>
                  <td className="py-2.5">
                    <span className={cn("font-mono text-xs", job.attempts >= job.maxAttempts ? "text-crit" : "text-ink-muted")}>
                      {job.attempts}/{job.maxAttempts}
                    </span>
                  </td>
                  <td className="py-2.5 pr-2 text-right text-xs text-ink-faint">{relativeTime(job.updatedAt)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="mt-3 flex items-center justify-between border-t border-edge pt-3 text-xs text-ink-faint">
          <span>
            {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button size="sm" variant="outline" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <JobDetailDrawer jobId={openJob} onClose={() => setOpenJob(null)} />
    </Card>
  );
}
