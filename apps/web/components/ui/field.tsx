"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

const baseField =
  "w-full rounded-xl border border-edge bg-void/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus-ring focus-visible:border-amber/50";

export function Label({ children, className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1.5 block text-xs font-medium text-ink-muted", className)} {...props}>
      {children}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(baseField, "h-10", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(baseField, "font-mono", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(baseField, "h-10 cursor-pointer appearance-none pr-8", className)} {...props}>
        {children}
      </select>
    );
  },
);

/** Small pill toggle used for pause/resume, enable/disable. */
export function Toggle({
  checked,
  onChange,
  disabled,
  labels = ["On", "Off"],
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  labels?: [string, string];
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-ring disabled:opacity-50",
        checked ? "border-good/40 bg-good/25" : "border-edge bg-white/5",
      )}
      title={checked ? labels[0] : labels[1]}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-ink transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
