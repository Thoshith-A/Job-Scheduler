import { envStr, envInt } from "@flux/shared";

export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  databaseUrl: string;
  redisUrl?: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  anthropicApiKey?: string;
  anthropicModel: string;
  rateLimit: {
    capacity: number;
    refillPerSec: number;
  };
}

export function loadConfig(): AppConfig {
  return {
    port: envInt("API_PORT", 4000),
    host: envStr("API_HOST", "0.0.0.0"),
    corsOrigin: envStr("CORS_ORIGIN", "http://localhost:3000"),
    databaseUrl: envStr("DATABASE_URL"),
    redisUrl: process.env.REDIS_URL || undefined,
    jwt: {
      accessSecret: envStr("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
      refreshSecret: envStr("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
      accessTtl: envStr("JWT_ACCESS_TTL", "15m"),
      refreshTtl: envStr("JWT_REFRESH_TTL", "7d"),
    },
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: envStr("ANTHROPIC_MODEL", "claude-opus-4-8"),
    rateLimit: {
      capacity: envInt("RATE_LIMIT_CAPACITY", 100),
      refillPerSec: envInt("RATE_LIMIT_REFILL_PER_SEC", 20),
    },
  };
}
