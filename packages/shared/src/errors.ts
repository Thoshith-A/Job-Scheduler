/**
 * Stable machine-readable error codes returned by every mutating endpoint.
 * The API's global exception filter serialises errors to:
 *   { error: string, code: ErrorCode, details?: unknown, requestId: string }
 * Clients switch on `code`, never on the human-readable `error` string.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "QUEUE_PAUSED",
  "INVALID_CRON",
  "INVALID_STATE_TRANSITION",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: string;
  code: ErrorCode;
  details?: unknown;
  requestId: string;
  statusCode: number;
}

/** Thrown inside the domain/core layer; the API maps it to an HTTP status + ApiErrorBody. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
