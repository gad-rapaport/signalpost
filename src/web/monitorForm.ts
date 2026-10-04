import type { MonitorInput } from '../monitor/repo.js';

export type FormValues = Record<string, string>;
export type FormErrors = Partial<Record<string, string>>;

export const DEFAULT_FORM: FormValues = {
  name: '',
  slug: '',
  url: '',
  method: 'GET',
  intervalS: '60',
  timeoutMs: '5000',
  expectedMin: '200',
  expectedMax: '299',
  keyword: '',
  degradedMs: '1000',
  failThreshold: '2',
  recoverThreshold: '2',
  sortOrder: '0',
  isPublic: 'on',
  isPaused: '',
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function int(
  v: string | undefined,
  min: number,
  max: number,
  label: string,
  errors: FormErrors,
  key: string,
): number {
  const n = Number((v ?? '').trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    errors[key] = `${label} must be a whole number from ${min} to ${max}.`;
    return min;
  }
  return n;
}

/** Validates the submitted form. Network policy checks run separately (they need DNS). */
export function parseMonitorForm(
  body: FormValues,
  minIntervalS: number,
): { input: MonitorInput; errors: FormErrors } {
  const errors: FormErrors = {};
  const name = (body.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60) errors.name = 'Give the monitor a name of up to 60 characters.';
  const slug = (body.slug ?? '').trim() || slugify(name);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug))
    errors.slug = 'Use 1-40 lowercase letters, digits and dashes.';
  const url = (body.url ?? '').trim();
  if (!url || url.length > 500) errors.url = 'Enter the URL to check (up to 500 characters).';
  const method = body.method === 'HEAD' ? 'HEAD' : 'GET';
  const intervalS = int(body.intervalS, minIntervalS, 86_400, 'Interval', errors, 'intervalS');
  const timeoutMs = int(body.timeoutMs, 500, 30_000, 'Timeout', errors, 'timeoutMs');
  if (!errors.timeoutMs && !errors.intervalS && timeoutMs >= intervalS * 1000)
    errors.timeoutMs = 'The timeout must be shorter than the interval.';
  const expectedMin = int(body.expectedMin, 100, 599, 'Lowest expected status', errors, 'expectedMin');
  const expectedMax = int(body.expectedMax, 100, 599, 'Highest expected status', errors, 'expectedMax');
  if (!errors.expectedMin && !errors.expectedMax && expectedMax < expectedMin)
    errors.expectedMax = 'Must not be lower than the lowest expected status.';
  const keyword = (body.keyword ?? '').trim();
  if (keyword.length > 100) errors.keyword = 'Keep the keyword under 100 characters.';
  if (keyword && method === 'HEAD')
    errors.keyword = 'HEAD requests have no body; use GET to look for a keyword.';
  const degradedMs = int(body.degradedMs, 50, 30_000, 'Slow threshold', errors, 'degradedMs');
  const failThreshold = int(
    body.failThreshold,
    1,
    10,
    'Failures before an incident',
    errors,
    'failThreshold',
  );
  const recoverThreshold = int(
    body.recoverThreshold,
    1,
    10,
    'Successes before recovery',
    errors,
    'recoverThreshold',
  );
  const sortOrder = int(body.sortOrder, 0, 999, 'Order', errors, 'sortOrder');
  return {
    input: {
      slug,
      name,
      url,
      method,
      intervalS,
      timeoutMs,
      expectedMin,
      expectedMax,
      keyword: keyword || null,
      degradedMs,
      failThreshold,
      recoverThreshold,
      isPublic: body.isPublic === 'on',
      isPaused: body.isPaused === 'on',
      sortOrder,
    },
    errors,
  };
}

export function formFromMonitor(m: MonitorInput): FormValues {
  return {
    name: m.name,
    slug: m.slug,
    url: m.url,
    method: m.method,
    intervalS: String(m.intervalS),
    timeoutMs: String(m.timeoutMs),
    expectedMin: String(m.expectedMin),
    expectedMax: String(m.expectedMax),
    keyword: m.keyword ?? '',
    degradedMs: String(m.degradedMs),
    failThreshold: String(m.failThreshold),
    recoverThreshold: String(m.recoverThreshold),
    sortOrder: String(m.sortOrder),
    isPublic: m.isPublic ? 'on' : '',
    isPaused: m.isPaused ? 'on' : '',
  };
}
