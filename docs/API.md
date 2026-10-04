# API, metrics and webhooks

Signalpost is mostly HTML. The machine-readable endpoints are below.

## `GET /api/status.json`

Public summary for other tools (no URLs, no error details). `Cache-Control: no-cache`.

```json
{
  "status": "up",
  "description": "All systems operational",
  "components": [{ "name": "Storefront", "status": "up" }],
  "openIncidents": [{ "title": "Orders API is not responding", "impact": "outage", "status": "investigating", "startedAt": "2026-10-04T16:57:12.000Z" }],
  "updatedAt": "2026-10-04T17:00:00.000Z"
}
```

`status` and component `status`: `up`, `degraded`, `down`, `maintenance`, `unknown`, `paused`.

## `GET /healthz`, `GET /readyz`

`/healthz` → `200 {"status":"ok"}` while the process serves HTTP. `/readyz` → `200 {"status":"ready"}`, or
`503 {"status":"unavailable","reason":"database"|"scheduler"}` when the database fails or the scheduler has not
ticked for 15 s.

## `GET /metrics`

Prometheus text format 0.0.4. Disabled (404) unless `METRICS_TOKEN` is set; requires
`Authorization: Bearer <METRICS_TOKEN>` (401 otherwise).

| Metric                                    | Type      | Labels                          |
| ----------------------------------------- | --------- | ------------------------------- |
| `signalpost_monitor_state`                | gauge     | `monitor`, `state`              |
| `signalpost_monitor_last_latency_seconds` | gauge     | `monitor`                       |
| `signalpost_checks_total`                 | counter   | `monitor`, `result`             |
| `signalpost_check_duration_seconds`       | histogram | `monitor`                       |
| `signalpost_policy_blocked_total`         | counter   | `source` (check, form, webhook) |
| `signalpost_incidents_opened_total`       | counter   | `monitor`                       |
| `signalpost_incidents_open`               | gauge     |                                 |
| `signalpost_webhook_deliveries_total`     | counter   | `result`                        |
| `signalpost_retention_deleted_rows_total` | counter   | `table`                         |
| `signalpost_scheduler_lag_seconds`        | gauge     |                                 |
| `signalpost_db_size_bytes`                | gauge     |                                 |
| `process_resident_memory_bytes`           | gauge     |                                 |

Counters reset when the process restarts. Example alert: `signalpost_scheduler_lag_seconds > 30` for 2 minutes.

## Webhook

Disabled unless `WEBHOOK_URL` and `WEBHOOK_SECRET` are set. The URL must pass the outbound policy.

```
POST <WEBHOOK_URL>
Content-Type: application/json
X-Signalpost-Timestamp: 1791133562
X-Signalpost-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with WEBHOOK_SECRET>

{"event":"incident.opened","sentAt":"2026-10-04T17:06:02.118Z","incidentId":4,"monitor":{"slug":"sign-in","name":"Sign-in service"},"detail":"…"}
```

Events: `incident.opened`, `incident.updated`, `incident.resolved`. Receivers should verify the signature with
a constant-time comparison and reject timestamps older than 5 minutes; `demo-api` does exactly that at
`/__webhook` (see `src/demo/target.ts`). Delivery: up to 3 attempts (immediately, after 2 s, after 10 s); each
attempt is recorded and shown under Settings. Any 2xx counts as delivered; redirects are not followed.

## Forms

Admin pages are HTML forms posting `application/x-www-form-urlencoded` with a `_csrf` field. They are not an
API; there is no token-based write API by design.
