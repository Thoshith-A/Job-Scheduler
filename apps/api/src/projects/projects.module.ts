import {
  Module,
  Injectable,
  Inject,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Param as ParamDecorator } from "@nestjs/common";
import { schema, eq, and, desc, type DbHandle } from "@flux/db";
import { DomainError, createProjectSchema, createApiKeySchema } from "@flux/shared";
import { z } from "zod";
import { DB } from "../common/tokens";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/decorators";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
});

type CreateProjectInput = z.infer<typeof createProjectSchema>;
type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly dbh: DbHandle) {}
  private get db() {
    return this.dbh.db;
  }

  list(orgId: string) {
    return this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, orgId))
      .orderBy(desc(schema.projects.createdAt));
  }

  async get(projectId: string) {
    const [project] = await this.db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new DomainError("NOT_FOUND", "Project not found");
    return project;
  }

  async create(orgId: string, input: CreateProjectInput) {
    try {
      const [project] = await this.db
        .insert(schema.projects)
        .values({ organizationId: orgId, name: input.name, slug: input.slug, description: input.description })
        .returning();
      return project!;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DomainError("CONFLICT", "A project with that slug already exists in this org");
      }
      throw err;
    }
  }

  async update(projectId: string, input: { name?: string; description?: string }) {
    const [project] = await this.db
      .update(schema.projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId))
      .returning();
    if (!project) throw new DomainError("NOT_FOUND", "Project not found");
    return project;
  }

  async remove(projectId: string) {
    await this.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  }

  async listApiKeys(projectId: string) {
    return this.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        keyPrefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        revokedAt: schema.apiKeys.revokedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.projectId, projectId))
      .orderBy(desc(schema.apiKeys.createdAt));
  }

  async createApiKey(projectId: string, input: CreateApiKeyInput) {
    const raw = `flux_${randomBytes(24).toString("base64url")}`;
    const prefix = raw.slice(0, 12);
    const [key] = await this.db
      .insert(schema.apiKeys)
      .values({ projectId, name: input.name, keyHash: sha256(raw), keyPrefix: prefix, scopes: input.scopes })
      .returning({ id: schema.apiKeys.id, name: schema.apiKeys.name, keyPrefix: schema.apiKeys.keyPrefix });
    // The raw key is shown exactly once.
    return { ...key!, key: raw };
  }

  async revokeApiKey(projectId: string, keyId: string) {
    await this.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.projectId, projectId)));
  }
}

@Controller()
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  @Get("organizations/:orgId/projects")
  @Roles("member")
  list(@ParamDecorator("orgId") orgId: string) {
    return this.svc.list(orgId);
  }

  @Post("organizations/:orgId/projects")
  @Roles("admin")
  create(
    @ParamDecorator("orgId") orgId: string,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
  ) {
    return this.svc.create(orgId, body);
  }

  @Get("projects/:projectId")
  @Roles("member")
  get(@ParamDecorator("projectId") projectId: string) {
    return this.svc.get(projectId);
  }

  @Patch("projects/:projectId")
  @Roles("admin")
  update(
    @ParamDecorator("projectId") projectId: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: { name?: string; description?: string },
  ) {
    return this.svc.update(projectId, body);
  }

  @Delete("projects/:projectId")
  @Roles("admin")
  @HttpCode(204)
  async remove(@ParamDecorator("projectId") projectId: string) {
    await this.svc.remove(projectId);
  }

  @Get("projects/:projectId/api-keys")
  @Roles("admin")
  listKeys(@ParamDecorator("projectId") projectId: string) {
    return this.svc.listApiKeys(projectId);
  }

  @Post("projects/:projectId/api-keys")
  @Roles("admin")
  createKey(
    @ParamDecorator("projectId") projectId: string,
    @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKeyInput,
  ) {
    return this.svc.createApiKey(projectId, body);
  }

  @Delete("projects/:projectId/api-keys/:keyId")
  @Roles("admin")
  @HttpCode(204)
  async revokeKey(@ParamDecorator("projectId") projectId: string, @ParamDecorator("keyId") keyId: string) {
    await this.svc.revokeApiKey(projectId, keyId);
  }
}

@Module({
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
