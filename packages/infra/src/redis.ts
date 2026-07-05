import { Redis } from "ioredis";

export type { Redis };

/**
 * Create an ioredis client, or return `null` when no `REDIS_URL` is configured.
 * A null client is the signal for the factories below to fall back to their in-memory
 * implementations, so the whole system runs with zero external dependencies in dev/CI
 * while using real Redis under docker-compose / production.
 */
export function createRedis(url: string | undefined): Redis | null {
  if (!url) return null;
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
    enableReadyCheck: true,
  });
  client.on("error", (err) => {
    // Don't crash on transient Redis blips; auxiliary features degrade gracefully.
    console.error(`[flux/infra] redis error: ${err.message}`);
  });
  return client;
}
