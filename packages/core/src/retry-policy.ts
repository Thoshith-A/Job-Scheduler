import type { RetryStrategy } from "@flux/shared";

export interface RetryPolicySpec {
  strategy: RetryStrategy;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

/** The engine default when a queue has no explicit retry policy. */
export const DEFAULT_RETRY_POLICY: RetryPolicySpec = {
  strategy: "exponential",
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 300_000,
  jitter: true,
};

/**
 * Compute the delay before the next attempt, given how many attempts have already
 * failed (1-based: `attemptsSoFar = 1` means "the first attempt just failed, this is
 * the delay before attempt #2").
 *
 * Pure and deterministic when `jitter` is false — the reliability tests rely on this
 * to assert exact backoff. With jitter we apply "equal jitter" (half fixed, half
 * random) to spread retries and avoid thundering herds without ever waiting 0ms.
 *
 * `rng` is injectable so jitter can be made deterministic in tests.
 */
export function computeBackoffMs(
  policy: RetryPolicySpec,
  attemptsSoFar: number,
  rng: () => number = Math.random,
): number {
  const n = Math.max(1, attemptsSoFar);
  let raw: number;
  switch (policy.strategy) {
    case "fixed":
      raw = policy.baseDelayMs;
      break;
    case "linear":
      raw = policy.baseDelayMs * n;
      break;
    case "exponential":
      // base * 2^(n-1), guarded against overflow for large attempt counts.
      raw = policy.baseDelayMs * 2 ** Math.min(n - 1, 30);
      break;
  }

  const capped = Math.min(raw, policy.maxDelayMs);
  if (!policy.jitter) return Math.round(capped);

  // Equal jitter: keep half of the delay fixed, randomise the other half.
  const half = capped / 2;
  return Math.round(half + rng() * half);
}

/** Should this job be retried, or has it exhausted its budget? */
export function shouldRetry(policy: RetryPolicySpec, attemptsSoFar: number): boolean {
  return attemptsSoFar < policy.maxAttempts;
}
