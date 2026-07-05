import { describe, it, expect } from "vitest";
import { computeBackoffMs, shouldRetry, type RetryPolicySpec } from "../src/retry-policy";

const base = (over: Partial<RetryPolicySpec> = {}): RetryPolicySpec => ({
  strategy: "exponential",
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 10_000,
  jitter: false,
  ...over,
});

describe("computeBackoffMs", () => {
  it("fixed strategy returns the base delay every attempt", () => {
    const p = base({ strategy: "fixed" });
    expect(computeBackoffMs(p, 1)).toBe(100);
    expect(computeBackoffMs(p, 5)).toBe(100);
  });

  it("linear strategy scales with attempt number", () => {
    const p = base({ strategy: "linear" });
    expect(computeBackoffMs(p, 1)).toBe(100);
    expect(computeBackoffMs(p, 2)).toBe(200);
    expect(computeBackoffMs(p, 3)).toBe(300);
  });

  it("exponential strategy doubles each attempt", () => {
    const p = base({ strategy: "exponential" });
    expect(computeBackoffMs(p, 1)).toBe(100); // 100 * 2^0
    expect(computeBackoffMs(p, 2)).toBe(200); // 100 * 2^1
    expect(computeBackoffMs(p, 3)).toBe(400); // 100 * 2^2
    expect(computeBackoffMs(p, 4)).toBe(800);
  });

  it("caps at maxDelayMs", () => {
    const p = base({ strategy: "exponential", maxDelayMs: 500 });
    expect(computeBackoffMs(p, 10)).toBe(500);
  });

  it("with jitter, stays within [half, full] of the capped delay", () => {
    const p = base({ strategy: "fixed", baseDelayMs: 1000, jitter: true });
    for (let i = 0; i < 200; i++) {
      const d = computeBackoffMs(p, 1);
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1000);
    }
  });

  it("jitter is deterministic given an injected rng", () => {
    const p = base({ strategy: "fixed", baseDelayMs: 1000, jitter: true });
    expect(computeBackoffMs(p, 1, () => 0)).toBe(500);
    expect(computeBackoffMs(p, 1, () => 1)).toBe(1000);
    expect(computeBackoffMs(p, 1, () => 0.5)).toBe(750);
  });
});

describe("shouldRetry", () => {
  it("retries while attempts remain and stops at the cap", () => {
    const p = base({ maxAttempts: 3 });
    expect(shouldRetry(p, 1)).toBe(true);
    expect(shouldRetry(p, 2)).toBe(true);
    expect(shouldRetry(p, 3)).toBe(false);
    expect(shouldRetry(p, 4)).toBe(false);
  });
});
