import { Module, Injectable, Inject, Controller, Get, Post, Delete, Body, Param } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { schema, eq, and, type DbHandle } from "@flux/db";
import { DomainError } from "@flux/shared";
import { z } from "zod";
import { DB } from "../common/tokens";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";
import { AuthzService } from "../authz/authz.service";

const createOrgSchema = z.object({ name: z.string().min(1).max(120) });
const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly dbh: DbHandle,
    private readonly authz: AuthzService,
  ) {}
  private get db() {
    return this.dbh.db;
  }

  async listForUser(userId: string) {
    return this.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.organizationMembers.role,
        createdAt: schema.organizations.createdAt,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.organizations, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, userId));
  }

  async create(userId: string, name: string) {
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomUUID().slice(0, 6)}`;
    return this.db.transaction(async (tx) => {
      const [org] = await tx.insert(schema.organizations).values({ name, slug }).returning();
      await tx
        .insert(schema.organizationMembers)
        .values({ organizationId: org!.id, userId, role: "owner" });
      return { ...org!, role: "owner" as const };
    });
  }

  async members(orgId: string) {
    return this.db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.organizationMembers.role,
        joinedAt: schema.organizationMembers.createdAt,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.organizationMembers.userId, schema.users.id))
      .where(eq(schema.organizationMembers.organizationId, orgId));
  }

  async addMember(orgId: string, email: string, role: "admin" | "member") {
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()));
    if (!user) throw new DomainError("NOT_FOUND", "No user with that email");
    await this.db
      .insert(schema.organizationMembers)
      .values({ organizationId: orgId, userId: user.id, role })
      .onConflictDoUpdate({
        target: [schema.organizationMembers.organizationId, schema.organizationMembers.userId],
        set: { role },
      });
    return { userId: user.id, role };
  }

  async removeMember(orgId: string, userId: string) {
    await this.db
      .delete(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, orgId),
          eq(schema.organizationMembers.userId, userId),
        ),
      );
  }
}

@Controller()
export class OrganizationsController {
  constructor(private readonly svc: OrganizationsService) {}

  @Get("organizations")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listForUser(user.userId);
  }

  @Post("organizations")
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createOrgSchema)) body: { name: string }) {
    return this.svc.create(user.userId, body.name);
  }

  @Get("organizations/:orgId/members")
  @Roles("member")
  members(@Param("orgId") orgId: string) {
    return this.svc.members(orgId);
  }

  @Post("organizations/:orgId/members")
  @Roles("admin")
  addMember(
    @Param("orgId") orgId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: { email: string; role: "admin" | "member" },
  ) {
    return this.svc.addMember(orgId, body.email, body.role);
  }

  @Delete("organizations/:orgId/members/:userId")
  @Roles("admin")
  removeMember(@Param("orgId") orgId: string, @Param("userId") userId: string) {
    return this.svc.removeMember(orgId, userId);
  }
}

@Module({
  providers: [OrganizationsService],
  controllers: [OrganizationsController],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
