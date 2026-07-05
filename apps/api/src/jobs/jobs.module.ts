import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
} from "@nestjs/common";
import {
  createJobSchema,
  jobFilterSchema,
  paginationSchema,
  type CreateJobInput,
} from "@flux/shared";
import { zParse } from "../common/zod-validation.pipe";
import { Roles } from "../common/decorators";
import { JobsService } from "./jobs.service";

@Controller()
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  /** Create a job of any type. Honors the Idempotency-Key header. */
  @Post("queues/:queueId/jobs")
  @Roles("member")
  create(
    @Param("queueId") queueId: string,
    @Body() rawBody: Record<string, unknown>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const input = zParse(createJobSchema, { ...rawBody, queueId }) as CreateJobInput;
    return this.svc.create(input, idempotencyKey);
  }

  @Get("queues/:queueId/jobs")
  @Roles("member")
  listByQueue(@Param("queueId") queueId: string, @Query() query: Record<string, unknown>) {
    const filter = jobFilterSchema.parse(query);
    const page = paginationSchema.parse(query);
    return this.svc.list({ queueId }, filter, page);
  }

  @Get("projects/:projectId/jobs")
  @Roles("member")
  listByProject(@Param("projectId") projectId: string, @Query() query: Record<string, unknown>) {
    const filter = jobFilterSchema.parse(query);
    const page = paginationSchema.parse(query);
    return this.svc.list({ projectId }, filter, page);
  }

  @Get("jobs/:jobId")
  @Roles("member")
  detail(@Param("jobId") jobId: string) {
    return this.svc.detail(jobId);
  }

  @Get("jobs/:jobId/logs")
  @Roles("member")
  logs(@Param("jobId") jobId: string, @Query() query: Record<string, unknown>) {
    return this.svc.logs(jobId, paginationSchema.parse(query));
  }

  @Post("jobs/:jobId/retry")
  @Roles("member")
  retry(@Param("jobId") jobId: string) {
    return this.svc.retry(jobId);
  }

  @Post("jobs/:jobId/cancel")
  @Roles("member")
  @HttpCode(200)
  cancel(@Param("jobId") jobId: string) {
    return this.svc.cancel(jobId);
  }
}

@Module({
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
