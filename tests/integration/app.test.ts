import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupTo, restoreFrom } from '../../src/db/backup.js';
import { openDb } from '../../src/db/db.js';
import { seed } from '../../src/db/seed.js';
import { listMonitors } from '../../src/monitor/repo.js';
import { createRuntime, type Runtime } from '../../src/runtime.js';
import { resolverTo, tempDb, testConfig } from './helpers.js';

let rt: Runtime;
let t: ReturnType<typeof tempDb>;
const METRICS_TOKEN = 'm'.repeat(32);

beforeAll(async () => {
  t = tempDb();
  const config = testConfig({ METRICS_TOKEN });
  await seed(t.db, config);
  rt = await createRuntime(config, t.db, {
    resolve: resolverTo('10.20.30.40', { 'example.org': '93.184.215.14' }),
  });
});
afterAll(async () => {
  await rt.app.close();
  t.cleanup();
});

async function signIn(): Promise<{ cookie: string; csrf: string }> {
  const res = await rt.app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: 'email=admin%40signalpost.test&password=correct-horse-battery',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(303);
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  const page = await rt.app.inject({ url: '/admin', headers: { cookie } });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)![1]!;
  return { cookie, csrf };
}

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();
const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  rt.app.inject({
    method: 'POST',
    url,
    payload: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });

describe('public endpoints', () => {
  it('serves the status page with strict security headers', async () => {
    const res = await rt.app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Storefront');
    expect(res.body).toContain('generated demo history');
    expect(res.body).not.toContain('demo-api:8080');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('exposes a JSON summary without URLs', async () => {
    const res = await rt.app.inject({ url: '/api/status.json' });
    const body = res.json();
    expect(body.components.map((c: { name: string }) => c.name)).toEqual([
      'Storefront',
      'Orders API',
      'Sign-in service',
    ]);
    expect(res.body).not.toContain('http://');
  });

  it('answers health and readiness', async () => {
    expect((await rt.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    // The scheduler is not started in tests, so readiness reports it.
    expect((await rt.app.inject({ url: '/readyz' })).json()).toEqual({
      status: 'unavailable',
      reason: 'scheduler',
    });
  });

  it('protects metrics with a bearer token', async () => {
    expect((await rt.app.inject({ url: '/metrics' })).statusCode).toBe(401);
    expect(
      (await rt.app.inject({ url: '/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode,
    ).toBe(401);
    const ok = await rt.app.inject({
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('signalpost_monitor_state{monitor="storefront",state="unknown"} 1');
    expect(ok.body).toContain('signalpost_db_size_bytes');
  });

  it('escapes stored text on the status page', async () => {
    t.db.prepare("UPDATE monitors SET name = '<img src=x onerror=alert(1)>' WHERE slug = 'sign-in'").run();
    const res = await rt.app.inject({ url: '/' });
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    t.db.prepare("UPDATE monitors SET name = 'Sign-in service' WHERE slug = 'sign-in'").run();
  });
});

describe('admin', () => {
  it('redirects to sign-in and rejects a wrong password without saying which part was wrong', async () => {
    const res = await rt.app.inject({ url: '/admin' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/login');
    const bad = await post('/admin/login', form({ email: 'admin@signalpost.test', password: 'nope' }));
    expect(bad.statusCode).toBe(401);
    expect(bad.body).toContain('Email or password is incorrect.');
  });

  it('sets a strict, http-only session cookie', async () => {
    const res = await post(
      '/admin/login',
      form({ email: 'admin@signalpost.test', password: 'correct-horse-battery' }),
    );
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('rejects posts without the CSRF token or from another origin', async () => {
    const { cookie, csrf } = await signIn();
    expect((await post('/admin/monitors/1/pause', '', { cookie })).statusCode).toBe(403);
    expect((await post('/admin/monitors/1/pause', form({ _csrf: 'forged' }), { cookie })).statusCode).toBe(
      403,
    );
    expect(
      (
        await post('/admin/monitors/1/pause', form({ _csrf: csrf }), {
          cookie,
          origin: 'https://evil.example',
        })
      ).statusCode,
    ).toBe(403);
    expect((await post('/admin/monitors/1/pause', form({ _csrf: csrf }), { cookie })).statusCode).toBe(303);
    expect((await post('/admin/monitors/1/resume', form({ _csrf: csrf }), { cookie })).statusCode).toBe(303);
  });

  it('refuses monitors that break the outbound policy and records the attempt', async () => {
    const { cookie, csrf } = await signIn();
    const base = {
      _csrf: csrf,
      name: 'Metadata',
      method: 'GET',
      intervalS: '60',
      timeoutMs: '5000',
      expectedMin: '200',
      expectedMax: '299',
      degradedMs: '1000',
      failThreshold: '2',
      recoverThreshold: '2',
      sortOrder: '0',
    };
    for (const [url, message] of [
      ['http://169.254.169.254/latest/meta-data/', 'not on the outbound allowlist'],
      ['file:///etc/passwd', 'Only http and https'],
      ['http://example.org:22/', 'Port 22 is not allowed'],
      ['https://user:pw@example.org/', 'credentials'],
    ]) {
      const res = await post('/admin/monitors', form({ ...base, url: url! }), { cookie });
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain(message!);
    }
    const audit = await rt.app.inject({ url: '/admin/audit', headers: { cookie } });
    expect(audit.body).toContain('monitor.blocked');
    expect(rt.metrics.counterValue('signalpost_policy_blocked_total', { source: 'form' })).toBe(4);
  });

  it('creates, edits and deletes a monitor within the policy', async () => {
    const { cookie, csrf } = await signIn();
    const fields = {
      _csrf: csrf,
      name: 'Public site',
      url: 'https://example.org/',
      method: 'GET',
      intervalS: '60',
      timeoutMs: '5000',
      expectedMin: '200',
      expectedMax: '299',
      degradedMs: '1000',
      failThreshold: '2',
      recoverThreshold: '2',
      sortOrder: '5',
      isPublic: 'on',
    };
    const created = await post('/admin/monitors', form(fields), { cookie });
    expect(created.statusCode).toBe(303);
    const id = /\/admin\/monitors\/(\d+)/.exec(String(created.headers.location))![1];
    const dup = await post('/admin/monitors', form(fields), { cookie });
    expect(dup.body).toContain('Another monitor already uses this identifier.');
    const edited = await post(`/admin/monitors/${id}`, form({ ...fields, name: 'Public website' }), {
      cookie,
    });
    expect(edited.statusCode).toBe(303);
    expect(listMonitors(t.db).some((m) => m.name === 'Public website')).toBe(true);
    expect((await post(`/admin/monitors/${id}/delete`, form({ _csrf: csrf }), { cookie })).statusCode).toBe(
      303,
    );
    expect(listMonitors(t.db).some((m) => m.slug === 'public-site')).toBe(false);
  });

  it('posts a manual incident that appears on the status page, then resolves it', async () => {
    const { cookie, csrf } = await signIn();
    const res = await post(
      '/admin/incidents',
      form({
        _csrf: csrf,
        title: 'Payments delayed',
        monitorId: '',
        impact: 'degraded',
        status: 'investigating',
        body: 'Looking into it.',
      }),
      { cookie },
    );
    expect(res.statusCode).toBe(303);
    const id = /\/admin\/incidents\/(\d+)/.exec(String(res.headers.location))![1];
    let page = await rt.app.inject({ url: '/' });
    expect(page.body).toContain('Payments delayed');
    expect(page.body).toContain('Degraded performance');
    await post(`/admin/incidents/${id}/updates`, form({ _csrf: csrf, status: 'resolved', body: 'Fixed.' }), {
      cookie,
    });
    page = await rt.app.inject({ url: '/' });
    expect(page.body).not.toContain('Degraded performance');
  });

  it('signs out', async () => {
    const { cookie, csrf } = await signIn();
    await post('/admin/logout', form({ _csrf: csrf }), { cookie });
    expect((await rt.app.inject({ url: '/admin', headers: { cookie } })).statusCode).toBe(303);
  });
});

describe('login rate limit', () => {
  it('answers 429 after the configured number of attempts per minute', async () => {
    const local = tempDb();
    const config = testConfig({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    await seed(local.db, config);
    const runtime = await createRuntime(config, local.db);
    const attempt = () =>
      runtime.app.inject({
        method: 'POST',
        url: '/admin/login',
        payload: 'email=admin%40signalpost.test&password=wrong',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await attempt()).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
    await runtime.app.close();
    local.cleanup();
  });
});

describe('backup and restore', () => {
  it('takes a consistent online backup and restores it into a new file', async () => {
    const dir = path.join(t.dir, 'backups');
    const { file, bytes } = await backupTo(t.db, dir);
    expect(bytes).toBeGreaterThan(0);
    const target = path.join(t.dir, 'restored', 'signalpost.db');
    restoreFrom(file, target);
    const restored = openDb(target);
    expect(restored.prepare('SELECT count(*) FROM monitors').pluck().get()).toBe(listMonitors(t.db).length);
    restored.close();
    // A second restore keeps the replaced file aside.
    const r = restoreFrom(file, target);
    expect(r.previous && existsSync(r.previous)).toBe(true);
    expect(() => restoreFrom(path.join(dir, 'missing.db'), target)).toThrow(/no such backup/);
  });
});
