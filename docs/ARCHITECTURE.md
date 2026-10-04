# Architecture

```
                 127.0.0.1:8105                       network "targets" (internal: true)
 Browser ───────────► app (Node.js, Fastify) ─────────────────► demo-api (same image, demo-target)
                        │   ├─ status page, admin (server-rendered HTML)
                        │   ├─ Scheduler ─► probe() ─► outbound policy ─► pinned HTTP request
                        │   ├─ incidents, webhook (same policy)
                        │   └─ /healthz /readyz /metrics /api/status.json
                        ├─ SQLite (WAL) on volume "data"
                        └─ network "edge": the only route out, for allowlisted public hosts
```

## Modules

| Path                       | Role                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `src/net/addresses.ts`     | Classifies IP addresses as public, private or forbidden                                    |
| `src/net/policy.ts`        | URL rules, allowlist, DNS validation, address choice                                       |
| `src/net/probe.ts`         | One check: pinned connection, deadline, no redirects, 64 KB cap                            |
| `src/monitor/evaluate.ts`  | Pure state machine: up, degraded, down, with thresholds                                    |
| `src/monitor/repo.ts`      | Monitors, checks and daily rollups; `recordCheck` is one transaction                       |
| `src/monitor/incidents.ts` | Automatic and manual incidents, updates, audit log                                         |
| `src/monitor/scheduler.ts` | Due-check loop with a concurrency limit; opens and resolves incidents; webhook             |
| `src/monitor/retention.ts` | Deletes old data in batches, incremental vacuum                                            |
| `src/notify/webhook.ts`    | Signed deliveries with retries, recorded per attempt                                       |
| `src/web/*`                | Escaping HTML templates, status page, admin views, monitor form                            |
| `src/app.ts`               | Routes, sessions, CSRF, security headers, metrics                                          |
| `src/cli.ts`               | migrate, seed, reset-demo, backup, restore, retention, healthcheck, demo-target, demo-mode |

## A check, step by step

1. The scheduler ticks every second. A monitor is due when `now >= next run`; first runs after a start are
   spread by monitor id so a restart does not fire everything at once. At most `MAX_CONCURRENT_CHECKS` run,
   and a monitor never overlaps itself.
2. `probe()` parses the URL against the policy, resolves the name, classifies every answer, and connects to
   the chosen address through a custom `lookup` (no second DNS query). TLS still verifies the hostname.
3. The response status is compared with the expected range; 3xx outside the range is a `redirect` failure and
   is not followed. With a keyword, at most 64 KB of body is read.
4. `recordCheck` stores the check, upserts the day's rollup and updates the monitor's counters and state in
   one SQLite transaction.
5. `evaluate` decides transitions. `down` opens one automatic incident (a partial unique index allows only one
   open automatic incident per monitor) with a public description of the failure kind; `recovered` resolves it.
   Both send the webhook in the background.

## Data

SQLite with WAL, `foreign_keys`, `busy_timeout` and incremental auto-vacuum. Times are Unix milliseconds.
Tables: `users`, `sessions`, `monitors`, `checks` (raw, retained `RETENTION_DAYS`), `daily` (per monitor and
day in `APP_TIMEZONE`, kept 400 days, `synthetic` flag for seeded history), `incidents`, `incident_updates`,
`webhook_deliveries` (30 days), `audit_log` (1 year), `schema_migrations`.

Why rollups: the status page needs 30 days of uptime per service; reading 30 days of raw checks for every
page view would grow with check frequency. The rollup is updated in the same transaction as the check, so it
is always consistent and survives raw-data retention.

## Status computation

Overall: any monitor down and at least half down is a major outage, otherwise partial; degraded monitors or
degraded incidents give "Degraded performance"; open maintenance gives "Maintenance in progress". Daily bars:
below 95 % up is red, below 99.9 % or more than 20 % slow checks is amber, no data is grey.

## Health

`/healthz` answers if the process serves HTTP. `/readyz` also needs a working database and a scheduler that
ticked within 15 s; the container health check calls it through `cli.js healthcheck` (no curl in distroless).
