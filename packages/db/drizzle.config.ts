import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://flux:flux@localhost:5432/flux",
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
