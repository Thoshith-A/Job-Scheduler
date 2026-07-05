import "dotenv/config";
import { envStr, envInt, envBool } from "@flux/shared";
import { Scheduler } from "./scheduler";

async function main(): Promise<void> {
  const scheduler = new Scheduler({
    databaseUrl: envStr("DATABASE_URL"),
    redisUrl: process.env.REDIS_URL,
    tickMs: envInt("SCHEDULER_TICK_MS", 1000),
    singletonLock: envBool("SCHEDULER_SINGLETON_LOCK", true),
    workerStaleMs: envInt("SCHEDULER_WORKER_STALE_MS", 15_000),
  });

  await scheduler.start();

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down scheduler`);
    scheduler
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("scheduler failed to start", err);
  process.exit(1);
});
