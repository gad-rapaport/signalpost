# Deployment

Nothing is deployed. This is the prepared path for a future public demo.

## Pipeline

- **CI** (`.github/workflows/ci.yml`): format, lint, types, unit and integration tests, build; Docker build,
  stack start and seed, E2E (desktop and phone), failure drill and backup/restore on the running stack, Trivy
  report; gitleaks over full history and `npm audit` for production dependencies. Read-only token, actions
  pinned to commit SHAs.
- **Deploy** (`.github/workflows/deploy.yml`): runs only when started by hand. `publish` pushes
  `ghcr.io/<owner>/signalpost:<sha>`; `deploy` runs only with the repository variable `DEPLOY_ENABLED=true`
  and approval on the `demo` environment. Neither exists today.

## Server layout (when it exists)

```
/srv/signalpost/compose.yaml
/srv/signalpost/compose.prod.yaml   pinned digest, COOKIE_SECURE, TRUST_PROXY, 127.0.0.1:8105
/srv/signalpost/.env                secrets and the outbound policy for that host
/srv/signalpost/deploy.sh           backup, deploy by digest, roll back if unhealthy
/srv/signalpost/backups/
```

A reverse proxy terminates TLS and forwards to 127.0.0.1:8105; it should not forward `/metrics` publicly
(Prometheus can scrape the loopback address). The outbound policy on a public host would list the real
services to watch and no private hosts.

## Deploy and roll back

`deploy.sh <image@sha256:…>` takes an online backup, starts the new image and waits for health; if it is
unhealthy, the previous digest is started again. `deploy.sh --rollback` returns to the previous digest
explicitly. Migrations only add tables or columns, so an older image can run on a newer database; if a
migration ever has to remove something, it ships in a later release than the code that stops using it.

## Restore after a bad release

`ops.ps1 restore` (or `cli.js restore <file> --yes` with the app stopped) brings back the backup taken by the
deploy. The previous file stays next to it as `.before-restore`.
