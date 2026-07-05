import { pino, type Logger } from "pino";

export type { Logger };

/**
 * Structured JSON logger. Every service creates one with a `service` binding; request
 * handlers create children bound to a `requestId`/`correlationId` so a single request can
 * be traced across api -> scheduler -> worker in aggregated logs.
 */
export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    // ISO timestamps read better than epoch millis in aggregated logs.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}
