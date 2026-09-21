/**
 * Apply migrations/*.sql to Neon when DATABASE_URL is set (Vercel build).
 * Skips cleanly when unset (local/preview uses PGLite via src/lib/db.ts) or
 * when there is nothing to apply.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMigrationFile, pendingMigrations } from "./migration-plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");
const databaseUrl =
  typeof process.env.DATABASE_URL === "string"
    ? process.env.DATABASE_URL.trim()
    : "";

if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL unset — skipping (PGLite applies at runtime).",
  );
  process.exit(0);
}

if (!existsSync(migrationsDir)) {
  console.log("[migrate] no migrations/ directory — nothing to apply.");
  process.exit(0);
}

const files = readdirSync(migrationsDir).filter(isMigrationFile);
if (files.length === 0) {
  console.log("[migrate] no migration files — nothing to apply.");
  process.exit(0);
}

const { Pool } = await import("pg");
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const { rows } = await pool.query("select name from _migrations");
  const done = rows.map((r) => r.name);
  const paths = files.map((name) => join(migrationsDir, name));

  for (const { name, path } of pendingMigrations(paths, done)) {
    const sql = readFileSync(path, "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log(`[migrate] applied ${name}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("[migrate] done");
} finally {
  await pool.end();
}
