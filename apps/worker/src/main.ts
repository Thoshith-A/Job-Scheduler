import "dotenv/config";
import { envStr, envInt } from "@flux/shared";
import { Worker } from "./worker";

async function main(): Promise<void> {
  const worker = new Worker({
    databaseUrl: envStr("DATABASE_URL"),
    redisUrl: process.env.REDIS_URL,
    pollMs: envInt("WORKER_POLL_MS", 500),
    heartbeatMs: envInt("WORKER_HEARTBEAT_MS", 5000),
    leaseSeconds: envInt("WORKER_LEASE_SECONDS", 30),
    maxConcurrency: envInt("WORKER_MAX_CONCURRENCY", 10),
    drainTimeoutMs: envInt("WORKER_DRAIN_TIMEOUT_MS", 25_000),
  });

  await worker.start();

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully`);
    worker
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
