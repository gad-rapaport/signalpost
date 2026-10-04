# Operations

## Commands

| Command                             | What it does                                                    |
| ----------------------------------- | --------------------------------------------------------------- |
| `ops.ps1 setup`                     | `.env` with random secrets, build, start, seed                  |
| `ops.ps1 start` / `stop`            | Start and wait for `/readyz` / remove containers (volume kept)  |
| `ops.ps1 status`                    | State, health, CPU, memory, pids                                |
| `ops.ps1 logs [app\|demo-api]`      | Last 200 lines with timestamps                                  |
| `ops.ps1 seed`                      | Idempotent demo data                                            |
| `ops.ps1 backup`                    | Online backup into `./backups` (runs inside the live container) |
| `ops.ps1 restore <file> -Yes`       | Stop app, verify and restore, start, wait for ready             |
| `ops.ps1 reset-demo -Yes`           | Delete all data and seed again                                  |
| `ops.ps1 drill outage\|recover`     | Stop or start the demo target                                   |
| `ops.ps1 drill slow\|error\|normal` | Switch the demo target's behaviour                              |
| `ops.ps1 test` / `e2e`              | Checks and tests / Playwright against the stack                 |

## Signals to watch

| Signal                                                 | Healthy              | Look at                               |
| ------------------------------------------------------ | -------------------- | ------------------------------------- |
| `/readyz`                                              | 200                  | Container health, scheduler lag       |
| `signalpost_scheduler_lag_seconds`                     | under 2              | Event loop blocked or crashed         |
| `signalpost_policy_blocked_total`                      | flat                 | A monitor or DNS changed; see runbook |
| `signalpost_webhook_deliveries_total{result="failed"}` | flat                 | Receiver down or refused              |
| `signalpost_db_size_bytes`                             | stable after 30 days | Retention running?                    |
| Memory                                                 | about 40-60 MiB      | `ops.ps1 status`                      |

## Logs

JSON lines from Fastify (pino): request id, method, path, status, duration; cookies and authorization
headers are removed. Domain events: `monitor down`, `monitor recovered`, `check refused by outbound policy`,
`retention run`, `login failed`. Rotation: 2 files of 5 MB per container.

## Retention

At start and every 6 hours: raw checks older than `RETENTION_DAYS` (30) in batches of 5,000, daily rollups
older than 400 days, expired sessions, webhook deliveries older than 30 days, audit entries older than a year;
then `PRAGMA incremental_vacuum`. `npm run cli retention` (or `cli.js retention`) runs it on demand.

## Backups

`ops.ps1 backup` uses the SQLite online backup API inside the running container, switches the copy to a
rollback journal and runs `PRAGMA integrity_check`. Files land in `./backups` on the host. `restore` refuses
files outside `./backups`, checks integrity and that the file is a Signalpost database, keeps the replaced file
as `signalpost.db.before-restore`, and removes stale `-wal`/`-shm` files. CI runs backup and restore on every
push.

## Drills done (2026-10-04, local stack)

| Drill                         | Result                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `drill outage`                | Status "Major outage" with 3 automatic incidents within 80 s; texts name no host            |
| `drill recover`               | All incidents resolved within 60 s; status back to "All systems operational"                |
| `drill error` with webhook on | 3 `incident.opened` + 3 `incident.resolved` delivered, all signatures valid at the receiver |
| Backup, then restore          | 108 KB backup; restore, app ready, status page unchanged                                    |
| Restart (`stop`/`start`)      | Data kept in the volume; checks resume on their interval, never all at once                 |

Procedures for real incidents are in [RUNBOOKS.md](RUNBOOKS.md).
