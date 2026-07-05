import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { DomainError, type ErrorCode, type ApiErrorBody } from "@flux/shared";

const CODE_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  RATE_LIMITED: 429,
  QUEUE_PAUSED: 409,
  INVALID_CRON: 400,
  INVALID_STATE_TRANSITION: 409,
  INTERNAL_ERROR: 500,
};

const STATUS_CODE: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

/**
 * Turns every thrown error into the single structured envelope every client can rely on:
 *   { error, code, details, requestId, statusCode }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? "unknown";

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = "INTERNAL_ERROR";
    let message = "Internal server error";
    let details: unknown;

    if (exception instanceof DomainError) {
      code = exception.code;
      statusCode = CODE_STATUS[exception.code] ?? 500;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      code = STATUS_CODE[statusCode] ?? "INTERNAL_ERROR";
      const resp = exception.getResponse();
      message = typeof resp === "string" ? resp : ((resp as { message?: string }).message ?? exception.message);
    } else if (exception instanceof Error) {
      message = process.env.NODE_ENV === "production" ? "Internal server error" : exception.message;
    }

    if (statusCode >= 500) {
      this.logger.error({ requestId, err: exception instanceof Error ? exception.stack : exception }, message);
    }

    const body: ApiErrorBody = { error: message, code, details, requestId, statusCode };
    res.status(statusCode).json(body);
  }
}
