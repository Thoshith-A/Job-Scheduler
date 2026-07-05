import { Global, Module, type OnApplicationShutdown, Inject } from "@nestjs/common";
import { createDb, type DbHandle } from "@flux/db";
import {
  createRedis,
  createEventBus,
  createRateLimiter,
  createDistributedLock,
  type Redis,
} from "@flux/infra";
import { DB, REDIS, EVENT_BUS, RATE_LIMITER, DIST_LOCK, APP_CONFIG } from "../common/tokens";
import { loadConfig, type AppConfig } from "../config";

/**
 * Global module that owns the shared infrastructure singletons (DB pool, Redis, event bus,
 * rate limiter, distributed lock) and wires them into Nest's DI. Everything degrades to
 * in-memory implementations when REDIS_URL is unset, so the API runs with only Postgres.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    {
      provide: DB,
      useFactory: (cfg: AppConfig) =>
        createDb(cfg.databaseUrl, { max: 20, applicationName: "flux-api" }),
      inject: [APP_CONFIG],
    },
    {
      provide: REDIS,
      useFactory: (cfg: AppConfig) => createRedis(cfg.redisUrl),
      inject: [APP_CONFIG],
    },
    { provide: EVENT_BUS, useFactory: (redis: Redis | null) => createEventBus(redis), inject: [REDIS] },
    { provide: RATE_LIMITER, useFactory: (redis: Redis | null) => createRateLimiter(redis), inject: [REDIS] },
    { provide: DIST_LOCK, useFactory: (redis: Redis | null) => createDistributedLock(redis), inject: [REDIS] },
  ],
  exports: [APP_CONFIG, DB, REDIS, EVENT_BUS, RATE_LIMITER, DIST_LOCK],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close().catch(() => {});
    this.redis?.disconnect();
  }
}
