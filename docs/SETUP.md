# Setup

## Requirements

- Docker with Compose v2 (Docker Desktop on Windows, WSL 2 backend).
- PowerShell 7.2+ for `scripts/ops.ps1`.
- For development and tests: Node.js 24, `npm ci --ignore-scripts` (better-sqlite3 ships prebuilt binaries),
  Chromium for Playwright via `npx playwright install chromium`.

## Run the demo

```powershell
./scripts/ops.ps1 setup
```

This copies `.env.example` to `.env` with random values for `SEED_ADMIN_PASSWORD` and `DEMO_CONTROL_TOKEN`,
builds the image, starts `app` and `demo-api`, and seeds three demo monitors, a paused external example and
generated history. Open http://127.0.0.1:8105 and http://127.0.0.1:8105/admin.

| Variable                        | Default                | Meaning                                               |
| ------------------------------- | ---------------------- | ----------------------------------------------------- |
| `ALLOWED_HOSTS`                 | `demo-api,example.org` | Hosts monitors may target (`*.domain` for subdomains) |
| `ALLOW_PRIVATE_HOSTS`           | `demo-api`             | Exact hosts that may resolve to private addresses     |
| `ALLOWED_PORTS`                 | `80,443,8080`          | Destination ports                                     |
| `RETENTION_DAYS`                | `30`                   | Raw check retention                                   |
| `LOGIN_RATE_LIMIT_PER_MINUTE`   | `10`                   | Sign-in attempts per address per minute               |
| `METRICS_TOKEN`                 | unset (metrics off)    | Bearer token for `/metrics`, 24+ characters           |
| `WEBHOOK_URL`, `WEBHOOK_SECRET` | unset (webhook off)    | Signed incident webhook                               |

Ports: only `127.0.0.1:8105` is published. `demo-api` has no host port. The containers use
`restart: on-failure:3`, so they do not start by themselves after a reboot.

## Try the webhook and metrics locally

Add to `.env`, then `docker compose up -d --wait`:

```
WEBHOOK_URL=http://demo-api:8080/__webhook
WEBHOOK_SECRET=<32+ random characters>
METRICS_TOKEN=<24+ random characters>
```

Run `ops.ps1 drill error`, wait a minute, `ops.ps1 drill normal`, then `ops.ps1 logs demo-api` shows
`webhook received: signature valid` for each opened and resolved incident. Remove the lines again to return
to the default (both off).

## Develop

```powershell
npm ci --ignore-scripts
npm run dev        # http://127.0.0.1:3105 with tsx watch; reads .env
npm run cli seed   # seed the local data/signalpost.db
```

Outside Docker there is no `demo-api` host, and the policy refuses loopback, so local development is for the
UI and admin flows; checks against real targets need an allowlisted host. Integration tests start their own
targets on the machine's private address.

## Checks

```powershell
./scripts/ops.ps1 test     # format, lint, types, unit and integration tests
./scripts/ops.ps1 e2e      # Playwright against the running stack
npm run screenshots        # regenerate docs/screenshots
```

E2E signs in many times; the local `.env` raises `LOGIN_RATE_LIMIT_PER_MINUTE` to 60 for that. The limiter
itself is covered by an integration test.
