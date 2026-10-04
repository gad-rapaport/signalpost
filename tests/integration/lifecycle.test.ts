import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../src/db/seed.js';
import { createIncident, getIncident, openIncidents } from '../../src/monitor/incidents.js';
import { createMonitor, getMonitor, type MonitorInput } from '../../src/monitor/repo.js';
import { runRetention } from '../../src/monitor/retention.js';
import { createRuntime } from '../../src/runtime.js';
import { resolverTo, startTarget, tempDb, testConfig } from './helpers.js';

let target: Awaited<ReturnType<typeof startTarget>>;
let hook: Awaited<ReturnType<typeof startTarget>>;
let healthy = true;

beforeAll(async () => {
  target = await startTarget((_req, res) => (healthy ? res.end('ok') : res.writeHead(503).end('no')));
  hook = await startTarget((_req, res) => res.writeHead(204).end());
});
afterAll(async () => {
  await target.close();
  await hook.close();
});

const monitor = (url: string): MonitorInput => ({
  slug: 'api',
  name: 'API',
  url,
  method: 'GET',
  intervalS: 30,
  timeoutMs: 2000,
  expectedMin: 200,
  expectedMax: 299,
  keyword: null,
  degradedMs: 1000,
  failThreshold: 2,
  recoverThreshold: 2,
  isPublic: true,
  isPaused: false,
  sortOrder: 0,
});

describe('outage lifecycle', () => {
  it('opens one incident after two failures, resolves it after two successes, and signs webhooks', async () => {
    const t = tempDb();
    const secret = 's'.repeat(40);
    const config = testConfig({
      ALLOWED_PORTS: `${target.port},${hook.port}`,
      WEBHOOK_URL: `http://hook.test:${hook.port}/hook`,
      WEBHOOK_SECRET: secret,
    });
    const { scheduler, metrics } = await createRuntime(config, t.db, { resolve: resolverTo(target.host) });
    const id = createMonitor(t.db, monitor(target.url('/')));
    const run = async () => scheduler.runCheck(getMonitor(t.db, id)!);

    healthy = true;
    await run();
    expect(getMonitor(t.db, id)!.state).toBe('up');
    healthy = false;
    await run();
    expect(openIncidents(t.db)).toHaveLength(0);
    await run();
    await run();
    expect(getMonitor(t.db, id)!.state).toBe('down');
    const open = openIncidents(t.db);
    expect(open).toHaveLength(1);
    expect(open[0]!.updates[0]!.body).toBe(
      'Automatic checks are failing: the service answered with HTTP 503. We are looking into it.',
    );
    expect(open[0]!.updates[0]!.body).not.toContain('target.test');

    healthy = true;
    await run();
    expect(getMonitor(t.db, id)!.state).toBe('down');
    await run();
    expect(getMonitor(t.db, id)!.state).toBe('up');
    expect(openIncidents(t.db)).toHaveLength(0);
    expect(getIncident(t.db, open[0]!.id)!.status).toBe('resolved');

    // Webhooks are sent in the background; wait for both.
    for (let i = 0; i < 50 && hook.received.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(hook.received.map((r) => JSON.parse(r.body).event)).toEqual([
      'incident.opened',
      'incident.resolved',
    ]);
    for (const r of hook.received) {
      const ts = String(r.headers['x-signalpost-timestamp']);
      const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${r.body}`).digest('hex')}`;
      expect(r.headers['x-signalpost-signature']).toBe(expected);
    }
    expect(metrics.counterValue('signalpost_incidents_opened_total', { monitor: 'api' })).toBe(1);
    expect(metrics.counterValue('signalpost_checks_total', { monitor: 'api', result: 'fail' })).toBe(3);
    t.cleanup();
  });

  it('records a policy refusal as a failed check and never contacts the target', async () => {
    const t = tempDb();
    const config = testConfig({ ALLOWED_PORTS: String(target.port) });
    const { scheduler, metrics } = await createRuntime(config, t.db, {
      resolve: resolverTo('169.254.169.254'),
    });
    const id = createMonitor(t.db, monitor(target.url('/')));
    const before = target.received.length;
    const r = await scheduler.runCheck(getMonitor(t.db, id)!);
    expect(r.errorKind).toBe('blocked');
    expect(target.received.length).toBe(before);
    expect(metrics.counterValue('signalpost_policy_blocked_total', { source: 'check' })).toBe(1);
    t.cleanup();
  });

  it('the webhook is refused when its URL leaves the policy', async () => {
    const t = tempDb();
    const config = testConfig({ WEBHOOK_URL: 'http://169.254.169.254/hook', WEBHOOK_SECRET: 'x'.repeat(32) });
    const { webhook } = await createRuntime(config, t.db);
    const incidentId = createIncident(
      t.db,
      { monitorId: null, title: 'x', impact: 'outage', status: 'investigating', body: 'x' },
      'test',
    );
    expect(await webhook.send('incident.opened', incidentId, {})).toBe(false);
    const rows = t.db.prepare('SELECT ok, error FROM webhook_deliveries').all() as {
      ok: number;
      error: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toMatch(/^blocked/);
    t.cleanup();
  });
});

describe('seed and retention', () => {
  it('seeds idempotently with flagged demo history', async () => {
    const t = tempDb();
    const config = testConfig();
    const first = await seed(t.db, config);
    const second = await seed(t.db, config);
    expect(first.monitorsCreated).toBe(4);
    expect(second).toEqual({ monitorsCreated: 0, daysAdded: 0, incidentsAdded: 0 });
    expect(t.db.prepare('SELECT count(*) FROM daily WHERE synthetic = 0').pluck().get()).toBe(0);
    expect(t.db.prepare('SELECT count(*) FROM incidents WHERE synthetic = 1').pluck().get()).toBe(2);
    t.cleanup();
  });

  it('deletes raw checks past retention but keeps daily history and incidents', () => {
    const t = tempDb();
    const id = createMonitor(t.db, monitor('http://target.test/'));
    const now = Date.parse('2026-10-04T12:00:00Z');
    const insert = t.db.prepare('INSERT INTO checks (monitor_id, at, ok) VALUES (?, ?, 1)');
    for (let d = 0; d < 40; d++) insert.run(id, now - d * 86_400_000);
    t.db.prepare("INSERT INTO daily (monitor_id, day, total, ok) VALUES (?, '2026-08-01', 10, 10)").run(id);
    const r = runRetention(t.db, 30, 'Asia/Jerusalem', now);
    expect(r.checks).toBe(9);
    expect(t.db.prepare('SELECT count(*) FROM checks').pluck().get()).toBe(31);
    expect(t.db.prepare('SELECT count(*) FROM daily').pluck().get()).toBe(1);
    t.cleanup();
  });
});
