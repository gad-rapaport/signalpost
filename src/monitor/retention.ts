import type { Db } from '../db/db.js';
import type { Metrics } from '../metrics.js';
import { dayOf } from '../time.js';

export interface RetentionResult {
  checks: number;
  daily: number;
  sessions: number;
  deliveries: number;
  audit: number;
  pagesFreed: number;
}

const DAY = 86_400_000;
const BATCH = 5_000;

/**
 * Deletes data past its retention: raw checks after RETENTION_DAYS (daily rollups keep the history), rollups
 * after 400 days, expired sessions, webhook deliveries after 30 days and the audit log after a year.
 * Incidents are kept. Raw checks are deleted in batches so the scheduler is never blocked for long.
 */
export function runRetention(
  db: Db,
  retentionDays: number,
  timeZone: string,
  now = Date.now(),
  metrics?: Metrics,
): RetentionResult {
  const cutoff = now - retentionDays * DAY;
  let checks = 0;
  for (;;) {
    const n = db
      .prepare('DELETE FROM checks WHERE id IN (SELECT id FROM checks WHERE at < ? LIMIT ?)')
      .run(cutoff, BATCH).changes;
    checks += n;
    if (n < BATCH) break;
  }
  const daily = db.prepare('DELETE FROM daily WHERE day < ?').run(dayOf(now - 400 * DAY, timeZone)).changes;
  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
  const deliveries = db.prepare('DELETE FROM webhook_deliveries WHERE at < ?').run(now - 30 * DAY).changes;
  const audit = db.prepare('DELETE FROM audit_log WHERE at < ?').run(now - 365 * DAY).changes;
  const before = db.pragma('freelist_count', { simple: true }) as number;
  db.pragma('incremental_vacuum');
  const after = db.pragma('freelist_count', { simple: true }) as number;
  const result = { checks, daily, sessions, deliveries, audit, pagesFreed: Math.max(0, before - after) };
  if (metrics) {
    for (const [table, n] of Object.entries(result))
      if (table !== 'pagesFreed' && n) metrics.inc('signalpost_retention_deleted_rows_total', { table }, n);
  }
  return result;
}
