import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-amber", className)} />;
}

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-ink-faint">
      <Spinner className="h-6 w-6" />
      {label && <p className="text-xs">{label}</p>}
    </div>
  );
}

/** A row of shimmering skeleton bars for loading tables/cards. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-10 rounded-lg" />
      ))}
    </div>
  );
}
