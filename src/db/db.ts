import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Opens the database with the settings this app relies on: WAL (readers never block the scheduler's
 * writes), foreign keys, a busy timeout for the CLI running next to the server, and incremental vacuum so
 * retention can return space to the file system.
 */
export function openDb(file: string, opts: { readonly?: boolean } = {}): Db {
  if (file !== ':memory:' && !opts.readonly) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file, { readonly: opts.readonly ?? false, fileMustExist: opts.readonly ?? false });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!opts.readonly) {
    // auto_vacuum only takes effect on an empty database (before the first table), which is when it matters.
    db.pragma('auto_vacuum = INCREMENTAL');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

/** Applies pending migrations in order, each in its own transaction. Safe to run on every start. */
export function migrate(db: Db): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all() as string[]);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    })();
    applied.push(file);
  }
  return applied;
}
