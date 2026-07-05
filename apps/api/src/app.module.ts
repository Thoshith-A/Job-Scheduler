import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_GUARD, APP_FILTER } from "@nestjs/core";
import { InfraModule } from "./infra/infra.module";
import { AuthzModule } from "./authz/authz.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { ProjectsModule } from "./projects/projects.module";
import { QueuesModule } from "./queues/queues.module";
import { RetryPoliciesModule } from "./retry-policies/retry-policies.module";
import { JobsModule } from "./jobs/jobs.module";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { EventsModule } from "./events/events.gateway";
import { MetricsModule } from "./metrics/metrics.module";
import { AiModule } from "./ai/ai.module";
import { HealthModule } from "./health/health.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { requestIdMiddleware } from "./common/request-id.middleware";

@Module({
  imports: [
    InfraModule,
    AuthzModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    QueuesModule,
    RetryPoliciesModule,
    JobsModule,
    MonitoringModule,
    EventsModule,
    MetricsModule,
    AiModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: authenticate -> throttle -> authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes("*");
  }
}
