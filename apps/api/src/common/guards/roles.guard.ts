import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError, type OrgRole } from "@flux/shared";
import { ROLES_KEY, type AuthUser } from "../decorators";
import { AuthzService } from "../../authz/authz.service";

/**
 * Enforces the minimum org role declared by @Roles(...). The organization is resolved
 * from whichever scoping param the route carries (orgId / projectId / queueId / jobId),
 * so RBAC and tenant isolation are checked together in one place.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser; params: Record<string, string> }>();
    if (!req.user) throw new DomainError("UNAUTHENTICATED", "Authentication required");

    const orgId = await this.resolveOrg(req.params);
    await this.authz.requireRole(req.user.userId, orgId, required[0]);
    return true;
  }

  private async resolveOrg(params: Record<string, string>): Promise<string> {
    if (params.orgId) return params.orgId;
    if (params.projectId) return this.authz.orgOfProject(params.projectId);
    if (params.queueId) return (await this.authz.orgOfQueue(params.queueId)).organizationId;
    if (params.jobId) return (await this.authz.orgOfJob(params.jobId)).organizationId;
    throw new DomainError("FORBIDDEN", "Cannot determine organization scope for this route");
  }
}
