import type { Db } from '../db/db.js';
import type { Metrics } from '../metrics.js';
import type { OutboundPolicy, Resolver } from '../net/policy.js';
import { probe, type ProbeResult } from '../net/probe.js';
import type { WebhookNotifier } from '../notify/webhook.js';
import { getMonitor, listMonitors, recordCheck, type Monitor } from './repo.js';
import { openAutoIncident, resolveAutoIncident } from './incidents.js';

/** Failure description for the public status page. Technical details stay in the admin's check log. */
export function publicReason(r: ProbeResult): string {
  switch (r.errorKind) {
    case 'status':
      return `the service answered with HTTP ${r.statusCode}`;
    case 'timeout':
      return 'no response in time';
    case 'dns':
      return 'the service name could not be looked up';
    case 'connect':
      return 'the connection was refused or dropped';
    case 'tls':
      return 'the secure connection could not be established';
    case 'redirect':
      return 'an unexpected redirect';
    case 'keyword':
      return 'the expected content was missing';
    case 'blocked':
      return 'the check was refused by the outbound policy';
    default:
      return 'the check failed';
  }
}

export interface SchedulerDeps {
  db: Db;
  policy: OutboundPolicy;
  metrics: Metrics;
  webhook: WebhookNotifier;
  timeZone: string;
  maxConcurrent: number;
  resolve?: Resolver;
  now?: () => number;
  log?: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

/**
 * Runs due checks. One tick per second looks for monitors whose next run is due; at most `maxConcurrent`
 * checks run at once, a monitor never overlaps itself, and first runs are spread over the interval so a
 * restart does not fire every check at the same moment.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<number>();
  private nextRun = new Map<number, number>();
  private queue: number[] = [];
  lastTickAt = 0;

  constructor(private readonly deps: SchedulerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Lag between now and the last tick; /readyz fails when the loop is stuck. */
  lagMs(): number {
    return this.lastTickAt ? this.now() - this.lastTickAt : Number.POSITIVE_INFINITY;
  }

  tick(): void {
    const now = this.now();
    this.lastTickAt = now;
    for (const m of listMonitors(this.deps.db)) {
      if (m.isPaused) {
        this.nextRun.delete(m.id);
        continue;
      }
      if (!this.nextRun.has(m.id)) {
        // Spread first runs: a monitor that was checked recently waits for its interval, others start
        // within the first few seconds in a stable order.
        const due = m.lastCheckedAt ? m.lastCheckedAt + m.intervalS * 1000 : now + (m.id % 10) * 300;
        this.nextRun.set(m.id, Math.max(now, due));
      }
      if (this.nextRun.get(m.id)! <= now && !this.running.has(m.id) && !this.queue.includes(m.id))
        this.queue.push(m.id);
    }
    this.drain();
  }

  private drain(): void {
    while (this.running.size < this.deps.maxConcurrent && this.queue.length) {
      const id = this.queue.shift()!;
      const m = getMonitor(this.deps.db, id);
      if (!m || m.isPaused) continue;
      this.running.add(id);
      this.nextRun.set(id, this.now() + m.intervalS * 1000);
      void this.runCheck(m).finally(() => {
        this.running.delete(id);
        this.drain();
      });
    }
  }

  /** Runs one check now (also used by "Check now" in the admin). */
  async runCheck(m: Monitor): Promise<ProbeResult> {
    const { db, metrics, policy, webhook, timeZone } = this.deps;
    const result = await probe(
      {
        url: m.url,
        method: m.method,
        timeoutMs: m.timeoutMs,
        expectedMin: m.expectedMin,
        expectedMax: m.expectedMax,
        keyword: m.keyword,
      },
      policy,
      this.deps.resolve,
    );
    const at = this.now();
    metrics.inc('signalpost_checks_total', { monitor: m.slug, result: result.ok ? 'ok' : 'fail' });
    if (result.ok && result.latencyMs !== null)
      metrics.observe('signalpost_check_duration_seconds', { monitor: m.slug }, result.latencyMs / 1000);
    if (result.errorKind === 'blocked') {
      metrics.inc('signalpost_policy_blocked_total', { source: 'check' });
      this.deps.log?.warn(
        { monitor: m.slug, detail: result.errorDetail },
        'check refused by outbound policy',
      );
    }
    const recorded = recordCheck(db, m.id, result, at, timeZone);
    if (!recorded) return result;
    if (recorded.transition === 'down') {
      // The incident text is public: it names the kind of failure, never hosts, addresses or error strings.
      const incidentId = openAutoIncident(db, m.id, m.name, publicReason(result), at);
      this.deps.log?.warn({ monitor: m.slug, incidentId }, 'monitor down');
      if (incidentId) {
        metrics.inc('signalpost_incidents_opened_total', { monitor: m.slug });
        void webhook.send('incident.opened', incidentId, {
          incidentId,
          monitor: { slug: m.slug, name: m.name },
          detail: result.errorDetail,
        });
      }
    } else if (recorded.transition === 'recovered') {
      const incidentId = resolveAutoIncident(db, m.id, at, m.stateSince);
      this.deps.log?.info({ monitor: m.slug, incidentId }, 'monitor recovered');
      if (incidentId)
        void webhook.send('incident.resolved', incidentId, {
          incidentId,
          monitor: { slug: m.slug, name: m.name },
        });
    }
    return result;
  }

  /** Forget the schedule of a monitor whose settings changed, so the new interval applies at once. */
  reschedule(id: number): void {
    this.nextRun.delete(id);
  }
}
