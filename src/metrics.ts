/**
 * Minimal Prometheus text exposition (format 0.0.4). Counters and one histogram live in memory for the life
 * of the process; gauges are read from the database at scrape time, so they are always current.
 */
const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Labels = Record<string, string>;

function labelText(labels: Labels): string {
  const parts = Object.entries(labels).map(
    ([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
  );
  return parts.length ? `{${parts.join(',')}}` : '';
}

export class Metrics {
  private counters = new Map<string, Map<string, { labels: Labels; value: number }>>();
  private histograms = new Map<
    string,
    Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>
  >();
  private help = new Map<string, string>();

  describe(name: string, help: string): void {
    this.help.set(name, help);
  }

  inc(name: string, labels: Labels = {}, by = 1): void {
    const key = labelText(labels);
    let series = this.counters.get(name);
    if (!series) this.counters.set(name, (series = new Map()));
    const entry = series.get(key) ?? { labels, value: 0 };
    entry.value += by;
    series.set(key, entry);
  }

  observe(name: string, labels: Labels, seconds: number): void {
    let series = this.histograms.get(name);
    if (!series) this.histograms.set(name, (series = new Map()));
    const key = labelText(labels);
    let h = series.get(key);
    if (!h) series.set(key, (h = { labels, buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) h.buckets[i]! += 1;
    });
    h.sum += seconds;
    h.count += 1;
  }

  counterValue(name: string, labels: Labels = {}): number {
    return this.counters.get(name)?.get(labelText(labels))?.value ?? 0;
  }

  render(gauges: { name: string; help: string; samples: { labels?: Labels; value: number }[] }[]): string {
    const out: string[] = [];
    for (const [name, series] of this.counters) {
      out.push(`# HELP ${name} ${this.help.get(name) ?? name}`, `# TYPE ${name} counter`);
      for (const { labels, value } of series.values()) out.push(`${name}${labelText(labels)} ${value}`);
    }
    for (const [name, series] of this.histograms) {
      out.push(`# HELP ${name} ${this.help.get(name) ?? name}`, `# TYPE ${name} histogram`);
      for (const h of series.values()) {
        BUCKETS.forEach((b, i) =>
          out.push(`${name}_bucket${labelText({ ...h.labels, le: String(b) })} ${h.buckets[i]}`),
        );
        out.push(`${name}_bucket${labelText({ ...h.labels, le: '+Inf' })} ${h.count}`);
        out.push(
          `${name}_sum${labelText(h.labels)} ${h.sum.toFixed(6)}`,
          `${name}_count${labelText(h.labels)} ${h.count}`,
        );
      }
    }
    for (const g of gauges) {
      out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
      for (const s of g.samples)
        out.push(`${g.name}${labelText(s.labels ?? {})} ${Number.isFinite(s.value) ? s.value : 0}`);
    }
    return out.join('\n') + '\n';
  }
}

export function createMetrics(): Metrics {
  const m = new Metrics();
  m.describe('signalpost_checks_total', 'Checks run, by monitor and result');
  m.describe('signalpost_check_duration_seconds', 'Time to first response byte of successful checks');
  m.describe(
    'signalpost_policy_blocked_total',
    'Checks and webhook deliveries refused by the outbound policy',
  );
  m.describe('signalpost_incidents_opened_total', 'Automatic incidents opened');
  m.describe('signalpost_webhook_deliveries_total', 'Webhook delivery attempts, by result');
  m.describe('signalpost_retention_deleted_rows_total', 'Rows removed by retention, by table');
  return m;
}
