import type { Db } from '../db/db.js';

export type Impact = 'outage' | 'degraded' | 'maintenance';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface IncidentUpdate {
  id: number;
  at: number;
  status: IncidentStatus;
  body: string;
  author: string;
}

export interface Incident {
  id: number;
  monitorId: number | null;
  monitorName: string | null;
  monitorPublic: boolean;
  title: string;
  impact: Impact;
  status: IncidentStatus;
  isAuto: boolean;
  synthetic: boolean;
  startedAt: number;
  resolvedAt: number | null;
  updates: IncidentUpdate[];
}

interface Row {
  id: number;
  monitor_id: number | null;
  monitor_name: string | null;
  monitor_public: number | null;
  title: string;
  impact: Impact;
  status: IncidentStatus;
  is_auto: number;
  synthetic: number;
  started_at: number;
  resolved_at: number | null;
}

const SELECT = `SELECT i.*, m.name AS monitor_name, m.is_public AS monitor_public
  FROM incidents i LEFT JOIN monitors m ON m.id = i.monitor_id`;

function hydrate(db: Db, rows: Row[]): Incident[] {
  const updates = db.prepare(
    'SELECT id, at, status, body, author FROM incident_updates WHERE incident_id = ? ORDER BY at DESC, id DESC',
  );
  return rows.map((r) => ({
    id: r.id,
    monitorId: r.monitor_id,
    monitorName: r.monitor_name,
    // Manual incidents without a component are public announcements.
    monitorPublic: r.monitor_id === null || r.monitor_public === 1,
    title: r.title,
    impact: r.impact,
    status: r.status,
    isAuto: r.is_auto === 1,
    synthetic: r.synthetic === 1,
    startedAt: r.started_at,
    resolvedAt: r.resolved_at,
    updates: updates.all(r.id) as IncidentUpdate[],
  }));
}

export function openIncidents(db: Db): Incident[] {
  return hydrate(
    db,
    db.prepare(`${SELECT} WHERE i.resolved_at IS NULL ORDER BY i.started_at DESC`).all() as Row[],
  );
}

export function recentIncidents(db: Db, sinceMs: number): Incident[] {
  return hydrate(
    db,
    db
      .prepare(`${SELECT} WHERE i.resolved_at IS NOT NULL AND i.resolved_at >= ? ORDER BY i.started_at DESC`)
      .all(sinceMs) as Row[],
  );
}

export function allIncidents(db: Db, limit = 100): Incident[] {
  return hydrate(
    db,
    db.prepare(`${SELECT} ORDER BY i.resolved_at IS NOT NULL, i.started_at DESC LIMIT ?`).all(limit) as Row[],
  );
}

export function getIncident(db: Db, id: number): Incident | null {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
  return row ? hydrate(db, [row])[0]! : null;
}

function addUpdate(
  db: Db,
  incidentId: number,
  at: number,
  status: IncidentStatus,
  body: string,
  author: string,
) {
  db.prepare(
    'INSERT INTO incident_updates (incident_id, at, status, body, author) VALUES (?, ?, ?, ?, ?)',
  ).run(incidentId, at, status, body, author);
}

/**
 * Opens the automatic incident for a monitor that went down; returns null if one is already open.
 * `reason` is published on the status page, so callers pass a public description (see publicReason).
 */
export function openAutoIncident(
  db: Db,
  monitorId: number,
  monitorName: string,
  reason: string,
  at: number,
): number | null {
  return db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM incidents WHERE monitor_id = ? AND is_auto = 1 AND resolved_at IS NULL')
      .get(monitorId);
    if (existing) return null;
    const info = db
      .prepare(
        `INSERT INTO incidents (monitor_id, title, impact, status, is_auto, started_at) VALUES (?, ?, 'outage', 'investigating', 1, ?)`,
      )
      .run(monitorId, `${monitorName} is not responding`, at);
    const id = Number(info.lastInsertRowid);
    addUpdate(
      db,
      id,
      at,
      'investigating',
      `Automatic checks are failing: ${reason}. We are looking into it.`,
      'Signalpost',
    );
    return id;
  })();
}

export function resolveAutoIncident(
  db: Db,
  monitorId: number,
  at: number,
  downSince: number | null,
): number | null {
  return db.transaction(() => {
    const row = db
      .prepare(
        'SELECT id, started_at FROM incidents WHERE monitor_id = ? AND is_auto = 1 AND resolved_at IS NULL',
      )
      .get(monitorId) as { id: number; started_at: number } | undefined;
    if (!row) return null;
    db.prepare("UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE id = ?").run(at, row.id);
    const minutes = Math.max(1, Math.round((at - (downSince ?? row.started_at)) / 60000));
    addUpdate(
      db,
      row.id,
      at,
      'resolved',
      `Checks are passing again. Down for about ${minutes} min.`,
      'Signalpost',
    );
    return row.id;
  })();
}

export function createIncident(
  db: Db,
  input: { monitorId: number | null; title: string; impact: Impact; status: IncidentStatus; body: string },
  author: string,
  at = Date.now(),
): number {
  return db.transaction(() => {
    const info = db
      .prepare(
        'INSERT INTO incidents (monitor_id, title, impact, status, started_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.monitorId,
        input.title,
        input.impact,
        input.status,
        at,
        input.status === 'resolved' ? at : null,
      );
    const id = Number(info.lastInsertRowid);
    addUpdate(db, id, at, input.status, input.body, author);
    return id;
  })();
}

export function postUpdate(
  db: Db,
  id: number,
  status: IncidentStatus,
  body: string,
  author: string,
  at = Date.now(),
): boolean {
  return db.transaction(() => {
    const row = db.prepare('SELECT resolved_at FROM incidents WHERE id = ?').get(id) as
      { resolved_at: number | null } | undefined;
    if (!row) return false;
    db.prepare('UPDATE incidents SET status = ?, resolved_at = ? WHERE id = ?').run(
      status,
      status === 'resolved' ? (row.resolved_at ?? at) : null,
      id,
    );
    addUpdate(db, id, at, status, body, author);
    return true;
  })();
}

export function audit(db: Db, actor: string, action: string, detail: string, at = Date.now()): void {
  db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(
    at,
    actor,
    action,
    detail,
  );
}

export function auditLog(
  db: Db,
  limit = 200,
): { at: number; actor: string; action: string; detail: string }[] {
  return db
    .prepare('SELECT at, actor, action, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?')
    .all(limit) as {
    at: number;
    actor: string;
    action: string;
    detail: string;
  }[];
}
