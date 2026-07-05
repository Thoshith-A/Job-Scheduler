"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (t: { tone?: ToastTone; title: string; message?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ tone = "info", title, message }: { tone?: ToastTone; title: string; message?: string }) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, tone, title, message }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-panel backdrop-blur-xl",
                t.tone === "success" && "border-good/30 bg-good/10",
                t.tone === "error" && "border-crit/30 bg-crit/10",
                t.tone === "info" && "border-edge bg-panel/90",
              )}
            >
              <span className="mt-0.5">
                {t.tone === "success" && <CheckCircle2 className="h-5 w-5 text-good" />}
                {t.tone === "error" && <AlertTriangle className="h-5 w-5 text-crit" />}
                {t.tone === "info" && <Info className="h-5 w-5 text-cyan" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t.title}</p>
                {t.message && <p className="mt-0.5 break-words text-xs text-ink-muted">{t.message}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-ink-faint hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
