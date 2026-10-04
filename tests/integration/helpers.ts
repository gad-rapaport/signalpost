import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from '../../src/config.js';
import { migrate, openDb, type Db } from '../../src/db/db.js';
import type { Resolver } from '../../src/net/policy.js';

/**
 * The outbound policy never allows loopback, so tests serve their targets on this machine's first
 * non-internal IPv4 address (a private LAN or container address) and map test hostnames to it.
 */
export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('no non-loopback IPv4 address available for integration tests');
}

export const TARGET_HOST = 'target.test';

export function resolverTo(address: string, overrides: Record<string, string> = {}): Resolver {
  return async (host) => {
    const ip = overrides[host] ?? (host === TARGET_HOST || host === 'hook.test' ? address : null);
    if (!ip) throw new Error('ENOTFOUND');
    return [{ address: ip, family: 4 }];
  };
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: ':memory:',
    ALLOWED_HOSTS: `${TARGET_HOST},hook.test,example.org`,
    ALLOW_PRIVATE_HOSTS: `${TARGET_HOST},hook.test`,
    ALLOWED_PORTS: '80,443,8080',
    SEED_ADMIN_PASSWORD: 'correct-horse-battery',
    SCHEDULER_ENABLED: 'false',
    MIN_INTERVAL_S: '5',
    ...overrides,
  });
}

export function tempDb(): { db: Db; file: string; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'signalpost-'));
  const file = path.join(dir, 'test.db');
  const db = openDb(file);
  migrate(db);
  return {
    db,
    file,
    dir,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

/** A local HTTP server on the LAN address; swap `handler` to change behaviour mid-test. */
export async function startTarget(initial: Handler) {
  const host = lanAddress();
  const state = { handler: initial };
  const received: { headers: http.IncomingHttpHeaders; body: string; url: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body, url: req.url ?? '' });
      state.handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, host, r));
  const port = (server.address() as AddressInfo).port;
  return {
    host,
    port,
    state,
    received,
    url: (p = '/') => `http://${TARGET_HOST}:${port}${p}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
