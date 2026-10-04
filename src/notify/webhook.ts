import { createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Db } from '../db/db.js';
import type { Metrics } from '../metrics.js';
import {
  PolicyError,
  parseTarget,
  resolveTarget,
  type OutboundPolicy,
  type Resolver,
} from '../net/policy.js';
import { USER_AGENT } from '../net/probe.js';

export type WebhookEvent = 'incident.opened' | 'incident.resolved' | 'incident.updated';

export interface WebhookConfig {
  url: string;
  secret: string;
}

/** Signature over "<timestamp>.<body>", so a captured request cannot be replayed with a new timestamp. */
export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

const DELAYS_MS = [0, 2_000, 10_000];

async function postOnce(
  cfg: WebhookConfig,
  body: string,
  policy: OutboundPolicy,
  resolve?: Resolver,
): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
  let target;
  let address;
  try {
    target = parseTarget(cfg.url, policy);
    address = await resolveTarget(target, policy, resolve);
  } catch (err) {
    if (err instanceof PolicyError) return { ok: false, statusCode: null, error: `blocked: ${err.message}` };
    throw err;
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const isHttps = target.url.protocol === 'https:';
  return new Promise((done) => {
    const req = (isHttps ? https : http).request(
      {
        protocol: target.url.protocol,
        hostname: target.host,
        port: target.port,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'POST',
        agent: false,
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o?.all
            ? cb(null, [address])
            : cb(null, address.address, address.family)) as unknown as LookupFunction,
        ...(isHttps ? { servername: target.host } : {}),
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'user-agent': USER_AGENT,
          'x-signalpost-timestamp': timestamp,
          'x-signalpost-signature': sign(cfg.secret, timestamp, body),
        },
        timeout: 5_000,
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        done({
          ok: code >= 200 && code < 300,
          statusCode: code,
          error: code >= 200 && code < 300 ? null : `HTTP ${code}`,
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err: NodeJS.ErrnoException) =>
      done({ ok: false, statusCode: null, error: err.code ?? err.message }),
    );
    req.end(body);
  });
}

export class WebhookNotifier {
  constructor(
    private readonly db: Db,
    private readonly cfg: WebhookConfig | null,
    private readonly policy: OutboundPolicy,
    private readonly metrics: Metrics,
    private readonly opts: {
      resolve?: Resolver;
      sleep?: (ms: number) => Promise<void>;
      log?: (msg: string) => void;
    } = {},
  ) {}

  get enabled(): boolean {
    return this.cfg !== null;
  }

  /** Fire and forget from the scheduler's point of view; failures are recorded, never thrown. */
  async send(event: WebhookEvent, incidentId: number, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.cfg) return false;
    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), ...payload });
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= DELAYS_MS.length; attempt++) {
      if (DELAYS_MS[attempt - 1]) await sleep(DELAYS_MS[attempt - 1]!);
      const r = await postOnce(this.cfg, body, this.policy, this.opts.resolve);
      this.db
        .prepare(
          'INSERT INTO webhook_deliveries (incident_id, event, at, attempt, ok, status_code, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(incidentId, event, Date.now(), attempt, r.ok ? 1 : 0, r.statusCode, r.error);
      this.metrics.inc('signalpost_webhook_deliveries_total', { result: r.ok ? 'ok' : 'failed' });
      if (r.ok) return true;
      if (r.error?.startsWith('blocked')) {
        this.metrics.inc('signalpost_policy_blocked_total', { source: 'webhook' });
        this.opts.log?.(`webhook refused by outbound policy: ${r.error}`);
        return false;
      }
    }
    this.opts.log?.(`webhook delivery failed after ${DELAYS_MS.length} attempts`);
    return false;
  }
}

export function recentDeliveries(db: Db, limit = 20) {
  return db
    .prepare(
      'SELECT event, at, attempt, ok, status_code AS statusCode, error FROM webhook_deliveries ORDER BY at DESC, id DESC LIMIT ?',
    )
    .all(limit) as {
    event: string;
    at: number;
    attempt: number;
    ok: number;
    statusCode: number | null;
    error: string | null;
  }[];
}
