import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node20",
  // Workspace + native deps stay external; resolved from node_modules at runtime.
  external: ["@flux/core", "@flux/db", "@flux/infra", "@flux/shared", "pg", "ioredis", "pino"],
});
