import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { DomainError } from "@flux/shared";
import { IS_PUBLIC } from "../decorators";
import { TokenService } from "../../auth/token.service";

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * Attaches `{ userId, email }` to the request for @CurrentUser / RolesGuard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new DomainError("UNAUTHENTICATED", "Missing bearer token");
    }
    try {
      const claims = await this.tokens.verifyAccess(header.slice(7));
      req.user = { userId: claims.sub, email: claims.email };
      return true;
    } catch (err) {
      const expired = err instanceof Error && err.name === "TokenExpiredError";
      throw new DomainError(expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID", "Invalid or expired token");
    }
  }
}
