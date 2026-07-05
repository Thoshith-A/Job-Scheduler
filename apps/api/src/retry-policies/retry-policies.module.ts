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
import { z } from "zod";
import { schema, eq, and, desc, type DbHandle } from "@flux/db";
import {
  DomainError,
  createRetryPolicySchema,
  RETRY_STRATEGIES,
  type CreateRetryPolicyInput,
} from "@flux/shared";
import { DB } from "../common/tokens";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/decorators";

const updateRetryPolicySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  strategy: z.enum(RETRY_STRATEGIES).optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  baseDelayMs: z.number().int().min(0).max(86_400_000).optional(),
  maxDelayMs: z.number().int().min(0).max(86_400_000).optional(),
  jitter: z.boolean().optional(),
});

@Injectable()
export class RetryPoliciesService {
  constructor(@Inject(DB) private readonly dbh: DbHandle) {}
  private get db() {
    return this.dbh.db;
  }

  list(projectId: string) {
    return this.db
      .select()
      .from(schema.retryPolicies)
      .where(eq(schema.retryPolicies.projectId, projectId))
      .orderBy(desc(schema.retryPolicies.createdAt));
  }

  async create(projectId: string, input: CreateRetryPolicyInput) {
    const [rp] = await this.db
      .insert(schema.retryPolicies)
      .values({ projectId, ...input })
      .returning();
    return rp!;
  }

  async update(projectId: string, policyId: string, input: Partial<CreateRetryPolicyInput>) {
    const [rp] = await this.db
      .update(schema.retryPolicies)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(schema.retryPolicies.id, policyId), eq(schema.retryPolicies.projectId, projectId)))
      .returning();
    if (!rp) throw new DomainError("NOT_FOUND", "Retry policy not found");
    return rp;
  }

  async remove(projectId: string, policyId: string) {
    try {
      await this.db
        .delete(schema.retryPolicies)
        .where(and(eq(schema.retryPolicies.id, policyId), eq(schema.retryPolicies.projectId, projectId)));
    } catch (err) {
      // FK RESTRICT: policy is still assigned to a queue.
      if ((err as { code?: string }).code === "23503") {
        throw new DomainError("CONFLICT", "Retry policy is in use by a queue; reassign the queue first");
      }
      throw err;
    }
  }
}

@Controller("projects/:projectId/retry-policies")
export class RetryPoliciesController {
  constructor(private readonly svc: RetryPoliciesService) {}

  @Get()
  @Roles("member")
  list(@Param("projectId") projectId: string) {
    return this.svc.list(projectId);
  }

  @Post()
  @Roles("admin")
  create(
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createRetryPolicySchema)) body: CreateRetryPolicyInput,
  ) {
    return this.svc.create(projectId, body);
  }

  @Patch(":policyId")
  @Roles("admin")
  update(
    @Param("projectId") projectId: string,
    @Param("policyId") policyId: string,
    @Body(new ZodValidationPipe(updateRetryPolicySchema)) body: Partial<CreateRetryPolicyInput>,
  ) {
    return this.svc.update(projectId, policyId, body);
  }

  @Delete(":policyId")
  @Roles("admin")
  @HttpCode(204)
  async remove(@Param("projectId") projectId: string, @Param("policyId") policyId: string) {
    await this.svc.remove(projectId, policyId);
  }
}

@Module({
  providers: [RetryPoliciesService],
  controllers: [RetryPoliciesController],
})
export class RetryPoliciesModule {}
