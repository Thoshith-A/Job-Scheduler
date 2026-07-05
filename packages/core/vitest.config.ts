import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The reliability tests boot a real (embedded) Postgres cluster. Run test files
    // one at a time in a single fork so clusters never contend for a port, and give
    // generous timeouts for first-time cluster init.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
