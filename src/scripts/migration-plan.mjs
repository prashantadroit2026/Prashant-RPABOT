const MIGRATION_RE = /^\d{4}_.+\.sql$/;

/** True when `name` looks like a migration file (`0001_*.sql`). @param {string} name */
export function isMigrationFile(name) {
  return typeof name === "string" && MIGRATION_RE.test(name.split(/[/\\]/).pop() ?? "");
}

/**
 * Of the migration entry points `paths` (glob keys like `/migrations/0001_x.sql`),
 * return those whose basename is not in `done`, sorted by name.
 * Shape: `[{ name, path }]` where `name` is the recorded `_migrations` key.
 * @param {string[]} paths
 * @param {string[]} done
 */
export function pendingMigrations(paths, done) {
  const applied = new Set(done ?? []);
  return (paths ?? [])
    .filter((p) => isMigrationFile(p))
    .map((p) => ({ name: p.split(/[/\\]/).pop() ?? "", path: p }))
    .filter((m) => !applied.has(m.name))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}