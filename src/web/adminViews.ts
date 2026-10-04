import type { Incident } from '../monitor/incidents.js';
import type { CheckRow, Monitor } from '../monitor/repo.js';
import { formatClock, formatDuration, formatTime } from '../time.js';
import { html, type Html } from './html.js';
import { stateBadge } from './layout.js';
import type { FormErrors, FormValues } from './monitorForm.js';
import { stateTone } from './statusPage.js';

const csrfField = (csrf: string) => html`<input type="hidden" name="_csrf" value="${csrf}" />`;

function actionButton(action: string, label: string, csrf: string, cls = 'btn btn--quiet'): Html {
  return html`<form method="post" action="${action}" class="inline">
    ${csrfField(csrf)}<button type="submit" class="${cls}">${label}</button>
  </form>`;
}

export function overviewView(
  monitors: (Monitor & { uptime24h: number | null })[],
  openCount: number,
  csrf: string,
  timeZone: string,
  now: number,
): Html {
  return html`<div class="pagehead">
      <h1>Monitors</h1>
      <a class="btn btn--primary" href="/admin/monitors/new">Add monitor</a>
    </div>
    <p class="muted">
      ${monitors.length} monitors · ${monitors.filter((m) => m.state === 'down').length} down · ${openCount}
      open incident${openCount === 1 ? '' : 's'} · page rendered ${formatClock(now, timeZone)}
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Monitors">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">Monitor</th>
            <th scope="col">State</th>
            <th scope="col" class="num">Latency</th>
            <th scope="col" class="num">Uptime 24 h</th>
            <th scope="col">Last check</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${monitors.map((m) => {
            const st = stateTone(m);
            return html`<tr>
              <th scope="row">
                <a href="/admin/monitors/${m.id}">${m.name}</a>
                <span class="mono small block">${m.method} ${m.url}</span>
                ${m.isPublic ? '' : html`<span class="tag">Private</span>`}
              </th>
              <td>
                ${stateBadge(st.tone, st.label)}
                ${m.stateSince && !m.isPaused ? html`<span class="small muted block">for ${formatDuration(now - m.stateSince)}</span>` : ''}
              </td>
              <td class="num mono">${m.lastLatencyMs !== null ? `${m.lastLatencyMs} ms` : '-'}</td>
              <td class="num mono">${m.uptime24h === null ? '-' : `${(m.uptime24h * 100).toFixed(2)}%`}</td>
              <td>
                ${m.lastCheckedAt ? formatClock(m.lastCheckedAt, timeZone) : 'never'}
                ${m.lastError ? html`<span class="small error-text block">${m.lastError}</span>` : ''}
              </td>
              <td class="actions">
                ${actionButton(`/admin/monitors/${m.id}/check`, 'Check now', csrf)}
                ${m.isPaused ? actionButton(`/admin/monitors/${m.id}/resume`, 'Resume', csrf) : actionButton(`/admin/monitors/${m.id}/pause`, 'Pause', csrf)}
                <a class="btn btn--quiet" href="/admin/monitors/${m.id}/edit"
                  >Edit<span class="visually-hidden"> ${m.name}</span></a
                >
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

function field(
  name: string,
  label: string,
  values: FormValues,
  errors: FormErrors,
  opts: { type?: string; hint?: string; inputmode?: string; mono?: boolean } = {},
): Html {
  const id = `f-${name}`;
  const err = errors[name];
  const described = [opts.hint ? `${id}-hint` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ');
  return html`<div class="field ${err ? 'field--error' : ''}">
    <label for="${id}">${label}</label>
    ${opts.hint ? html`<p class="hint" id="${id}-hint">${opts.hint}</p>` : ''}
    <input
      id="${id}"
      name="${name}"
      type="${opts.type ?? 'text'}"
      value="${values[name] ?? ''}"
      class="${opts.mono ? 'mono' : ''}"
      ${opts.inputmode ? html`inputmode="${opts.inputmode}"` : ''}
      ${described ? html`aria-describedby="${described}"` : ''}
      ${err ? html`aria-invalid="true"` : ''}
    />
    ${err ? html`<p class="error-text" id="${id}-err">${err}</p>` : ''}
  </div>`;
}

export function monitorFormView(
  mode: { kind: 'new' } | { kind: 'edit'; id: number },
  values: FormValues,
  errors: FormErrors,
  csrf: string,
  policyNote: Html,
): Html {
  const action = mode.kind === 'new' ? '/admin/monitors' : `/admin/monitors/${mode.id}`;
  const keys = Object.keys(errors);
  const num = { inputmode: 'numeric' };
  return html`<div class="pagehead"><h1>${mode.kind === 'new' ? 'Add monitor' : 'Edit monitor'}</h1></div>
    ${
      keys.length
        ? html`<div class="error-box" role="alert" tabindex="-1" id="errors">
            <p><strong>Check ${keys.length === 1 ? 'this field' : `these ${keys.length} fields`}:</strong></p>
            <ul>
              ${keys.map((k) => html`<li><a href="#f-${k}">${errors[k]}</a></li>`)}
            </ul>
          </div>`
        : ''
    }
    <form method="post" action="${action}" class="form" novalidate>
      ${csrfField(csrf)}
      <fieldset>
        <legend>What to check</legend>
        ${field('name', 'Name', values, errors, { hint: 'Shown on the status page.' })}
        ${field('url', 'URL', values, errors, { type: 'url', mono: true, hint: 'http or https, on the outbound allowlist. Redirects are not followed.' })}
        ${policyNote}
        <div class="field">
          <label for="f-method">Method</label>
          <select id="f-method" name="method">
            <option value="GET" ${values.method !== 'HEAD' ? html`selected` : ''}>GET</option>
            <option value="HEAD" ${values.method === 'HEAD' ? html`selected` : ''}>HEAD</option>
          </select>
        </div>
        ${field('keyword', 'Keyword (optional)', values, errors, { hint: 'The check fails if this text is missing from the first 64 KB.' })}
      </fieldset>
      <fieldset>
        <legend>Timing and thresholds</legend>
        <div class="grid-fields">
          ${field('intervalS', 'Interval (seconds)', values, errors, num)}
          ${field('timeoutMs', 'Timeout (ms)', values, errors, num)}
          ${field('expectedMin', 'Lowest expected status', values, errors, num)}
          ${field('expectedMax', 'Highest expected status', values, errors, num)}
          ${field('degradedMs', 'Slow above (ms)', values, errors, num)}
          ${field('failThreshold', 'Failures before an incident', values, errors, num)}
          ${field('recoverThreshold', 'Successes before recovery', values, errors, num)}
          ${field('sortOrder', 'Order on the status page', values, errors, num)}
        </div>
      </fieldset>
      <fieldset>
        <legend>Visibility</legend>
        ${field('slug', 'Identifier', values, errors, { mono: true, hint: 'Used in metrics labels. Leave empty to derive it from the name.' })}
        <label class="check"
          ><input type="checkbox" name="isPublic" ${values.isPublic === 'on' ? html`checked` : ''} /> Show on
          the public status page</label
        >
        <label class="check"
          ><input type="checkbox" name="isPaused" ${values.isPaused === 'on' ? html`checked` : ''} />
          Paused</label
        >
      </fieldset>
      <div class="form__actions">
        <button type="submit" class="btn btn--primary">
          ${mode.kind === 'new' ? 'Add monitor' : 'Save changes'}
        </button>
        <a class="btn btn--quiet" href="${mode.kind === 'new' ? '/admin' : `/admin/monitors/${mode.id}`}"
          >Cancel</a
        >
        ${mode.kind === 'edit' ? html`<a class="btn btn--danger" href="/admin/monitors/${mode.id}/delete">Delete…</a>` : ''}
      </div>
    </form>`;
}

/** Latency of recent checks as a small inline SVG chart with a text summary. */
function latencyChart(checks: CheckRow[]): Html {
  const points = [...checks].reverse().filter((c) => c.latencyMs !== null);
  if (points.length < 2) return html`<p class="muted">Not enough checks for a chart yet.</p>`;
  const w = 640;
  const h = 120;
  const max = Math.max(...points.map((p) => p.latencyMs!), 1);
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4;
  const y = (v: number) => h - 8 - (v / max) * (h - 20);
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.latencyMs!).toFixed(1)}`)
    .join(' ');
  const sorted = points.map((p) => p.latencyMs!).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  return html`<figure class="latency">
    <svg
      viewBox="0 0 ${w} ${h}"
      role="img"
      aria-label="Latency of the last ${points.length} checks: median ${p50} ms, 95th percentile ${p95} ms, highest ${max} ms"
    >
      <line x1="0" x2="${w}" y1="${h - 8}" y2="${h - 8}" class="latency__axis" />
      <path d="${d}" class="latency__line" />
      ${points.map((p, i) => (p.ok ? '' : html`<circle cx="${x(i).toFixed(1)}" cy="${(h - 8).toFixed(1)}" r="4" class="latency__fail" />`))}
    </svg>
    <figcaption class="muted">
      Last ${points.length} checks · median ${p50} ms · p95 ${p95} ms · highest ${max} ms${
        points.some((p) => !p.ok) ? ' · red marks are failed checks' : ''
      }
    </figcaption>
  </figure>`;
}

export function monitorDetailView(
  m: Monitor,
  checks: CheckRow[],
  csrf: string,
  timeZone: string,
  now: number,
): Html {
  const st = stateTone(m);
  return html`<div class="pagehead">
      <h1>${m.name}</h1>
      <div class="pagehead__actions">
        ${actionButton(`/admin/monitors/${m.id}/check`, 'Check now', csrf)}
        <a class="btn" href="/admin/monitors/${m.id}/edit">Edit</a>
      </div>
    </div>
    <dl class="facts">
      <div>
        <dt>State</dt>
        <dd>
          ${stateBadge(st.tone, st.label)}${m.stateSince ? html` <span class="muted">for ${formatDuration(now - m.stateSince)}</span>` : ''}
        </dd>
      </div>
      <div>
        <dt>Target</dt>
        <dd class="mono">${m.method} ${m.url}</dd>
      </div>
      <div>
        <dt>Expect</dt>
        <dd>
          HTTP ${m.expectedMin}-${m.expectedMax}${m.keyword ? html`, containing <q>${m.keyword}</q>` : ''}
        </dd>
      </div>
      <div>
        <dt>Schedule</dt>
        <dd>every ${m.intervalS} s, timeout ${m.timeoutMs} ms, slow above ${m.degradedMs} ms</dd>
      </div>
      <div>
        <dt>Incident after</dt>
        <dd>${m.failThreshold} failed checks; resolved after ${m.recoverThreshold} good checks</dd>
      </div>
    </dl>
    <h2>Latency</h2>
    ${latencyChart(checks)}
    <h2>Recent checks</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Recent checks">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Result</th>
            <th scope="col" class="num">Status</th>
            <th scope="col" class="num">Latency</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          ${checks.map(
            (c) =>
              html`<tr>
                <td>${formatClock(c.at, timeZone)}</td>
                <td>
                  ${c.ok ? (c.slow ? stateBadge('degraded', 'Slow') : stateBadge('up', 'OK')) : stateBadge('down', c.errorKind ?? 'Failed')}
                </td>
                <td class="num mono">${c.statusCode ?? '-'}</td>
                <td class="num mono">${c.latencyMs !== null ? `${c.latencyMs} ms` : '-'}</td>
                <td class="small">${c.errorDetail ?? ''}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

export function deleteView(m: Monitor, csrf: string): Html {
  return html`<div class="pagehead"><h1>Delete ${m.name}?</h1></div>
    <p>
      This deletes the monitor, its checks and its uptime history. Incidents stay, without the link to this
      monitor.
    </p>
    <div class="form__actions">
      ${actionButton(`/admin/monitors/${m.id}/delete`, 'Delete monitor', csrf, 'btn btn--danger')}
      <a class="btn btn--quiet" href="/admin/monitors/${m.id}">Cancel</a>
    </div>`;
}

const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

export function incidentsView(incidents: Incident[], timeZone: string, now: number): Html {
  return html`<div class="pagehead">
      <h1>Incidents</h1>
      <a class="btn btn--primary" href="/admin/incidents/new">Post an incident</a>
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Incidents">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">Incident</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          ${incidents.map(
            (i) =>
              html`<tr>
                <th scope="row">
                  <a href="/admin/incidents/${i.id}">${i.title}</a>
                  <span class="small muted block"
                    >${i.isAuto ? 'Automatic' : 'Posted by hand'} ·
                    ${i.impact}${i.monitorName ? ` · ${i.monitorName}` : ''}${i.synthetic ? ' · demo history' : ''}</span
                  >
                </th>
                <td>
                  ${stateBadge(i.resolvedAt ? 'up' : i.impact === 'outage' ? 'down' : i.impact === 'degraded' ? 'degraded' : 'maintenance', i.status)}
                </td>
                <td>${formatTime(i.startedAt, timeZone)}</td>
                <td>
                  ${formatDuration((i.resolvedAt ?? now) - i.startedAt)}${i.resolvedAt ? '' : ' so far'}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

function statusSelect(current: string): Html {
  return html`<div class="field">
    <label for="f-status">Status</label>
    <select id="f-status" name="status">
      ${STATUSES.map((s) => html`<option value="${s}" ${s === current ? html`selected` : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)}
    </select>
  </div>`;
}

export function newIncidentView(
  monitors: Monitor[],
  csrf: string,
  error: string | null,
  values: FormValues,
): Html {
  return html`<div class="pagehead"><h1>Post an incident</h1></div>
    ${error ? html`<p class="error-box" role="alert">${error}</p>` : ''}
    <form method="post" action="/admin/incidents" class="form">
      ${csrfField(csrf)}
      <div class="field">
        <label for="f-title">Title</label
        ><input id="f-title" name="title" value="${values.title ?? ''}" maxlength="120" required />
      </div>
      <div class="field">
        <label for="f-monitor">Affected service</label>
        <select id="f-monitor" name="monitorId">
          <option value="">None (general announcement)</option>
          ${monitors.map((m) => html`<option value="${m.id}" ${values.monitorId === String(m.id) ? html`selected` : ''}>${m.name}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="f-impact">Impact</label>
        <select id="f-impact" name="impact">
          ${(['outage', 'degraded', 'maintenance'] as const).map(
            (i) =>
              html`<option value="${i}" ${values.impact === i ? html`selected` : ''}>
                ${i.charAt(0).toUpperCase() + i.slice(1)}
              </option>`,
          )}
        </select>
      </div>
      ${statusSelect(values.status ?? 'investigating')}
      <div class="field">
        <label for="f-body">Message</label
        ><textarea id="f-body" name="body" rows="4" maxlength="2000" required>${values.body ?? ''}</textarea>
      </div>
      <div class="form__actions">
        <button type="submit" class="btn btn--primary">Post</button
        ><a class="btn btn--quiet" href="/admin/incidents">Cancel</a>
      </div>
    </form>`;
}

export function incidentDetailView(i: Incident, csrf: string, timeZone: string, error: string | null): Html {
  return html`<div class="pagehead"><h1>${i.title}</h1></div>
    <p class="muted">
      ${i.isAuto ? 'Opened automatically' : 'Posted by hand'} · ${i.impact} · started
      ${formatTime(i.startedAt, timeZone)}${i.resolvedAt ? ` · resolved ${formatTime(i.resolvedAt, timeZone)}` : ''}
    </p>
    <h2>Post an update</h2>
    ${error ? html`<p class="error-box" role="alert">${error}</p>` : ''}
    <form method="post" action="/admin/incidents/${i.id}/updates" class="form">
      ${csrfField(csrf)} ${statusSelect(i.status)}
      <div class="field">
        <label for="f-body">Message</label
        ><textarea id="f-body" name="body" rows="3" maxlength="2000" required></textarea>
      </div>
      <div class="form__actions"><button type="submit" class="btn btn--primary">Post update</button></div>
    </form>
    <h2>Timeline</h2>
    <ol class="timeline">
      ${i.updates.map(
        (u) =>
          html`<li>
            <strong>${u.status}</strong>
            <time datetime="${new Date(u.at).toISOString()}">${formatTime(u.at, timeZone)}</time>
            <span class="muted">by ${u.author}</span>
            <p>${u.body}</p>
          </li>`,
      )}
    </ol>`;
}

export interface SettingsInfo {
  allowedHosts: string[];
  allowPrivateHosts: string[];
  allowedPorts: number[];
  retentionDays: number;
  minIntervalS: number;
  maxConcurrent: number;
  metricsEnabled: boolean;
  webhookUrl: string | null;
  deliveries: {
    event: string;
    at: number;
    attempt: number;
    ok: number;
    statusCode: number | null;
    error: string | null;
  }[];
  dbBytes: number;
  timeZone: string;
}

export function settingsView(s: SettingsInfo): Html {
  const list = (items: (string | number)[]) =>
    items.length
      ? html`<ul class="chips">
          ${items.map((x) => html`<li class="mono">${String(x)}</li>`)}
        </ul>`
      : html`<p class="muted">None</p>`;
  return html`<div class="pagehead"><h1>Settings</h1></div>
    <p class="muted">
      Read-only. These come from the server's environment and change only with a redeploy, so a stolen admin
      session cannot widen them.
    </p>
    <section class="panel">
      <h2>Outbound policy</h2>
      <h3>Allowed hosts (ALLOWED_HOSTS)</h3>
      ${list(s.allowedHosts)}
      <h3>Hosts that may resolve to private addresses (ALLOW_PRIVATE_HOSTS)</h3>
      ${list(s.allowPrivateHosts)}
      <h3>Allowed ports</h3>
      ${list(s.allowedPorts)}
      <p>
        Every check resolves the host again, rejects loopback, link-local (including cloud metadata),
        multicast and reserved addresses, connects to the address it checked, never follows redirects and
        reads at most 64 KB.
      </p>
    </section>
    <section class="panel">
      <h2>Data</h2>
      <p>
        Raw checks are kept for ${s.retentionDays} days; daily uptime for 400 days; incidents are kept.
        Database size ${(s.dbBytes / 1024 / 1024).toFixed(1)} MB. Time zone ${s.timeZone}.
      </p>
      <p>Scheduler: at most ${s.maxConcurrent} checks at once, minimum interval ${s.minIntervalS} s.</p>
    </section>
    <section class="panel">
      <h2>Integrations</h2>
      <p>
        Metrics endpoint:
        ${s.metricsEnabled ? html`<strong>enabled</strong> at <span class="mono">/metrics</span> (bearer token)` : html`<strong>disabled</strong> (set METRICS_TOKEN)`}
      </p>
      <p>
        Webhook:
        ${s.webhookUrl ? html`<strong>enabled</strong>, <span class="mono">${s.webhookUrl}</span>` : html`<strong>disabled</strong> (set WEBHOOK_URL and WEBHOOK_SECRET)`}
      </p>
      ${
        s.deliveries.length
          ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Recent webhook deliveries">
              <table class="grid">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Event</th>
                    <th scope="col">Attempt</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  ${s.deliveries.map(
                    (d) =>
                      html`<tr>
                        <td>${formatTime(d.at, s.timeZone)}</td>
                        <td class="mono">${d.event}</td>
                        <td>${d.attempt}</td>
                        <td>
                          ${d.ok ? stateBadge('up', `HTTP ${d.statusCode}`) : stateBadge('down', d.error ?? 'failed')}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : ''
      }
    </section>`;
}

export function auditView(
  rows: { at: number; actor: string; action: string; detail: string }[],
  timeZone: string,
): Html {
  return html`<div class="pagehead"><h1>Audit log</h1></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Audit log">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <td>${formatTime(r.at, timeZone)}</td>
                <td>${r.actor}</td>
                <td class="mono">${r.action}</td>
                <td>${r.detail}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}
