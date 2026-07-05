import { cn } from "@/lib/cn";
import { STATUS_CLASS } from "@/lib/status";
import type { JobStatus } from "@/lib/types";

export function Badge({
  children,
  className,
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "amber" | "cyan" | "good" | "warn" | "crit";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/5 text-ink-muted border-edge",
    amber: "bg-amber/10 text-amber-soft border-amber/30",
    cyan: "bg-cyan/10 text-cyan-soft border-cyan/30",
    good: "bg-good/10 text-good border-good/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    crit: "bg-crit/10 text-crit border-crit/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status pill — always renders the status *label* (never color alone). */
export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
        STATUS_CLASS[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
