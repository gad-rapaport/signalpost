import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Db } from './db.js';

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

/**
 * Online backup through SQLite's backup API: consistent while the server keeps writing. The copy is switched
 * to a rollback journal so it is one self-contained file, then checked with `PRAGMA integrity_check`.
 */
export async function backupTo(db: Db, dir: string): Promise<{ file: string; bytes: number }> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `signalpost-${stamp()}.db`);
  await db.backup(file);
  const copy = new Database(file);
  try {
    copy.pragma('journal_mode = DELETE');
    const check = copy.pragma('integrity_check', { simple: true });
    if (check !== 'ok') throw new Error(`backup failed integrity check: ${String(check)}`);
  } finally {
    copy.close();
  }
  return { file, bytes: statSync(file).size };
}

/**
 * Replaces the database file with a backup. Run only while the server is stopped. The backup is verified
 * first; the current file is kept next to it as `<name>.before-restore` until the next restore.
 */
export function restoreFrom(backupFile: string, dbFile: string): { previous: string | null } {
  if (!existsSync(backupFile)) throw new Error(`no such backup: ${backupFile}`);
  // Backups use a rollback journal (see backupTo), so a read-only open works on a read-only mount too.
  const check = new Database(backupFile, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`backup failed integrity check: ${String(result)}`);
    const tables = check
      .prepare(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('monitors', 'checks', 'incidents')",
      )
      .pluck()
      .get();
    if (tables !== 3) throw new Error('this file is not a Signalpost database');
  } finally {
    check.close();
  }
  mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
  let previous: string | null = null;
  if (existsSync(dbFile)) {
    previous = `${dbFile}.before-restore`;
    rmSync(previous, { force: true });
    renameSync(dbFile, previous);
  }
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true });
  copyFileSync(backupFile, dbFile);
  return { previous };
}
