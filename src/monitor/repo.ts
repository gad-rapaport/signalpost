import type { Db } from '../db/db.js';
import type { ErrorKind, ProbeResult } from '../net/probe.js';
import { dayOf } from '../time.js';
import { evaluate, type MonitorState, type Transition } from './evaluate.js';

export interface Monitor {
  id: number;
  slug: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalS: number;
  timeoutMs: number;
  expectedMin: number;
  expectedMax: number;
  keyword: string | null;
  degradedMs: number;
  failThreshold: number;
  recoverThreshold: number;
  isPublic: boolean;
  isPaused: boolean;
  sortOrder: number;
  state: MonitorState;
  stateSince: number | null;
  consecutiveFail: number;
  consecutiveOk: number;
  consecutiveSlow: number;
  lastCheckedAt: number | null;
  lastLatencyMs: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
}

export type MonitorInput = Pick<
  Monitor,
  | 'slug'
  | 'name'
  | 'url'
  | 'method'
  | 'intervalS'
  | 'timeoutMs'
  | 'expectedMin'
  | 'expectedMax'
  | 'keyword'
  | 'degradedMs'
  | 'failThreshold'
  | 'recoverThreshold'
  | 'isPublic'
  | 'isPaused'
  | 'sortOrder'
>;

interface MonitorRow {
  id: number;
  slug: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  interval_s: number;
  timeout_ms: number;
  expected_min: number;
  expected_max: number;
  keyword: string | null;
  degraded_ms: number;
  fail_threshold: number;
  recover_threshold: number;
  is_public: number;
  is_paused: number;
  sort_order: number;
  state: MonitorState;
  state_since: number | null;
  consecutive_fail: number;
  consecutive_ok: number;
  consecutive_slow: number;
  last_checked_at: number | null;
  last_latency_ms: number | null;
  last_status_code: number | null;
  last_error: string | null;
}

function toMonitor(r: MonitorRow): Monitor {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    url: r.url,
    method: r.method,
    intervalS: r.interval_s,
    timeoutMs: r.timeout_ms,
    expectedMin: r.expected_min,
    expectedMax: r.expected_max,
    keyword: r.keyword,
    degradedMs: r.degraded_ms,
    failThreshold: r.fail_threshold,
    recoverThreshold: r.recover_threshold,
    isPublic: r.is_public === 1,
    isPaused: r.is_paused === 1,
    sortOrder: r.sort_order,
    state: r.state,
    stateSince: r.state_since,
    consecutiveFail: r.consecutive_fail,
    consecutiveOk: r.consecutive_ok,
    consecutiveSlow: r.consecutive_slow,
    lastCheckedAt: r.last_checked_at,
    lastLatencyMs: r.last_latency_ms,
    lastStatusCode: r.last_status_code,
    lastError: r.last_error,
  };
}

export function listMonitors(db: Db, opts: { publicOnly?: boolean } = {}): Monitor[] {
  const rows = db
    .prepare(
      `SELECT * FROM monitors ${opts.publicOnly ? 'WHERE is_public = 1' : ''} ORDER BY sort_order, name`,
    )
    .all() as MonitorRow[];
  return rows.map(toMonitor);
}

export function getMonitor(db: Db, id: number): Monitor | null {
  const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as MonitorRow | undefined;
  return row ? toMonitor(row) : null;
}

export function getMonitorBySlug(db: Db, slug: string): Monitor | null {
  const row = db.prepare('SELECT * FROM monitors WHERE slug = ?').get(slug) as MonitorRow | undefined;
  return row ? toMonitor(row) : null;
}

const params = (m: MonitorInput) => ({
  slug: m.slug,
  name: m.name,
  url: m.url,
  method: m.method,
  interval_s: m.intervalS,
  timeout_ms: m.timeoutMs,
  expected_min: m.expectedMin,
  expected_max: m.expectedMax,
  keyword: m.keyword,
  degraded_ms: m.degradedMs,
  fail_threshold: m.failThreshold,
  recover_threshold: m.recoverThreshold,
  is_public: m.isPublic ? 1 : 0,
  is_paused: m.isPaused ? 1 : 0,
  sort_order: m.sortOrder,
});

export function createMonitor(db: Db, m: MonitorInput, now = Date.now()): number {
  const info = db
    .prepare(
      `INSERT INTO monitors (slug, name, url, method, interval_s, timeout_ms, expected_min, expected_max, keyword,
         degraded_ms, fail_threshold, recover_threshold, is_public, is_paused, sort_order, created_at, updated_at)
       VALUES (@slug, @name, @url, @method, @interval_s, @timeout_ms, @expected_min, @expected_max, @keyword,
         @degraded_ms, @fail_threshold, @recover_threshold, @is_public, @is_paused, @sort_order, @now, @now)`,
    )
    .run({ ...params(m), now });
  return Number(info.lastInsertRowid);
}

/** Updates settings. A changed URL resets the state, since earlier results described another target. */
export function updateMonitor(db: Db, id: number, m: MonitorInput, now = Date.now()): void {
  const before = getMonitor(db, id);
  if (!before) return;
  const reset = before.url !== m.url || before.method !== m.method;
  db.prepare(
    `UPDATE monitors SET slug = @slug, name = @name, url = @url, method = @method, interval_s = @interval_s,
       timeout_ms = @timeout_ms, expected_min = @expected_min, expected_max = @expected_max, keyword = @keyword,
       degraded_ms = @degraded_ms, fail_threshold = @fail_threshold, recover_threshold = @recover_threshold,
       is_public = @is_public, is_paused = @is_paused, sort_order = @sort_order, updated_at = @now
       ${reset ? ", state = 'unknown', state_since = NULL, consecutive_fail = 0, consecutive_ok = 0, consecutive_slow = 0" : ''}
     WHERE id = @id`,
  ).run({ ...params(m), now, id });
}

export function setPaused(db: Db, id: number, paused: boolean, now = Date.now()): void {
  db.prepare(
    `UPDATE monitors SET is_paused = ?, updated_at = ?${paused ? '' : ", state = 'unknown', state_since = NULL, consecutive_fail = 0, consecutive_ok = 0, consecutive_slow = 0"} WHERE id = ?`,
  ).run(paused ? 1 : 0, now, id);
}

export function deleteMonitor(db: Db, id: number): void {
  db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
}

export interface RecordedCheck {
  transition: Transition;
  state: MonitorState;
  previousState: MonitorState;
  stateSince: number | null;
}

/**
 * Stores one check result and advances the monitor's state in a single transaction: the raw row, the daily
 * rollup and the monitor's counters can never disagree.
 */
export function recordCheck(
  db: Db,
  monitorId: number,
  result: ProbeResult,
  at: number,
  timeZone: string,
): RecordedCheck | null {
  return db.transaction(() => {
    const m = getMonitor(db, monitorId);
    if (!m) return null;
    const { next, transition, slow } = evaluate(
      {
        state: m.state,
        consecutiveFail: m.consecutiveFail,
        consecutiveOk: m.consecutiveOk,
        consecutiveSlow: m.consecutiveSlow,
      },
      { ok: result.ok, latencyMs: result.latencyMs },
      { failThreshold: m.failThreshold, recoverThreshold: m.recoverThreshold, degradedMs: m.degradedMs },
    );
    db.prepare(
      `INSERT INTO checks (monitor_id, at, ok, slow, status_code, latency_ms, error_kind, error_detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      monitorId,
      at,
      result.ok ? 1 : 0,
      slow ? 1 : 0,
      result.statusCode,
      result.latencyMs,
      result.errorKind,
      result.errorDetail,
    );
    const latency = result.ok ? (result.latencyMs ?? 0) : 0;
    db.prepare(
      `INSERT INTO daily (monitor_id, day, total, ok, slow, latency_sum, latency_max)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (monitor_id, day) DO UPDATE SET
         total = total + 1, ok = ok + excluded.ok, slow = slow + excluded.slow,
         latency_sum = latency_sum + excluded.latency_sum, latency_max = max(latency_max, excluded.latency_max)`,
    ).run(monitorId, dayOf(at, timeZone), result.ok ? 1 : 0, slow ? 1 : 0, latency, latency);
    const stateSince = next.state !== m.state ? at : m.stateSince;
    db.prepare(
      `UPDATE monitors SET state = ?, state_since = ?, consecutive_fail = ?, consecutive_ok = ?, consecutive_slow = ?,
         last_checked_at = ?, last_latency_ms = ?, last_status_code = ?, last_error = ?
       WHERE id = ?`,
    ).run(
      next.state,
      stateSince,
      next.consecutiveFail,
      next.consecutiveOk,
      next.consecutiveSlow,
      at,
      result.latencyMs,
      result.statusCode,
      result.ok ? null : (result.errorDetail ?? result.errorKind),
      monitorId,
    );
    return { transition, state: next.state, previousState: m.state, stateSince };
  })();
}

export interface CheckRow {
  at: number;
  ok: boolean;
  slow: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorKind: ErrorKind | null;
  errorDetail: string | null;
}

export function recentChecks(db: Db, monitorId: number, limit = 50): CheckRow[] {
  const rows = db
    .prepare(
      'SELECT at, ok, slow, status_code, latency_ms, error_kind, error_detail FROM checks WHERE monitor_id = ? ORDER BY at DESC LIMIT ?',
    )
    .all(monitorId, limit) as {
    at: number;
    ok: number;
    slow: number;
    status_code: number | null;
    latency_ms: number | null;
    error_kind: ErrorKind | null;
    error_detail: string | null;
  }[];
  return rows.map((r) => ({
    at: r.at,
    ok: r.ok === 1,
    slow: r.slow === 1,
    statusCode: r.status_code,
    latencyMs: r.latency_ms,
    errorKind: r.error_kind,
    errorDetail: r.error_detail,
  }));
}

export interface DayStat {
  day: string;
  total: number;
  ok: number;
  slow: number;
  avgLatencyMs: number | null;
  synthetic: boolean;
}

export function dailyStats(db: Db, monitorId: number, fromDay: string): Map<string, DayStat> {
  const rows = db
    .prepare(
      'SELECT day, total, ok, slow, latency_sum, synthetic FROM daily WHERE monitor_id = ? AND day >= ? ORDER BY day',
    )
    .all(monitorId, fromDay) as {
    day: string;
    total: number;
    ok: number;
    slow: number;
    latency_sum: number;
    synthetic: number;
  }[];
  return new Map(
    rows.map((r) => [
      r.day,
      {
        day: r.day,
        total: r.total,
        ok: r.ok,
        slow: r.slow,
        avgLatencyMs: r.ok ? Math.round(r.latency_sum / r.ok) : null,
        synthetic: r.synthetic === 1,
      },
    ]),
  );
}

/** Share of successful checks since `sinceMs` (null when there were none). */
export function uptimeSince(db: Db, monitorId: number, sinceMs: number): number | null {
  const r = db
    .prepare('SELECT count(*) AS total, sum(ok) AS ok FROM checks WHERE monitor_id = ? AND at >= ?')
    .get(monitorId, sinceMs) as {
    total: number;
    ok: number | null;
  };
  return r.total ? (r.ok ?? 0) / r.total : null;
}
