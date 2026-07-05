import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { OrgRole } from "@flux/shared";

/** Mark a route as not requiring authentication. */
export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Minimum org role required for a route (checked by RolesGuard). */
export const ROLES_KEY = "roles";
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  userId: string;
  email: string;
}

/** Inject the authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return req.user;
});
