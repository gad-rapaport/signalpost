import type { SessionUser } from '../auth/auth.js';
import { html, type Html } from './html.js';

export type Tone = 'up' | 'degraded' | 'down' | 'maintenance' | 'unknown' | 'paused';

const ICON: Record<Tone, string> = {
  up: 'M4 9.5 L7.5 13 L14 5.5',
  degraded: 'M9 4 V10.5 M9 13.2 V13.4',
  down: 'M5 5 L13 13 M13 5 L5 13',
  maintenance: 'M5 9 H13',
  unknown: 'M7 6.5 a2.2 2.2 0 1 1 3 2 c-1 .6 -1 1.2 -1 2 M9 13.2 V13.4',
  paused: 'M7 5 V13 M11 5 V13',
};

/** A state shown as icon + word, never colour alone. */
export function stateBadge(tone: Tone, label: string): Html {
  return html`<span class="badge badge--${tone}"
    ><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8.2" class="badge__disc" />
      <path d="${ICON[tone]}" class="badge__mark" /></svg
    >${label}</span
  >`;
}

function document(title: string, body: Html, opts: { bodyClass?: string } = {}): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${title}</title>
        <link rel="stylesheet" href="/assets/styles.css" />
        <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />
      </head>
      <body class="${opts.bodyClass ?? ''}">
        <a class="skip" href="#main">Skip to content</a>
        ${body}
      </body>
    </html>`;
}

export function publicPage(title: string, statusTitle: string, main: Html): Html {
  return document(
    `${title} · ${statusTitle}`,
    html`<header class="masthead">
        <div class="wrap masthead__row">
          <a class="brand" href="/">${brandMark()}<span>${statusTitle}</span></a>
          <a class="masthead__link" href="/admin">Sign in</a>
        </div>
      </header>
      <main id="main" class="wrap">${main}</main>
      <footer class="wrap footer">
        <p>Powered by Signalpost. Times are shown in the service's time zone.</p>
      </footer>`,
    { bodyClass: 'public' },
  );
}

export function brandMark(): Html {
  return html`<svg class="brand__mark" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <rect x="1" y="1" width="28" height="28" rx="7" class="brand__bg" />
    <path d="M7 19 L11 19 L13.5 11 L16.5 22 L19 15 L23 15" class="brand__line" />
  </svg>`;
}

const NAV: [string, string][] = [
  ['/admin', 'Monitors'],
  ['/admin/incidents', 'Incidents'],
  ['/admin/settings', 'Settings'],
  ['/admin/audit', 'Audit log'],
];

export function adminPage(
  title: string,
  current: string,
  user: SessionUser,
  csrf: string,
  main: Html,
  opts: { flash?: string | null } = {},
): Html {
  return document(
    `${title} · Signalpost admin`,
    html`<header class="adminbar">
        <div class="wrap adminbar__row">
          <a class="brand" href="/admin">${brandMark()}<span>Signalpost</span></a>
          <nav aria-label="Admin">
            ${NAV.map(([href, label]) => html`<a href="${href}" ${current === href ? html`aria-current="page"` : ''}>${label}</a>`)}
            <a href="/">Status page</a>
          </nav>
          <form method="post" action="/admin/logout" class="adminbar__out">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <span class="muted">${user.name}</span>
            <button type="submit" class="btn btn--quiet">Sign out</button>
          </form>
        </div>
      </header>
      <main id="main" class="wrap admin">
        ${opts.flash ? html`<p class="flash" role="status">${opts.flash}</p>` : ''} ${main}
      </main>`,
    { bodyClass: 'admin-body' },
  );
}

export function loginPage(error: string | null, email: string): Html {
  return document(
    'Sign in · Signalpost admin',
    html`<main id="main" class="login">
      <div class="login__card">
        <p class="brand">${brandMark()}<span>Signalpost</span></p>
        <h1>Sign in</h1>
        ${error ? html`<p class="error-box" role="alert">${error}</p>` : ''}
        <form method="post" action="/admin/login" class="stack">
          <label
            >Email <input type="email" name="email" autocomplete="username" required value="${email}"
          /></label>
          <label
            >Password <input type="password" name="password" autocomplete="current-password" required
          /></label>
          <button type="submit" class="btn btn--primary">Sign in</button>
        </form>
        <p class="muted"><a href="/">Back to the status page</a></p>
      </div>
    </main>`,
  );
}
