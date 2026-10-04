/** Calendar helpers in the configured time zone (status page days, report times). */

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** 'YYYY-MM-DD' of an instant in `timeZone`. */
export function dayOf(ms: number, timeZone: string): string {
  let f = dayFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormats.set(timeZone, f);
  }
  return f.format(new Date(ms));
}

/** The `count` days ending with today, oldest first. */
export function lastDays(nowMs: number, count: number, timeZone: string): string[] {
  const days: string[] = [];
  const seen = new Set<string>();
  // Step back in 24 h increments from noon UTC of today; a DST change never skips or repeats a calendar day
  // because the label comes from the zone, and duplicates are dropped.
  for (let i = 0; days.length < count && i < count + 3; i++) {
    const d = dayOf(nowMs - i * 86_400_000, timeZone);
    if (!seen.has(d)) {
      seen.add(d);
      days.unshift(d);
    }
  }
  return days;
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

export function formatTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function formatClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms));
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}
