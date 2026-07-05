import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node20",
  external: ["@flux/core", "@flux/db", "@flux/infra", "@flux/shared", "pg", "ioredis", "pino"],
});
