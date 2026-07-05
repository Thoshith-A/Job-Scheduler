import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

/**
 * Distributed lock used to elect a single active scheduler among replicas (so cron
 * promotion / reaping isn't done N times). Redis-backed with a TTL + fencing token and
 * safe release (only the holder can release); in-memory fallback for single-process runs.
 */
export interface DistributedLock {
  /** Try to acquire; returns a release() handle or null if already held elsewhere. */
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

class RedisLock implements DistributedLock {
  constructor(private readonly redis: Redis) {}
  async acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const token = randomUUID();
    const ok = await this.redis.set(key, token, "PX", ttlMs, "NX");
    if (ok !== "OK") return null;
    return async () => {
      // Compare-and-delete: only release if we still hold the same token (fencing).
      await this.redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        key,
        token,
      );
    };
  }
}

class InMemoryLock implements DistributedLock {
  private readonly held = new Map<string, number>();
  async acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const now = Date.now();
    const expiry = this.held.get(key);
    if (expiry !== undefined && expiry > now) return null;
    this.held.set(key, now + ttlMs);
    return async () => {
      this.held.delete(key);
    };
  }
}

export function createDistributedLock(redis: Redis | null): DistributedLock {
  return redis ? new RedisLock(redis) : new InMemoryLock();
}
