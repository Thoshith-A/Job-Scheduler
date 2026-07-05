import { Module, Injectable, Inject, Controller, Get } from "@nestjs/common";
import { sql, type DbHandle } from "@flux/db";
import { DomainError } from "@flux/shared";
import { DB } from "../common/tokens";
import { Public } from "../common/decorators";

@Injectable()
export class HealthService {
  constructor(@Inject(DB) private readonly dbh: DbHandle) {}

  async ready(): Promise<{ status: string; db: string }> {
    try {
      await this.dbh.db.execute(sql`SELECT 1`);
      return { status: "ok", db: "up" };
    } catch {
      throw new DomainError("INTERNAL_ERROR", "Database not reachable");
    }
  }
}

@Controller()
export class HealthController {
  constructor(private readonly svc: HealthService) {}

  @Public()
  @Get("health")
  health() {
    return { status: "ok", service: "flux-api", ts: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  ready() {
    return this.svc.ready();
  }
}

@Module({
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
