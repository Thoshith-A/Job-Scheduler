import { Injectable, CanActivate, ExecutionContext, Inject } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { DomainError } from "@flux/shared";
import type { RateLimiter } from "@flux/infra";
import { RATE_LIMITER, APP_CONFIG } from "../tokens";
import type { AppConfig } from "../../config";
import type { AuthUser } from "../decorators";

/**
 * Per-identity token-bucket rate limiting (Redis-backed, with in-memory fallback).
 * Authenticated requests are keyed by user/API-key id; anonymous requests (login,
 * signup) by client IP. On exhaustion returns 429 with a Retry-After header.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser; requestId?: string }>();
    const res = context.switchToHttp().getResponse<Response>();

    const apiKey = req.headers["x-api-key"];
    const identity =
      (typeof apiKey === "string" && `key:${apiKey.slice(0, 16)}`) ||
      (req.user ? `user:${req.user.userId}` : `ip:${req.ip ?? "unknown"}`);

    const result = await this.limiter.take(identity, this.cfg.rateLimit.capacity, this.cfg.rateLimit.refillPerSec);
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      throw new DomainError("RATE_LIMITED", "Rate limit exceeded", { retryAfterMs: result.retryAfterMs });
    }
    return true;
  }
}
