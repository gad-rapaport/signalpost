# Runbooks

Each runbook: symptom, checks in order, fix, how to confirm. Commands assume the repository directory.

## 1. A monitored service is down

**Symptom:** status page shows an outage; automatic incident "X is not responding".

1. Admin > the monitor > Recent checks. The result column says the kind: `status`, `timeout`, `dns`,
   `connect`, `tls`, `redirect`, `keyword`, `blocked`.
2. `status`/`timeout`/`connect`: the service itself; involve its owner. Post an update on the incident
   (status Identified) so the status page says something human.
3. `dns`: the name no longer resolves; check the service's DNS or, in the demo, `ops.ps1 status` for
   `demo-api`.
4. `blocked`: go to runbook 3.
5. When checks pass twice in a row the incident resolves itself; add a closing update if there is more to say.

## 2. Alerts that come and go (flapping)

**Symptom:** several short incidents in a day for the same monitor.

1. Monitor detail: are failures `timeout` near the timeout value? Raise the timeout or the slow threshold.
2. Raise "Failures before an incident" to 3 if the target has known short blips.
3. Checks come from one place; a local network problem looks like an outage everywhere. Compare with other
   monitors at the same times.

## 3. Checks refused by the outbound policy

**Symptom:** results `blocked`, `signalpost_policy_blocked_total{source="check"}` rising, log line
`check refused by outbound policy`.

1. Read the detail: "not on the outbound allowlist", "Port … is not allowed", or "resolves to … a private /
   reserved or internal address".
2. If the name now resolves to an internal address, treat it as a possible DNS hijack or rebinding attempt;
   the request was never sent. Check the domain's DNS records.
3. If the change is legitimate (a service moved), update `ALLOWED_HOSTS` / `ALLOW_PRIVATE_HOSTS` in the
   deployment's `.env` through review and redeploy. Never add loopback or link-local; the code refuses them.

## 4. Signalpost itself is unhealthy

**Symptom:** container unhealthy, `/readyz` 503.

1. `curl http://127.0.0.1:8105/readyz` gives the reason: `database` or `scheduler`.
2. `ops.ps1 logs app` for the error. `database`: disk full or file permissions on the volume (runbook 6).
   `scheduler`: the event loop is blocked or the scheduler threw; a restart (`docker compose restart app`)
   restores it, then report the log lines.
3. Confirm: `/readyz` 200 and new checks in the admin within a minute.

## 5. Webhook deliveries fail

**Symptom:** Settings > deliveries show failures; `signalpost_webhook_deliveries_total{result="failed"}`.

1. `blocked:` errors: the webhook URL leaves the policy; fix `WEBHOOK_URL` or the allowlist.
2. `HTTP 401` at the receiver: the receiver rejects the signature; secrets differ or the receiver's clock is
   more than 5 minutes off.
3. Timeouts or connection errors: receiver down. Deliveries are retried 3 times; missed events can be read
   from the incident list.

## 6. Disk usage grows

1. Settings shows the database size; `docker system df -v` shows the `signalpost_data` volume.
2. Check the log for `retention run` every 6 hours; run `docker compose exec app /nodejs/bin/node dist/cli.js retention`.
3. Lower `RETENTION_DAYS` if needed; daily uptime history is kept independently.
4. Old files in `./backups` are not removed automatically; delete the ones you no longer need.

## 7. Restore from a backup

1. `ops.ps1 backup` first if the current data still matters.
2. `ops.ps1 restore backups/<file>.db -Yes`: stops the app, verifies the file, keeps the current database as
   `.before-restore`, starts and waits for ready.
3. Confirm: admin shows the expected monitors; the status page loads.
4. To undo: restore again (the previous file is in the volume as `signalpost.db.before-restore`).

## 8. Admin access

- Lost password: set a new `SEED_ADMIN_PASSWORD` in `.env` and run `ops.ps1 seed`; it updates the password and
  nothing else.
- Suspected session theft: `docker compose exec app /nodejs/bin/node dist/cli.js revoke-sessions` signs
  everyone out at once (recorded in the audit log). Rotate the password, then review the audit log for
  `monitor.*` actions. The outbound policy cannot be widened from a session, only by a redeploy.
