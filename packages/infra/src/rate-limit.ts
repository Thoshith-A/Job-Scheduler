import { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until at least one token is available again. */
  retryAfterMs: number;
}

/**
 * Token-bucket rate limiter for per-API-key throttling. `capacity` tokens refill at
 * `refillPerSec`. Redis-backed (atomic Lua, correct across API replicas) with an
 * in-memory fallback.
 */
export interface RateLimiter {
  take(key: string, capacity: number, refillPerSec: number, cost?: number): Promise<RateLimitResult>;
}

// Atomic token bucket in a single round-trip. State is [tokens, lastRefillMs] in a hash.
const LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end
local elapsed = math.max(0, now - ts) / 1000.0
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil(((cost - tokens) / refill) * 1000)
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil((capacity / refill) * 1000) + 1000)
return { allowed, math.floor(tokens), retry }
`;

class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}
  async take(key: string, capacity: number, refillPerSec: number, cost = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const res = (await this.redis.eval(LUA, 1, `ratelimit:${key}`, capacity, refillPerSec, now, cost)) as [
      number,
      number,
      number,
    ];
    return { allowed: res[0] === 1, remaining: res[1], retryAfterMs: res[2] };
  }
}

class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  async take(key: string, capacity: number, refillPerSec: number, cost = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, ts: now };
    const elapsed = Math.max(0, now - b.ts) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.ts = now;
    let allowed = false;
    let retryAfterMs = 0;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      allowed = true;
    } else {
      retryAfterMs = Math.ceil(((cost - b.tokens) / refillPerSec) * 1000);
    }
    this.buckets.set(key, b);
    return { allowed, remaining: Math.floor(b.tokens), retryAfterMs };
  }
}

export function createRateLimiter(redis: Redis | null): RateLimiter {
  return redis ? new RedisRateLimiter(redis) : new InMemoryRateLimiter();
}
