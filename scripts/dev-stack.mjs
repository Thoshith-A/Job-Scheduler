// One-command local stack — NO DOCKER REQUIRED.
// Boots a real (embedded) PostgreSQL, applies migrations, then launches the API,
// scheduler, and worker as child processes wired to it. Redis is optional; without
// REDIS_URL the services use their in-memory fallbacks, so this needs zero external deps.
//
//   pnpm stack:local
//
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, ".local-pg");
const PORT = Number(process.env.LOCAL_PG_PORT ?? 5432);
const DB_NAME = "flux";
const DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`;

const children = [];
let embedded;

async function main() {
  const firstRun = !fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
  });

  if (firstRun) {
    console.log("⏳ initialising embedded PostgreSQL cluster...");
    await embedded.initialise();
  }
  await embedded.start();
  console.log(`✅ PostgreSQL listening on ${PORT}`);

  // Ensure the UTF-8 application database exists.
  const admin = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [DB_NAME]);
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE ${DB_NAME} WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    console.log("✅ created database 'flux'");
  }
  await admin.end();

  // Apply migrations via the db package (import its built entry directly).
  const dbEntry = pathToFileURL(path.join(ROOT, "packages/db/dist/index.js")).href;
  const { runMigrations } = await import(dbEntry);
  await runMigrations(DATABASE_URL);
  console.log("✅ migrations applied");

  const env = { ...process.env, DATABASE_URL, NODE_ENV: process.env.NODE_ENV ?? "development" };
  delete env.REDIS_URL; // force in-memory fallbacks unless the user set one

  const run = (name, cwd, script) => {
    const child = spawn("node", [script], { cwd: path.join(ROOT, cwd), env, stdio: "inherit", shell: false });
    child.on("exit", (code) => console.log(`[${name}] exited with code ${code}`));
    children.push(child);
    console.log(`🚀 started ${name}`);
  };

  run("api", "apps/api", "dist/main.js");
  run("scheduler", "apps/scheduler", "dist/main.js");
  run("worker", "apps/worker", "dist/main.js");

  console.log("\n✨ Flux is up. API: http://localhost:4000  •  Web: run `pnpm --filter @flux/web dev` (http://localhost:3000)\n");
}

function shutdown() {
  console.log("\n⏹  shutting down...");
  for (const c of children) c.kill("SIGTERM");
  setTimeout(async () => {
    try { await embedded?.stop(); } catch {}
    process.exit(0);
  }, 3000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("dev-stack failed:", err);
  process.exit(1);
});
