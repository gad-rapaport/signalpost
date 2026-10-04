import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  burnVerification,
  createSession,
  deleteSession,
  findSession,
  findUserByEmail,
  safeEqual,
  SESSION_COOKIE,
  verifyPassword,
  type Session,
} from './auth/auth.js';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import type { Metrics } from './metrics.js';
import {
  allIncidents,
  audit,
  auditLog,
  createIncident,
  getIncident,
  openIncidents,
  postUpdate,
  type Impact,
  type IncidentStatus,
} from './monitor/incidents.js';
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  getMonitorBySlug,
  listMonitors,
  recentChecks,
  setPaused,
  updateMonitor,
  uptimeSince,
} from './monitor/repo.js';
import type { Scheduler } from './monitor/scheduler.js';
import { checkTarget, PolicyError, type OutboundPolicy, type Resolver } from './net/policy.js';
import { recentDeliveries, type WebhookNotifier } from './notify/webhook.js';
import {
  auditView,
  deleteView,
  incidentDetailView,
  incidentsView,
  monitorDetailView,
  monitorFormView,
  newIncidentView,
  overviewView,
  settingsView,
} from './web/adminViews.js';
import { html, type Html } from './web/html.js';
import { adminPage, loginPage, publicPage } from './web/layout.js';
import { DEFAULT_FORM, formFromMonitor, parseMonitorForm, type FormValues } from './web/monitorForm.js';
import { overallStatus, renderStatusPage, stateTone } from './web/statusPage.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  metrics: Metrics;
  scheduler: Scheduler | null;
  webhook: WebhookNotifier;
  policy: OutboundPolicy;
  publicDir: string;
  resolve?: Resolver;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Flash messages are fixed strings chosen by key, so a crafted link cannot put text on the page. */
const FLASH: Record<string, string> = {
  created: 'Monitor added. The first check runs within a few seconds.',
  saved: 'Changes saved.',
  deleted: 'Monitor deleted.',
  paused: 'Monitor paused.',
  resumed: 'Monitor resumed.',
  checked: 'Check finished; the result is below.',
  posted: 'Incident posted.',
  updated: 'Update posted.',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(reply: FastifyReply, page: Html, status = 200) {
  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(page.value);
}

function idParam(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db, metrics, scheduler, webhook, policy } = deps;
  const tz = config.APP_TIMEZONE;

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization'], remove: true },
    },
    bodyLimit: 32 * 1024,
    trustProxy: config.TRUST_PROXY,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  await app.register(formbody, { bodyLimit: 32 * 1024 });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // Server-rendered pages without client scripts.
        scriptSrc: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.COOKIE_SECURE ? { maxAge: 15_552_000 } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });
  await app.register(rateLimit, { global: false, hook: 'preHandler' });

  app.decorateRequest('session', null);
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.COOKIE_SECURE,
  };

  const errorPage = (title: string, text: string, req: FastifyRequest) =>
    publicPage(
      title,
      config.STATUS_TITLE,
      html`<section class="panel">
        <h1>${title}</h1>
        <p>${text}</p>
        <p class="muted mono small">Request ${req.id}</p>
      </section>`,
    );

  app.setNotFoundHandler(async (req, reply) =>
    send(reply, errorPage('Page not found', 'There is nothing at this address.', req), 404),
  );
  app.setErrorHandler(async (err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError)
      return send(
        reply,
        errorPage(err.status === 403 ? 'Not allowed' : 'Not found', err.message, req),
        err.status,
      );
    const status = err.statusCode ?? 500;
    if (status === 429)
      return send(reply, errorPage('Too many attempts', 'Wait a minute and try again.', req), 429);
    if (status < 500)
      return send(reply, errorPage('Bad request', 'The request could not be read.', req), status);
    req.log.error({ err }, 'unhandled error');
    return send(
      reply,
      errorPage(
        'Something went wrong',
        'The error was logged. Quote the request id if it keeps happening.',
        req,
      ),
      500,
    );
  });

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/admin')) {
      const token = req.cookies[SESSION_COOKIE];
      req.session = token ? findSession(db, token) : null;
    }
  });

  // CSRF: every POST must come from our own origin (when the browser says where it comes from), and every
  // signed-in POST must echo the session's token. The session cookie is SameSite=Strict on top.
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'POST') return;
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.host}`)
      throw new HttpError(403, 'This form was sent from another site.');
    if (req.url.startsWith('/admin') && req.url !== '/admin/login') {
      const token = (req.body as Record<string, unknown> | undefined)?._csrf;
      if (!req.session) throw new HttpError(403, 'Your session has ended. Sign in again.');
      if (typeof token !== 'string' || !safeEqual(token, req.session.csrfToken)) {
        throw new HttpError(403, 'The form was out of date. Go back, reload and try again.');
      }
    }
  });

  const requireSession = (req: FastifyRequest, reply: FastifyReply): Session | null => {
    if (req.session) return req.session;
    void reply.redirect('/admin/login', 303);
    return null;
  };
  const actor = (s: Session) => s.user.email;
  const flashOf = (req: FastifyRequest) => FLASH[(req.query as { done?: string }).done ?? ''] ?? null;

  // ---------- public ----------
  app.get('/', async (_req, reply) =>
    send(reply, renderStatusPage(db, { title: config.STATUS_TITLE, timeZone: tz })),
  );

  app.get('/api/status.json', async (_req, reply) => {
    const monitors = listMonitors(db, { publicOnly: true });
    const open = openIncidents(db).filter((i) => i.monitorPublic);
    const overall = overallStatus(monitors, open);
    reply.header('cache-control', 'no-cache');
    return {
      status: overall.tone,
      description: overall.text,
      components: monitors.map((m) => ({ name: m.name, status: stateTone(m).tone })),
      openIncidents: open.map((i) => ({
        title: i.title,
        impact: i.impact,
        status: i.status,
        startedAt: new Date(i.startedAt).toISOString(),
      })),
      updatedAt: new Date().toISOString(),
    };
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ status: 'unavailable', reason: 'database' });
    }
    if (scheduler && scheduler.lagMs() > 15_000)
      return reply.code(503).send({ status: 'unavailable', reason: 'scheduler' });
    return { status: 'ready' };
  });

  app.get('/metrics', async (req, reply) => {
    if (!config.METRICS_TOKEN) return reply.code(404).send('metrics disabled\n');
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), config.METRICS_TOKEN)) {
      return reply.code(401).header('www-authenticate', 'Bearer').send('unauthorized\n');
    }
    const monitors = listMonitors(db);
    const pageCount = db.pragma('page_count', { simple: true }) as number;
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const states = ['unknown', 'up', 'degraded', 'down', 'paused'];
    const body = metrics.render([
      {
        name: 'signalpost_monitor_state',
        help: 'Current state per monitor (1 for the active state)',
        samples: monitors.flatMap((m) =>
          states.map((s) => ({
            labels: { monitor: m.slug, state: s },
            value: (m.isPaused ? 'paused' : m.state) === s ? 1 : 0,
          })),
        ),
      },
      {
        name: 'signalpost_monitor_last_latency_seconds',
        help: 'Latency of the last check per monitor',
        samples: monitors
          .filter((m) => m.lastLatencyMs !== null)
          .map((m) => ({ labels: { monitor: m.slug }, value: m.lastLatencyMs! / 1000 })),
      },
      {
        name: 'signalpost_incidents_open',
        help: 'Unresolved incidents',
        samples: [{ value: openIncidents(db).length }],
      },
      {
        name: 'signalpost_scheduler_lag_seconds',
        help: 'Seconds since the scheduler last ran',
        samples: [{ value: scheduler ? scheduler.lagMs() / 1000 : 0 }],
      },
      {
        name: 'signalpost_db_size_bytes',
        help: 'SQLite database file size',
        samples: [{ value: pageCount * pageSize }],
      },
      {
        name: 'process_resident_memory_bytes',
        help: 'Resident memory',
        samples: [{ value: process.memoryUsage().rss }],
      },
    ]);
    return reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(body);
  });

  // ---------- sign in ----------
  app.get('/admin/login', async (req, reply) => {
    if (req.session) return reply.redirect('/admin', 303);
    return send(reply, loginPage(null, ''));
  });

  app.post(
    '/admin/login',
    {
      config: {
        rateLimit: {
          max: config.LOGIN_RATE_LIMIT_PER_MINUTE,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, string>;
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase()
        .slice(0, 200);
      const password = String(body.password ?? '').slice(0, 200);
      const user = findUserByEmail(db, email);
      if (!user) await burnVerification(password);
      const ok = user ? await verifyPassword(user.passwordHash, password) : false;
      if (!user || !ok) {
        req.log.info({ event: 'login_failed' }, 'login failed');
        return send(reply, loginPage('Email or password is incorrect.', email), 401);
      }
      const s = createSession(db, user.id, config.SESSION_TTL_HOURS);
      audit(db, user.email, 'session.login', 'Signed in');
      reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOptions, expires: new Date(s.expiresAt) });
      return reply.redirect('/admin', 303);
    },
  );

  app.post('/admin/logout', async (req, reply) => {
    if (req.session) deleteSession(db, req.session.idHash);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.redirect('/admin/login', 303);
  });

  // ---------- monitors ----------
  app.get('/admin', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    const now = Date.now();
    const monitors = listMonitors(db).map((m) => ({
      ...m,
      uptime24h: uptimeSince(db, m.id, now - 86_400_000),
    }));
    return send(
      reply,
      adminPage(
        'Monitors',
        '/admin',
        s.user,
        s.csrfToken,
        overviewView(monitors, openIncidents(db).length, s.csrfToken, tz, now),
        { flash: flashOf(req) },
      ),
    );
  });

  const policyNote = html`<p class="hint">
    Allowed hosts: <span class="mono">${policy.allowedHosts.join(', ') || 'none'}</span>. Ports:
    <span class="mono">${policy.allowedPorts.join(', ')}</span>.
  </p>`;

  /** Validates fields, then the outbound policy (including DNS). A host that does not resolve yet may be saved. */
  async function validate(body: FormValues, excludeId: number | null) {
    const { input, errors } = parseMonitorForm(body, config.MIN_INTERVAL_S);
    if (!errors.slug) {
      const clash = getMonitorBySlug(db, input.slug);
      if (clash && clash.id !== excludeId) errors.slug = 'Another monitor already uses this identifier.';
    }
    if (!errors.url) {
      try {
        await checkTarget(input.url, policy, deps.resolve);
      } catch (err) {
        if (!(err instanceof PolicyError)) throw err;
        if (err.reason !== 'dns') {
          errors.url = `Blocked by the outbound policy: ${err.message}`;
          metrics.inc('signalpost_policy_blocked_total', { source: 'form' });
        }
      }
    }
    return { input, errors };
  }

  app.get('/admin/monitors/new', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    return send(
      reply,
      adminPage(
        'Add monitor',
        '/admin',
        s.user,
        s.csrfToken,
        monitorFormView({ kind: 'new' }, DEFAULT_FORM, {}, s.csrfToken, policyNote),
      ),
    );
  });

  app.post('/admin/monitors', async (req, reply) => {
    const s = req.session!;
    const body = req.body as FormValues;
    const { input, errors } = await validate(body, null);
    if (Object.keys(errors).length) {
      if (errors.url?.startsWith('Blocked'))
        audit(db, actor(s), 'monitor.blocked', `${input.url}: ${errors.url}`);
      return send(
        reply,
        adminPage(
          'Add monitor',
          '/admin',
          s.user,
          s.csrfToken,
          monitorFormView({ kind: 'new' }, body, errors, s.csrfToken, policyNote),
        ),
        422,
      );
    }
    const id = createMonitor(db, input);
    audit(db, actor(s), 'monitor.create', `${input.name} (${input.method} ${input.url})`);
    return reply.redirect(`/admin/monitors/${id}?done=created`, 303);
  });

  app.get('/admin/monitors/:id', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    const m = getMonitor(db, idParam(req));
    if (!m) throw new HttpError(404, 'This monitor does not exist.');
    return send(
      reply,
      adminPage(
        m.name,
        '/admin',
        s.user,
        s.csrfToken,
        monitorDetailView(m, recentChecks(db, m.id, 60), s.csrfToken, tz, Date.now()),
        { flash: flashOf(req) },
      ),
    );
  });

  app.get('/admin/monitors/:id/edit', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    const m = getMonitor(db, idParam(req));
    if (!m) throw new HttpError(404, 'This monitor does not exist.');
    return send(
      reply,
      adminPage(
        `Edit ${m.name}`,
        '/admin',
        s.user,
        s.csrfToken,
        monitorFormView({ kind: 'edit', id: m.id }, formFromMonitor(m), {}, s.csrfToken, policyNote),
      ),
    );
  });

  app.post('/admin/monitors/:id', async (req, reply) => {
    const s = req.session!;
    const id = idParam(req);
    if (!getMonitor(db, id)) throw new HttpError(404, 'This monitor does not exist.');
    const body = req.body as FormValues;
    const { input, errors } = await validate(body, id);
    if (Object.keys(errors).length) {
      return send(
        reply,
        adminPage(
          'Edit monitor',
          '/admin',
          s.user,
          s.csrfToken,
          monitorFormView({ kind: 'edit', id }, body, errors, s.csrfToken, policyNote),
        ),
        422,
      );
    }
    updateMonitor(db, id, input);
    scheduler?.reschedule(id);
    audit(db, actor(s), 'monitor.update', `${input.name} (${input.method} ${input.url})`);
    return reply.redirect(`/admin/monitors/${id}?done=saved`, 303);
  });

  for (const [verb, paused] of [
    ['pause', true],
    ['resume', false],
  ] as const) {
    app.post(`/admin/monitors/:id/${verb}`, async (req, reply) => {
      const s = req.session!;
      const m = getMonitor(db, idParam(req));
      if (!m) throw new HttpError(404, 'This monitor does not exist.');
      setPaused(db, m.id, paused);
      scheduler?.reschedule(m.id);
      audit(db, actor(s), `monitor.${verb}`, m.name);
      return reply.redirect(`/admin?done=${paused ? 'paused' : 'resumed'}`, 303);
    });
  }

  app.post('/admin/monitors/:id/check', async (req, reply) => {
    const m = getMonitor(db, idParam(req));
    if (!m) throw new HttpError(404, 'This monitor does not exist.');
    if (scheduler) await scheduler.runCheck(m);
    return reply.redirect(`/admin/monitors/${m.id}?done=checked`, 303);
  });

  app.get('/admin/monitors/:id/delete', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    const m = getMonitor(db, idParam(req));
    if (!m) throw new HttpError(404, 'This monitor does not exist.');
    return send(
      reply,
      adminPage(`Delete ${m.name}`, '/admin', s.user, s.csrfToken, deleteView(m, s.csrfToken)),
    );
  });

  app.post('/admin/monitors/:id/delete', async (req, reply) => {
    const s = req.session!;
    const m = getMonitor(db, idParam(req));
    if (!m) throw new HttpError(404, 'This monitor does not exist.');
    deleteMonitor(db, m.id);
    scheduler?.reschedule(m.id);
    audit(db, actor(s), 'monitor.delete', `${m.name} (${m.url})`);
    return reply.redirect('/admin?done=deleted', 303);
  });

  // ---------- incidents ----------
  app.get('/admin/incidents', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    return send(
      reply,
      adminPage(
        'Incidents',
        '/admin/incidents',
        s.user,
        s.csrfToken,
        incidentsView(allIncidents(db), tz, Date.now()),
        { flash: flashOf(req) },
      ),
    );
  });

  app.get('/admin/incidents/new', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    return send(
      reply,
      adminPage(
        'Post an incident',
        '/admin/incidents',
        s.user,
        s.csrfToken,
        newIncidentView(listMonitors(db), s.csrfToken, null, {}),
      ),
    );
  });

  const IMPACTS = new Set(['outage', 'degraded', 'maintenance']);
  const STATUSES = new Set(['investigating', 'identified', 'monitoring', 'resolved']);

  app.post('/admin/incidents', async (req, reply) => {
    const s = req.session!;
    const b = req.body as FormValues;
    const title = (b.title ?? '').trim().slice(0, 120);
    const text = (b.body ?? '').trim().slice(0, 2000);
    const monitorId = b.monitorId ? Number(b.monitorId) : null;
    const valid =
      title &&
      text &&
      IMPACTS.has(b.impact ?? '') &&
      STATUSES.has(b.status ?? '') &&
      (monitorId === null || getMonitor(db, monitorId));
    if (!valid) {
      return send(
        reply,
        adminPage(
          'Post an incident',
          '/admin/incidents',
          s.user,
          s.csrfToken,
          newIncidentView(
            listMonitors(db),
            s.csrfToken,
            'Fill in a title, an impact, a status and a message.',
            b,
          ),
        ),
        422,
      );
    }
    const id = createIncident(
      db,
      { monitorId, title, impact: b.impact as Impact, status: b.status as IncidentStatus, body: text },
      s.user.name,
    );
    audit(db, actor(s), 'incident.create', title);
    void webhook.send('incident.opened', id, { incidentId: id, title, impact: b.impact });
    return reply.redirect(`/admin/incidents/${id}?done=posted`, 303);
  });

  app.get('/admin/incidents/:id', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    const i = getIncident(db, idParam(req));
    if (!i) throw new HttpError(404, 'This incident does not exist.');
    return send(
      reply,
      adminPage(
        i.title,
        '/admin/incidents',
        s.user,
        s.csrfToken,
        incidentDetailView(i, s.csrfToken, tz, null),
        { flash: flashOf(req) },
      ),
    );
  });

  app.post('/admin/incidents/:id/updates', async (req, reply) => {
    const s = req.session!;
    const id = idParam(req);
    const i = getIncident(db, id);
    if (!i) throw new HttpError(404, 'This incident does not exist.');
    const b = req.body as FormValues;
    const text = (b.body ?? '').trim().slice(0, 2000);
    if (!text || !STATUSES.has(b.status ?? '')) {
      return send(
        reply,
        adminPage(
          i.title,
          '/admin/incidents',
          s.user,
          s.csrfToken,
          incidentDetailView(i, s.csrfToken, tz, 'Write a message and pick a status.'),
        ),
        422,
      );
    }
    postUpdate(db, id, b.status as IncidentStatus, text, s.user.name);
    audit(db, actor(s), 'incident.update', `${i.title}: ${b.status}`);
    void webhook.send(b.status === 'resolved' ? 'incident.resolved' : 'incident.updated', id, {
      incidentId: id,
      title: i.title,
      status: b.status,
    });
    return reply.redirect(`/admin/incidents/${id}?done=updated`, 303);
  });

  // ---------- settings and audit ----------
  app.get('/admin/settings', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    const pageCount = db.pragma('page_count', { simple: true }) as number;
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    return send(
      reply,
      adminPage(
        'Settings',
        '/admin/settings',
        s.user,
        s.csrfToken,
        settingsView({
          allowedHosts: policy.allowedHosts,
          allowPrivateHosts: policy.allowPrivateHosts,
          allowedPorts: policy.allowedPorts,
          retentionDays: config.RETENTION_DAYS,
          minIntervalS: config.MIN_INTERVAL_S,
          maxConcurrent: config.MAX_CONCURRENT_CHECKS,
          metricsEnabled: Boolean(config.METRICS_TOKEN),
          webhookUrl: webhook.enabled ? (config.WEBHOOK_URL ?? null) : null,
          deliveries: recentDeliveries(db),
          dbBytes: pageCount * pageSize,
          timeZone: tz,
        }),
      ),
    );
  });

  app.get('/admin/audit', async (req, reply) => {
    const s = requireSession(req, reply);
    if (!s) return reply;
    return send(
      reply,
      adminPage('Audit log', '/admin/audit', s.user, s.csrfToken, auditView(auditLog(db), tz)),
    );
  });

  await app.register(fastifyStatic, {
    root: path.resolve(deps.publicDir),
    prefix: '/assets/',
    index: false,
    setHeaders: (res, file) => {
      res.header(
        'cache-control',
        file.includes(`${path.sep}fonts${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      );
    },
  });

  return app;
}
