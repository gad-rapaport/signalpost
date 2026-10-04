import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

/**
 * Demo target: a tiny fake shop on the internal Docker network for the demo monitors to watch, with a
 * control endpoint for failure drills and a receiver that verifies Signalpost webhooks.
 * Not exposed on any host port.
 */
export type DemoMode = 'normal' | 'slow' | 'error';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demo shop</title></head>
<body><h1>Demo shop</h1><p>A stand-in website for the Signalpost demo.</p></body></html>`;

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createDemoTarget(opts: {
  controlToken?: string;
  webhookSecret?: string;
  log?: (msg: string) => void;
}) {
  let mode: DemoMode = 'normal';
  const log = opts.log ?? (() => {});
  const delay = () => (mode === 'slow' ? 1200 + Math.random() * 600 : 30 + Math.random() * 90);

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://demo');
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 16_384) chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && url.pathname === '/__mode') {
        const token = req.headers['x-demo-token'];
        if (!opts.controlToken || typeof token !== 'string' || !equal(token, opts.controlToken)) {
          res.writeHead(403).end('forbidden\n');
          return;
        }
        const next = body.trim() as DemoMode;
        if (!['normal', 'slow', 'error'].includes(next)) {
          res.writeHead(400).end('mode must be normal, slow or error\n');
          return;
        }
        mode = next;
        log(`mode set to ${mode}`);
        res.writeHead(200, { 'content-type': 'text/plain' }).end(`${mode}\n`);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/__webhook') {
        const ts = String(req.headers['x-signalpost-timestamp'] ?? '');
        const sig = String(req.headers['x-signalpost-signature'] ?? '');
        const expected = opts.webhookSecret
          ? `sha256=${createHmac('sha256', opts.webhookSecret).update(`${ts}.${body}`).digest('hex')}`
          : '';
        const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
        const ok = Boolean(expected) && equal(sig, expected) && fresh;
        log(`webhook received: ${ok ? 'signature valid' : 'signature INVALID'} ${body.slice(0, 200)}`);
        res.writeHead(ok ? 204 : 401).end();
        return;
      }
      setTimeout(() => {
        if (mode === 'error' && url.pathname !== '/__mode') {
          res.writeHead(503, { 'content-type': 'text/plain' }).end('service unavailable\n');
          return;
        }
        if (url.pathname === '/')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
        else if (url.pathname === '/health')
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
        else if (url.pathname === '/api/orders') {
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ orders: [{ id: 'A-1001', status: 'shipped' }] }));
        } else if (url.pathname === '/moved')
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
        else res.writeHead(404).end('not found\n');
      }, delay());
    });
  });
}
