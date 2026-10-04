import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { createMetrics, type Metrics } from './metrics.js';
import { Scheduler } from './monitor/scheduler.js';
import type { OutboundPolicy, Resolver } from './net/policy.js';
import { WebhookNotifier } from './notify/webhook.js';

export function policyFrom(config: Config): OutboundPolicy {
  return {
    allowedHosts: config.ALLOWED_HOSTS,
    allowPrivateHosts: config.ALLOW_PRIVATE_HOSTS,
    allowedPorts: config.ALLOWED_PORTS,
  };
}

/** dist/public in the image, ./public next to the sources in development. */
export function defaultPublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'public');
}

export interface Runtime {
  app: FastifyInstance;
  scheduler: Scheduler;
  metrics: Metrics;
  webhook: WebhookNotifier;
}

export async function createRuntime(
  config: Config,
  db: Db,
  opts: { resolve?: Resolver; publicDir?: string; now?: () => number } = {},
): Promise<Runtime> {
  const policy = policyFrom(config);
  const metrics = createMetrics();
  const log = {
    info: (o: object, m: string) => app.log.info(o, m),
    warn: (o: object, m: string) => app.log.warn(o, m),
  };
  const webhook = new WebhookNotifier(
    db,
    config.WEBHOOK_URL && config.WEBHOOK_SECRET
      ? { url: config.WEBHOOK_URL, secret: config.WEBHOOK_SECRET }
      : null,
    policy,
    metrics,
    { resolve: opts.resolve, log: (msg) => app.log.warn(msg) },
  );
  const scheduler = new Scheduler({
    db,
    policy,
    metrics,
    webhook,
    timeZone: config.APP_TIMEZONE,
    maxConcurrent: config.MAX_CONCURRENT_CHECKS,
    resolve: opts.resolve,
    now: opts.now,
    log,
  });
  const app: FastifyInstance = await buildApp({
    config,
    db,
    metrics,
    scheduler,
    webhook,
    policy,
    publicDir: opts.publicDir ?? defaultPublicDir(),
    resolve: opts.resolve,
  });
  return { app, scheduler, metrics, webhook };
}
