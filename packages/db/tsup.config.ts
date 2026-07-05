import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/schema/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // pg is a native/CJS dependency — keep it external.
  external: ["pg", "drizzle-orm"],
});
