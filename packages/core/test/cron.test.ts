import { describe, it, expect } from "vitest";
import { nextCronRun, assertValidCron } from "../src/cron";
import { DomainError } from "@flux/shared";

describe("nextCronRun", () => {
  it("computes the next 5-minute boundary", () => {
    const from = new Date("2026-01-01T00:02:00.000Z");
    const next = nextCronRun("*/5 * * * *", "UTC", from);
    expect(next.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("respects the timezone", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    // 09:00 in New York (EDT, UTC-4 in June) == 13:00 UTC.
    const ny = nextCronRun("0 9 * * *", "America/New_York", from);
    expect(ny.toISOString()).toBe("2026-06-01T13:00:00.000Z");
    // Same expression in UTC fires at 09:00 UTC.
    const utc = nextCronRun("0 9 * * *", "UTC", from);
    expect(utc.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("throws a domain error for an invalid expression", () => {
    expect(() => assertValidCron("not a cron", "UTC")).toThrowError(DomainError);
    try {
      assertValidCron("99 99 99 99 99", "UTC");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_CRON");
    }
  });
});
