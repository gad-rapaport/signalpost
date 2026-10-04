import { createHash } from 'node:crypto';
import { hashPassword } from '../auth/auth.js';
import type { Config } from '../config.js';
import type { Db } from './db.js';
import { createMonitor, getMonitorBySlug, type MonitorInput } from '../monitor/repo.js';
import { dayOf } from '../time.js';

const base = {
  method: 'GET' as const,
  intervalS: 30,
  timeoutMs: 5000,
  expectedMin: 200,
  expectedMax: 299,
  keyword: null,
  degradedMs: 800,
  failThreshold: 2,
  recoverThreshold: 2,
  isPublic: true,
  isPaused: false,
};

/** Demo monitors. The demo-api container exists only on the internal Docker network. */
export const DEMO_MONITORS: MonitorInput[] = [
  {
    ...base,
    slug: 'storefront',
    name: 'Storefront',
    url: 'http://demo-api:8080/',
    keyword: 'Demo shop',
    sortOrder: 1,
  },
  { ...base, slug: 'orders-api', name: 'Orders API', url: 'http://demo-api:8080/api/orders', sortOrder: 2 },
  { ...base, slug: 'sign-in', name: 'Sign-in service', url: 'http://demo-api:8080/health', sortOrder: 3 },
  {
    ...base,
    slug: 'example-org',
    name: 'Example.org (external)',
    url: 'https://example.org/',
    keyword: 'Example Domain',
    intervalS: 300,
    degradedMs: 1500,
    isPublic: false,
    // Paused so the demo makes no internet requests until someone chooses to.
    isPaused: true,
    sortOrder: 9,
  },
];

/** Deterministic 0..1 from a string, so seeded history is identical on every machine. */
function unit(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) / 0xffffffff;
}

/**
 * Idempotent demo seed:
 * - the admin account (password from SEED_ADMIN_PASSWORD, updated on every run),
 * - demo monitors that do not exist yet (existing ones are left as edited),
 * - generated history for the 29 days before today on days without real data, flagged `synthetic = 1` and
 *   labelled on the status page, plus two past incidents flagged the same way.
 */
export async function seed(
  db: Db,
  config: Config,
  now = Date.now(),
): Promise<{ monitorsCreated: number; daysAdded: number; incidentsAdded: number }> {
  if (!config.SEED_ADMIN_PASSWORD)
    throw new Error('SEED_ADMIN_PASSWORD is required to seed (at least 12 characters).');
  const passwordHash = await hashPassword(config.SEED_ADMIN_PASSWORD);
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO users (email, name, password_hash, created_at) VALUES (?, 'Demo admin', ?, ?)
       ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash`,
    ).run(config.SEED_ADMIN_EMAIL, passwordHash, now);

    let monitorsCreated = 0;
    for (const m of DEMO_MONITORS) {
      if (!getMonitorBySlug(db, m.slug)) {
        createMonitor(db, m, now);
        monitorsCreated++;
      }
    }

    let daysAdded = 0;
    const insertDay = db.prepare(
      `INSERT INTO daily (monitor_id, day, total, ok, slow, latency_sum, latency_max, synthetic)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT (monitor_id, day) DO NOTHING`,
    );
    for (const spec of DEMO_MONITORS.filter((m) => !m.isPaused)) {
      const m = getMonitorBySlug(db, spec.slug)!;
      for (let i = 29; i >= 1; i--) {
        const day = dayOf(now - i * 86_400_000, config.APP_TIMEZONE);
        const total = Math.floor(86_400 / m.intervalS);
        const r = unit(`${m.slug}:${day}`);
        // Mostly clean days; a few with short blips; one day with the outage matching the seeded incident.
        const failed = spec.slug === 'orders-api' && i === 9 ? 46 : r > 0.93 ? Math.round(r * 6) : 0;
        const slow = r > 0.85 ? Math.round(r * 40) : 0;
        const ok = total - failed;
        const avg = 60 + Math.round(r * 60);
        if (insertDay.run(m.id, day, total, ok, slow, avg * ok, avg * 4).changes) daysAdded++;
      }
    }

    let incidentsAdded = 0;
    const hasSynthetic = db.prepare('SELECT 1 FROM incidents WHERE synthetic = 1 LIMIT 1').get();
    if (!hasSynthetic) {
      const orders = getMonitorBySlug(db, 'orders-api')!;
      const add = (
        monitorId: number | null,
        title: string,
        impact: string,
        auto: number,
        start: number,
        minutes: number,
        updates: [number, string, string][],
      ) => {
        const info = db
          .prepare(
            `INSERT INTO incidents (monitor_id, title, impact, status, is_auto, synthetic, started_at, resolved_at) VALUES (?, ?, ?, 'resolved', ?, 1, ?, ?)`,
          )
          .run(monitorId, title, impact, auto, start, start + minutes * 60_000);
        for (const [offset, status, body] of updates) {
          db.prepare(
            'INSERT INTO incident_updates (incident_id, at, status, body, author) VALUES (?, ?, ?, ?, ?)',
          ).run(
            info.lastInsertRowid,
            start + offset * 60_000,
            status,
            body,
            auto ? 'Signalpost' : 'Demo admin',
          );
        }
        incidentsAdded++;
      };
      const nineDaysAgo = now - 9 * 86_400_000 - 5 * 3_600_000;
      add(orders.id, 'Orders API is not responding', 'outage', 1, nineDaysAgo, 23, [
        [0, 'investigating', 'Automatic check failed: HTTP 503 (demo history)'],
        [23, 'resolved', 'Checks are passing again. Down for about 23 min. (demo history)'],
      ]);
      const twelveDaysAgo = now - 12 * 86_400_000 - 2 * 3_600_000;
      add(null, 'Planned maintenance: database upgrade', 'maintenance', 0, twelveDaysAgo, 40, [
        [0, 'monitoring', 'Upgrading the database. Orders may be slow for a few minutes. (demo history)'],
        [40, 'resolved', 'Maintenance finished. (demo history)'],
      ]);
    }
    return { monitorsCreated, daysAdded, incidentsAdded };
  })();
}

/** Removes everything except the schema, then seeds again. */
export async function resetDemo(db: Db, config: Config): Promise<void> {
  db.transaction(() => {
    for (const table of [
      'checks',
      'daily',
      'incident_updates',
      'incidents',
      'webhook_deliveries',
      'audit_log',
      'sessions',
      'monitors',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  })();
  await seed(db, config);
}
