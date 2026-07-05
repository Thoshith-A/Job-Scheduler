import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Assigns a correlation id to every request (honoring an inbound `x-request-id`) and
 * echoes it on the response. The exception filter and pino logs include it so a request
 * can be traced across the API and correlated with worker/scheduler logs.
 */
export function requestIdMiddleware(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
