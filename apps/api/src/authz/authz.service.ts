import { Injectable, Inject } from "@nestjs/common";
import { schema, eq, and, type DbHandle } from "@flux/db";
import { DomainError, type OrgRole } from "@flux/shared";
import { DB } from "../common/tokens";

const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * Central authorization + tenant-scoping. Resolves the owning organization for any
 * resource (project/queue/job/schedule) and enforces the caller's org role. This is the
 * single place tenant boundaries are checked, so no controller can accidentally leak
 * across organizations.
 */
@Injectable()
export class AuthzService {
  constructor(@Inject(DB) private readonly dbh: DbHandle) {}
  private get db() {
    return this.dbh.db;
  }

  async roleInOrg(userId: string, organizationId: string): Promise<OrgRole | null> {
    const [m] = await this.db
      .select({ role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.userId, userId),
          eq(schema.organizationMembers.organizationId, organizationId),
        ),
      );
    return m?.role ?? null;
  }

  /** Throw FORBIDDEN unless the user's role in the org meets `min`. Returns the role. */
  async requireRole(userId: string, organizationId: string, min: OrgRole): Promise<OrgRole> {
    const role = await this.roleInOrg(userId, organizationId);
    if (!role || RANK[role] < RANK[min]) {
      throw new DomainError("FORBIDDEN", `Requires ${min} role in this organization`);
    }
    return role;
  }

  async orgOfProject(projectId: string): Promise<string> {
    const [p] = await this.db
      .select({ orgId: schema.projects.organizationId })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!p) throw new DomainError("NOT_FOUND", "Project not found");
    return p.orgId;
  }

  async orgOfQueue(queueId: string): Promise<{ organizationId: string; projectId: string }> {
    const [q] = await this.db
      .select({ projectId: schema.queues.projectId, orgId: schema.projects.organizationId })
      .from(schema.queues)
      .innerJoin(schema.projects, eq(schema.queues.projectId, schema.projects.id))
      .where(eq(schema.queues.id, queueId));
    if (!q) throw new DomainError("NOT_FOUND", "Queue not found");
    return { organizationId: q.orgId, projectId: q.projectId };
  }

  async orgOfJob(jobId: string): Promise<{ organizationId: string; projectId: string; queueId: string }> {
    const [j] = await this.db
      .select({
        projectId: schema.jobs.projectId,
        queueId: schema.jobs.queueId,
        orgId: schema.projects.organizationId,
      })
      .from(schema.jobs)
      .innerJoin(schema.projects, eq(schema.jobs.projectId, schema.projects.id))
      .where(eq(schema.jobs.id, jobId));
    if (!j) throw new DomainError("NOT_FOUND", "Job not found");
    return { organizationId: j.orgId, projectId: j.projectId, queueId: j.queueId };
  }
}
