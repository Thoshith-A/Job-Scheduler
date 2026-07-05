import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { FLUX_EVENT_CHANNEL, type FluxEvent } from "@flux/shared";

/**
 * Fan-out bus for real-time job/worker events. The worker and scheduler `publish`;
 * the API `subscribe`s and relays to dashboards over socket.io. Redis pub/sub is used so
 * events cross process/replica boundaries; an in-memory emitter is the single-process
 * fallback. Either way, the frontend only ever animates real, published events.
 */
export interface EventBus {
  publish(event: FluxEvent): Promise<void>;
  subscribe(handler: (event: FluxEvent) => void): Promise<void>;
  close(): Promise<void>;
}

class RedisEventBus implements EventBus {
  private readonly sub: Redis;
  constructor(private readonly pub: Redis) {
    // A subscriber connection can't issue normal commands, so we duplicate.
    this.sub = pub.duplicate();
  }
  async publish(event: FluxEvent): Promise<void> {
    await this.pub.publish(FLUX_EVENT_CHANNEL, JSON.stringify(event));
  }
  async subscribe(handler: (event: FluxEvent) => void): Promise<void> {
    await this.sub.subscribe(FLUX_EVENT_CHANNEL);
    this.sub.on("message", (_channel, message) => {
      try {
        handler(JSON.parse(message) as FluxEvent);
      } catch {
        /* ignore malformed */
      }
    });
  }
  async close(): Promise<void> {
    await this.sub.quit();
  }
}

class InMemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(1000);
  }
  async publish(event: FluxEvent): Promise<void> {
    this.emitter.emit("event", event);
  }
  async subscribe(handler: (event: FluxEvent) => void): Promise<void> {
    this.emitter.on("event", handler);
  }
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

export function createEventBus(redis: Redis | null): EventBus {
  return redis ? new RedisEventBus(redis) : new InMemoryEventBus();
}
