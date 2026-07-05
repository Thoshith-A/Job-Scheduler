import parser from "cron-parser";
import { DomainError } from "@flux/shared";

/**
 * Compute the next fire time for a cron expression in a given IANA timezone, strictly
 * after `from`. Wraps `cron-parser` (date math only — not a scheduler) and normalises
 * its errors into a domain error so the API can return INVALID_CRON.
 */
export function nextCronRun(cron: string, timezone: string, from: Date): Date {
  try {
    const interval = parser.parseExpression(cron, {
      currentDate: from,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch (err) {
    throw new DomainError(
      "INVALID_CRON",
      `Invalid cron expression "${cron}" for timezone "${timezone}": ${(err as Error).message}`,
    );
  }
}

/** Validate a cron expression + timezone without computing a run time. */
export function assertValidCron(cron: string, timezone: string): void {
  nextCronRun(cron, timezone, new Date(0));
}
