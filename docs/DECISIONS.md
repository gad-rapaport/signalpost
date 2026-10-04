# Decisions

## Own HTTP client instead of fetch

`fetch` (undici) follows redirects by default, resolves names itself and hides the connection. The policy needs
to resolve once, check every address, then connect to exactly that address with TLS verified against the
name, never follow redirects, cap the body and apply one deadline. `node:http`/`node:https` with a custom
`lookup` and `agent: false` give that control in about 250 lines (policy and probe) that are easy to test.

## Policy in configuration, not in the database

If the allowlist were editable in the admin UI, a stolen session could add `169.254.169.254`. Keeping it in
environment variables means widening it takes a redeploy, which goes through review. The UI shows it read-only.

## Private addresses only by exact name

The demo target sits on a private Docker network, so private addresses cannot be forbidden outright. Instead,
`ALLOW_PRIVATE_HOSTS` lists exact names that may resolve to private ranges. Loopback, link-local and metadata
stay forbidden for them too, and wildcards are not accepted there.

## SQLite

One file, no server, online backups through the SQLite backup API, and plenty of headroom: a monitor checked
every 30 s writes 2,880 rows a day. WAL lets the status page read while the scheduler writes. better-sqlite3 is
synchronous, which suits short transactions in a single process. `node:sqlite` is still experimental in
Node 24. The cost: a single writer process; scaling out would mean PostgreSQL (see EXERCISES.md).

## Server-rendered HTML, no client JavaScript

A status page must load when things are on fire, on any device, and be crawlable. The admin is forms and
tables. Server rendering removes a bundle, a client router and an API layer, and allows CSP `script-src 'none'`.
The cost: no live updates without reload; the page says so ("Reload for the latest state").

## Incidents need consecutive failures

One failed check is often the network, not the service. Two failures in a row (configurable 1-10) open an
incident and two successes resolve it. One open automatic incident per monitor is enforced by a partial unique
index, so concurrent checks cannot open duplicates.

## Public failure text

Error details such as `"db.internal" resolves to 10.0.0.5` are useful to an admin and dangerous on a public
page. Automatic incident texts map the failure kind to fixed phrases; details stay in the admin's check log.
This was found by an E2E test that asserts the internal host name never appears on the status page.

## Daily rollups and retention

Raw checks are kept 30 days by default; the per-day rollup is kept 400 days and is enough for the status page
and uptime figures. Deletion runs in batches of 5,000 so the scheduler is never blocked for long, followed by
an incremental vacuum.

## Metrics and webhook off by default

Both expose information or send data out, so they start disabled. Metrics need a token of at least 24
characters; the webhook needs a URL that passes the outbound policy and a secret of at least 32 characters.

## Demo target in the same image

The stand-in service is a small Node server (`src/demo/target.ts`) started with another command from the app image. No second
image to build, scan or store; it runs on an internal-only network with its own limits.

## Generated demo history, flagged

Thirty empty bars do not show what the page looks like in use. The seed generates earlier days and two past
incidents with `synthetic = 1`, and the page says that earlier days are generated. Days with real checks are
never overwritten.
