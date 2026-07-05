import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Resolve the migrations folder relative to this module, working in BOTH the ESM build
 * (`import.meta.url`) and the CJS build (`__dirname`). Computed lazily so that merely
 * importing this module (e.g. any CJS consumer of @flux/db like the NestJS API) never
 * evaluates `import.meta.url`, which is undefined under CommonJS.
 */
function migrationsFolder(): string {
  let dir: string | undefined;
  try {
    // ESM path — tsup leaves import.meta.url intact in the ESM output.
    const url = (import.meta as ImportMeta | undefined)?.url;
    if (url) dir = path.dirname(fileURLToPath(url));
  } catch {
    /* not ESM */
  }
  if (!dir && typeof __dirname !== "undefined") dir = __dirname; // CJS output
  return path.join(dir ?? process.cwd(), "..", "migrations");
}

/**
 * Apply all pending Drizzle migrations against `connectionString`.
 * Used by `pnpm db:migrate`, the docker entrypoint, and the test harness so tests
 * exercise the exact same DDL as production.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}

// CLI entrypoint: `tsx src/migrate.ts` (ESM only).
try {
  const url = (import.meta as ImportMeta | undefined)?.url;
  if (url && process.argv[1] && fileURLToPath(url) === path.resolve(process.argv[1])) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("DATABASE_URL is required to run migrations");
      process.exit(1);
    }
    runMigrations(dbUrl)
      .then(() => {
        console.log("✅ migrations applied");
        process.exit(0);
      })
      .catch((err) => {
        console.error("❌ migration failed", err);
        process.exit(1);
      });
  }
} catch {
  /* imported as CJS — not a CLI run */
}
