import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { PolicyError, parseTarget, resolveTarget, type OutboundPolicy, type Resolver } from './policy.js';

export type ErrorKind =
  'blocked' | 'dns' | 'timeout' | 'connect' | 'tls' | 'status' | 'redirect' | 'keyword' | 'protocol';

export interface ProbeSpec {
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
  expectedMin: number;
  expectedMax: number;
  keyword: string | null;
}

export interface ProbeResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorKind: ErrorKind | null;
  errorDetail: string | null;
}

/** Bytes of body read when looking for a keyword; the rest is discarded unread. */
export const MAX_BODY_BYTES = 64 * 1024;
export const USER_AGENT = 'Signalpost/0.1 (uptime check)';

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
}

function classifyNetworkError(err: NodeJS.ErrnoException): ProbeResult {
  const code = err.code ?? '';
  const tls = code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'EPROTO';
  return {
    ok: false,
    statusCode: null,
    latencyMs: null,
    errorKind: tls ? 'tls' : 'connect',
    errorDetail: code || err.message.slice(0, 200),
  };
}

/**
 * One check. The outbound policy is enforced on every run (not only when the monitor was saved), the
 * connection is pinned to the address that was checked, redirects are reported rather than followed, at most
 * 64 KB of body is read, and a single deadline covers DNS, connect, TLS and the response.
 */
export async function probe(
  spec: ProbeSpec,
  policy: OutboundPolicy,
  resolve?: Resolver,
): Promise<ProbeResult> {
  const started = performance.now();
  const deadline = started + spec.timeoutMs;
  let target;
  let address;
  try {
    target = parseTarget(spec.url, policy);
    address = await resolveTarget(target, policy, resolve);
  } catch (err) {
    if (err instanceof PolicyError) {
      return {
        ok: false,
        statusCode: null,
        latencyMs: null,
        errorKind: err.reason === 'dns' ? 'dns' : 'blocked',
        errorDetail: err.message,
      };
    }
    throw err;
  }
  const remaining = Math.max(1, deadline - performance.now());
  const isHttps = target.url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise<ProbeResult>((resolvePromise) => {
    let settled = false;
    const finish = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolvePromise(r);
    };
    const req = lib.request(
      {
        protocol: target.url.protocol,
        hostname: target.host,
        port: target.port,
        path: `${target.url.pathname}${target.url.search}`,
        method: spec.method,
        headers: { 'user-agent': USER_AGENT, accept: '*/*', connection: 'close' },
        lookup: pinnedLookup(address.address, address.family),
        agent: false,
        // TLS: certificate verified against the hostname, not the pinned address.
        ...(isHttps ? { servername: target.host, rejectUnauthorized: true } : {}),
      },
      (res) => {
        const latencyMs = Math.round(performance.now() - started);
        const status = res.statusCode ?? 0;
        const inRange = status >= spec.expectedMin && status <= spec.expectedMax;
        if (!inRange) {
          const redirect = status >= 300 && status < 400;
          const location = typeof res.headers.location === 'string' ? res.headers.location.slice(0, 200) : '';
          return finish({
            ok: false,
            statusCode: status,
            latencyMs,
            errorKind: redirect ? 'redirect' : 'status',
            errorDetail: redirect
              ? `Redirect not followed${location ? ` (to ${location})` : ''}`
              : `HTTP ${status}`,
          });
        }
        if (!spec.keyword || spec.method === 'HEAD') {
          return finish({ ok: true, statusCode: status, latencyMs, errorKind: null, errorDetail: null });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const check = () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const found = body.includes(spec.keyword!);
          finish({
            ok: found,
            statusCode: status,
            latencyMs,
            errorKind: found ? null : 'keyword',
            errorDetail: found ? null : `Keyword not found in the first ${MAX_BODY_BYTES / 1024} KB`,
          });
        };
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= MAX_BODY_BYTES) check();
        });
        res.on('end', check);
        res.on('error', () => check());
      },
    );
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          statusCode: null,
          latencyMs: null,
          errorKind: 'timeout',
          errorDetail: `No response within ${spec.timeoutMs} ms`,
        }),
      remaining,
    );
    req.on('error', (err) => finish(classifyNetworkError(err)));
    req.end();
  });
}
