import { cn } from "@/lib/cn";

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  icon,
  action,
  subtitle,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-amber">{icon}</span>}
        <div>
          <h3 className="card-title">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-edge px-6 py-10 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
