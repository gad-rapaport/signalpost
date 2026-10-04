import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboundPolicy } from '../../src/net/policy.js';
import { MAX_BODY_BYTES, probe, USER_AGENT, type ProbeSpec } from '../../src/net/probe.js';
import { resolverTo, startTarget, TARGET_HOST } from './helpers.js';

let target: Awaited<ReturnType<typeof startTarget>>;
let policy: OutboundPolicy;
const spec = (path: string, over: Partial<ProbeSpec> = {}): ProbeSpec => ({
  url: target.url(path),
  method: 'GET',
  timeoutMs: 2000,
  expectedMin: 200,
  expectedMax: 299,
  keyword: null,
  ...over,
});

beforeAll(async () => {
  target = await startTarget((req, res) => {
    const url = req.url ?? '/';
    if (url === '/ok') res.end('hello signal');
    else if (url === '/503') res.writeHead(503).end('down');
    else if (url === '/redirect')
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    else if (url === '/slow') setTimeout(() => res.end('late'), 1500);
    else if (url === '/big') {
      res.write('x'.repeat(MAX_BODY_BYTES * 4));
      res.end('needle');
    } else res.writeHead(404).end();
  });
  policy = { allowedHosts: [TARGET_HOST], allowPrivateHosts: [TARGET_HOST], allowedPorts: [target.port] };
});
afterAll(() => target.close());

describe('probe against a real server', () => {
  const resolve = () => resolverTo(target.host);

  it('passes a healthy endpoint and identifies itself', async () => {
    const r = await probe(spec('/ok', { keyword: 'signal' }), policy, resolve());
    expect(r).toMatchObject({ ok: true, statusCode: 200, errorKind: null });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(target.received.at(-1)?.headers['user-agent']).toBe(USER_AGENT);
  });

  it('fails on an unexpected status and on a missing keyword', async () => {
    expect(await probe(spec('/503'), policy, resolve())).toMatchObject({
      ok: false,
      statusCode: 503,
      errorKind: 'status',
    });
    expect(await probe(spec('/ok', { keyword: 'absent' }), policy, resolve())).toMatchObject({
      ok: false,
      errorKind: 'keyword',
    });
  });

  it('reports redirects without following them', async () => {
    const before = target.received.length;
    const r = await probe(spec('/redirect'), policy, resolve());
    expect(r).toMatchObject({ ok: false, statusCode: 302, errorKind: 'redirect' });
    expect(r.errorDetail).toContain('169.254.169.254');
    expect(target.received.length).toBe(before + 1);
  });

  it('times out with one deadline', async () => {
    const t0 = Date.now();
    const r = await probe(spec('/slow', { timeoutMs: 600 }), policy, resolve());
    expect(r).toMatchObject({ ok: false, errorKind: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1400);
  });

  it('reads at most 64 KB when looking for a keyword', async () => {
    const r = await probe(spec('/big', { keyword: 'needle' }), policy, resolve());
    expect(r).toMatchObject({ ok: false, errorKind: 'keyword' });
  });

  it('refuses at check time when the name now resolves to loopback (rebinding)', async () => {
    const before = target.received.length;
    const r = await probe(spec('/ok'), policy, resolverTo('127.0.0.1'));
    expect(r).toMatchObject({ ok: false, errorKind: 'blocked' });
    expect(target.received.length).toBe(before);
  });

  it('connects to the pinned address, not to a second DNS answer', async () => {
    let calls = 0;
    const flipping = async () => {
      calls++;
      return [{ address: calls === 1 ? target.host : '127.0.0.1', family: 4 as const }];
    };
    const r = await probe(spec('/ok'), policy, flipping);
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('classifies refused connections and unknown names', async () => {
    // A port that was just released on this address refuses connections.
    const spare = await startTarget((_q, s) => s.end());
    const port = spare.port;
    await spare.close();
    const closed = { ...policy, allowedPorts: [port] };
    // Windows retries a refused SYN for about two seconds before reporting it, hence the longer timeout.
    expect(
      await probe(
        { ...spec('/ok', { timeoutMs: 6000 }), url: `http://${TARGET_HOST}:${port}/` },
        closed,
        resolve(),
      ),
    ).toMatchObject({ ok: false, errorKind: 'connect' });
    expect(await probe(spec('/ok'), policy, async () => [])).toMatchObject({ ok: false, errorKind: 'dns' });
  });
});
