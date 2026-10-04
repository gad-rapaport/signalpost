import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../src/metrics.js';
import { sign } from '../../src/notify/webhook.js';
import { lastDays, dayOf, formatDuration } from '../../src/time.js';
import { escapeHtml, html } from '../../src/web/html.js';
import { parseMonitorForm, slugify, DEFAULT_FORM } from '../../src/web/monitorForm.js';
import { overallStatus } from '../../src/web/statusPage.js';
import type { Monitor } from '../../src/monitor/repo.js';
import { publicReason } from '../../src/monitor/scheduler.js';

describe('html templates', () => {
  it('escapes interpolated text, including attributes', () => {
    const name = '<script>alert(1)</script>" onmouseover="x';
    expect(html`<p title="${name}">${name}</p>`.value).toBe(
      '<p title="&lt;script&gt;alert(1)&lt;/script&gt;&quot; onmouseover=&quot;x">&lt;script&gt;alert(1)&lt;/script&gt;&quot; onmouseover=&quot;x</p>',
    );
    expect(escapeHtml("it's & <b>")).toBe('it&#39;s &amp; &lt;b&gt;');
  });

  it('nests fragments and arrays without double escaping', () => {
    const items = ['a&b', 'c'].map((x) => html`<li>${x}</li>`);
    expect(html`<ul>${items}</ul>`.value).toBe('<ul><li>a&amp;b</li><li>c</li></ul>');
    expect(html`${null}${undefined}${false}${0}`.value).toBe('0');
  });
});

describe('monitor form', () => {
  it('accepts the defaults with a name and URL, deriving the identifier', () => {
    const { input, errors } = parseMonitorForm(
      { ...DEFAULT_FORM, name: 'Orders API', url: 'http://demo-api:8080/api' },
      30,
    );
    expect(errors).toEqual({});
    expect(input.slug).toBe('orders-api');
    expect(input.isPublic).toBe(true);
  });

  it('reports every problem at once', () => {
    const { errors } = parseMonitorForm(
      {
        ...DEFAULT_FORM,
        name: '',
        url: '',
        intervalS: '5',
        timeoutMs: '99999',
        expectedMin: '300',
        expectedMax: '200',
        method: 'HEAD',
        keyword: 'x',
      },
      30,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ['expectedMax', 'keyword', 'name', 'slug', 'timeoutMs', 'url', 'intervalS'].sort(),
    );
  });

  it('requires the timeout to be shorter than the interval', () => {
    const { errors } = parseMonitorForm(
      { ...DEFAULT_FORM, name: 'x', url: 'http://a/', intervalS: '30', timeoutMs: '30000' },
      30,
    );
    expect(errors.timeoutMs).toMatch(/shorter than the interval/);
  });

  it('slugifies names', () => {
    expect(slugify('  Sign-in  Service (EU)! ')).toBe('sign-in-service-eu');
  });
});

describe('status summary', () => {
  const m = (state: Monitor['state'], isPaused = false) => ({ state, isPaused }) as Monitor;
  it.each([
    [[m('up'), m('up')], 'All systems operational'],
    [[m('up'), m('degraded')], 'Degraded performance'],
    [[m('up'), m('up'), m('down')], 'Partial outage'],
    [[m('down'), m('down'), m('up')], 'Major outage'],
    [[m('up'), m('down', true)], 'All systems operational'],
    [[m('unknown')], 'Waiting for the first checks'],
  ])('%#', (monitors, text) => {
    expect(overallStatus(monitors, []).text).toBe(text);
  });
});

describe('metrics exposition', () => {
  it('renders counters, histograms and gauges in Prometheus text format', () => {
    const metrics = createMetrics();
    metrics.inc('signalpost_checks_total', { monitor: 'a', result: 'ok' });
    metrics.inc('signalpost_checks_total', { monitor: 'a', result: 'ok' });
    metrics.observe('signalpost_check_duration_seconds', { monitor: 'a' }, 0.3);
    const text = metrics.render([
      { name: 'g', help: 'a gauge', samples: [{ labels: { x: 'q"uote' }, value: 2 }] },
    ]);
    expect(text).toContain('# TYPE signalpost_checks_total counter');
    expect(text).toContain('signalpost_checks_total{monitor="a",result="ok"} 2');
    expect(text).toContain('signalpost_check_duration_seconds_bucket{monitor="a",le="0.25"} 0');
    expect(text).toContain('signalpost_check_duration_seconds_bucket{monitor="a",le="0.5"} 1');
    expect(text).toContain('signalpost_check_duration_seconds_bucket{monitor="a",le="+Inf"} 1');
    expect(text).toContain('g{x="q\\"uote"} 2');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('time helpers', () => {
  it('lists calendar days across a DST change without gaps or repeats', () => {
    // Israel moved clocks back on 25 Oct 2026.
    const days = lastDays(Date.parse('2026-10-27T10:00:00Z'), 4, 'Asia/Jerusalem');
    expect(days).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(dayOf(Date.parse('2026-10-03T22:30:00Z'), 'Asia/Jerusalem')).toBe('2026-10-04');
  });

  it('formats durations', () => {
    expect([30_000, 23 * 60_000, 125 * 60_000, 5 * 86_400_000].map(formatDuration)).toEqual([
      '30 s',
      '23 min',
      '2 h 5 min',
      '5 days',
    ]);
  });
});

describe('public failure text', () => {
  it('never carries hosts, addresses or raw error strings', () => {
    const kinds = [
      'blocked',
      'dns',
      'timeout',
      'connect',
      'tls',
      'status',
      'redirect',
      'keyword',
      null,
    ] as const;
    for (const errorKind of kinds) {
      const text = publicReason({
        ok: false,
        statusCode: 503,
        latencyMs: null,
        errorKind,
        errorDetail: '"db.internal" resolves to 10.0.0.5',
      });
      expect(text).not.toMatch(/internal|10\.0\.0\.5|resolves/);
    }
    expect(
      publicReason({
        ok: false,
        statusCode: 503,
        latencyMs: 10,
        errorKind: 'status',
        errorDetail: 'HTTP 503',
      }),
    ).toBe('the service answered with HTTP 503');
  });
});

describe('webhook signature', () => {
  it('signs timestamp and body', () => {
    expect(sign('k'.repeat(32), '1700000000', '{"a":1}')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sign('k'.repeat(32), '1700000000', '{"a":1}')).not.toBe(
      sign('k'.repeat(32), '1700000001', '{"a":1}'),
    );
  });
});
