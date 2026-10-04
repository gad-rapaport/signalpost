import type { Db } from '../db/db.js';
import { openIncidents, recentIncidents, type Incident } from '../monitor/incidents.js';
import { dailyStats, listMonitors, type Monitor } from '../monitor/repo.js';
import { formatDay, formatDuration, formatTime, lastDays } from '../time.js';
import { html, type Html } from './html.js';
import { publicPage, stateBadge, type Tone } from './layout.js';

const DAYS = 30;

export type Overall = { tone: Tone; text: string };

export function overallStatus(monitors: Monitor[], incidents: Incident[]): Overall {
  const active = monitors.filter((m) => !m.isPaused);
  const down = active.filter((m) => m.state === 'down').length;
  const degraded = active.filter((m) => m.state === 'degraded').length;
  const maintenance = incidents.some((i) => i.impact === 'maintenance' && i.resolvedAt === null);
  if (down > 0 && down >= Math.ceil(active.length / 2)) return { tone: 'down', text: 'Major outage' };
  if (down > 0) return { tone: 'down', text: 'Partial outage' };
  if (degraded > 0 || incidents.some((i) => i.impact === 'degraded' && i.resolvedAt === null)) {
    return { tone: 'degraded', text: 'Degraded performance' };
  }
  if (maintenance) return { tone: 'maintenance', text: 'Maintenance in progress' };
  if (active.length > 0 && active.every((m) => m.state === 'unknown'))
    return { tone: 'unknown', text: 'Waiting for the first checks' };
  return { tone: 'up', text: 'All systems operational' };
}

export function stateTone(m: Monitor): { tone: Tone; label: string } {
  if (m.isPaused) return { tone: 'paused', label: 'Paused' };
  switch (m.state) {
    case 'up':
      return { tone: 'up', label: 'Operational' };
    case 'degraded':
      return { tone: 'degraded', label: 'Degraded' };
    case 'down':
      return { tone: 'down', label: 'Outage' };
    default:
      return { tone: 'unknown', label: 'No data yet' };
  }
}

function dayTone(ok: number, total: number, slow: number): { cls: string; text: string } {
  if (total === 0) return { cls: 'none', text: 'no data' };
  const ratio = ok / total;
  const pct = `${(ratio * 100).toFixed(ratio === 1 ? 0 : 2)}% up`;
  if (ratio < 0.95) return { cls: 'down', text: pct };
  if (ratio < 0.999 || slow / total > 0.2)
    return { cls: 'degraded', text: `${pct}${slow ? `, ${slow} slow checks` : ''}` };
  return { cls: 'up', text: pct };
}

function incidentBlock(i: Incident, timeZone: string, now: number): Html {
  const tone: Tone = i.resolvedAt
    ? 'up'
    : i.impact === 'outage'
      ? 'down'
      : i.impact === 'degraded'
        ? 'degraded'
        : 'maintenance';
  const label = i.resolvedAt ? 'Resolved' : i.status.charAt(0).toUpperCase() + i.status.slice(1);
  return html`<article class="incident">
    <header class="incident__head">
      <h3>${i.title}</h3>
      ${stateBadge(tone, label)}
    </header>
    <p class="muted">
      ${i.monitorName ? html`${i.monitorName} · ` : ''}Started
      ${formatTime(i.startedAt, timeZone)}${
        i.resolvedAt
          ? html` · lasted ${formatDuration(i.resolvedAt - i.startedAt)}`
          : html` · ongoing for ${formatDuration(now - i.startedAt)}`
      }${i.synthetic ? ' · demo history' : ''}
    </p>
    <ol class="timeline">
      ${i.updates.map(
        (u) =>
          html`<li>
            <strong>${u.status.charAt(0).toUpperCase() + u.status.slice(1)}</strong>
            <time datetime="${new Date(u.at).toISOString()}">${formatTime(u.at, timeZone)}</time>
            <p>${u.body}</p>
          </li>`,
      )}
    </ol>
  </article>`;
}

export function renderStatusPage(db: Db, opts: { title: string; timeZone: string; now?: number }): Html {
  const now = opts.now ?? Date.now();
  const monitors = listMonitors(db, { publicOnly: true });
  const open = openIncidents(db).filter((i) => i.monitorPublic);
  const past = recentIncidents(db, now - 14 * 86_400_000).filter((i) => i.monitorPublic);
  const overall = overallStatus(monitors, open);
  const days = lastDays(now, DAYS, opts.timeZone);
  let anySynthetic = false;

  const components = monitors.map((m) => {
    const stats = dailyStats(db, m.id, days[0]!);
    let total = 0;
    let ok = 0;
    const bars = days.map((d) => {
      const s = stats.get(d);
      if (s?.synthetic) anySynthetic = true;
      total += s?.total ?? 0;
      ok += s?.ok ?? 0;
      const t = dayTone(s?.ok ?? 0, s?.total ?? 0, s?.slow ?? 0);
      return html`<li class="bar bar--${t.cls}" title="${formatDay(d)}: ${t.text}">
        <span class="visually-hidden">${formatDay(d)}: ${t.text}</span>
      </li>`;
    });
    const st = stateTone(m);
    const uptime = total ? `${((ok / total) * 100).toFixed(2)}%` : 'n/a';
    return html`<li class="component">
      <div class="component__head">
        <h3>${m.name}</h3>
        ${stateBadge(st.tone, st.label)}
      </div>
      <ol class="bars" aria-label="${m.name}, daily uptime for the last ${DAYS} days">
        ${bars}
      </ol>
      <p class="component__foot muted">
        <span>${DAYS} days ago</span><span>${uptime} uptime</span><span>Today</span>
      </p>
    </li>`;
  });

  return publicPage(
    'Status',
    opts.title,
    html`<section class="overall overall--${overall.tone}" aria-labelledby="overall">
        <h1 id="overall">${stateBadge(overall.tone, overall.text)}</h1>
        <p class="muted">Updated ${formatTime(now, opts.timeZone)}. Reload for the latest state.</p>
      </section>
      ${
        open.length
          ? html`<section aria-labelledby="active">
              <h2 id="active">Active incidents</h2>
              ${open.map((i) => incidentBlock(i, opts.timeZone, now))}
            </section>`
          : ''
      }
      <section aria-labelledby="components">
        <h2 id="components">Services</h2>
        ${
          monitors.length
            ? html`<ul class="components">
                ${components}
              </ul>`
            : html`<p class="muted">No public services yet.</p>`
        }
        ${
          anySynthetic
            ? html`<p class="note">
                Some earlier days are generated demo history, marked as such in the database; recent days come
                from real checks.
              </p>`
            : ''
        }
      </section>
      <section aria-labelledby="history">
        <h2 id="history">Past incidents (14 days)</h2>
        ${past.length ? past.map((i) => incidentBlock(i, opts.timeZone, now)) : html`<p class="muted">No incidents in the last 14 days.</p>`}
      </section>`,
  );
}
