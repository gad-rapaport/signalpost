# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [SemVer](https://semver.org/).

## [0.1.0] - 2026-10-04

### Added

- HTTP and HTTPS checks with expected status range, keyword, timeout and slow threshold.
- Outbound policy: host and port allowlists, DNS validation of every answer, forbidden and private address
  classes, connection pinned to the validated address, redirects never followed, 64 KB body cap, checked on
  save and on every run.
- State machine with failure and recovery thresholds; automatic incidents with public, detail-free texts;
  manual incidents and updates.
- Server-rendered status page with 30-day uptime bars and incident history; JSON summary.
- Admin with sessions, CSRF protection, login rate limit, audit log; read-only policy view.
- Health and readiness endpoints, Prometheus metrics behind a token (off by default), signed webhook with
  retries (off by default).
- Daily rollups, retention, online backups with integrity checks, verified restore, session revocation.
- Demo target on an internal network with failure modes; failure drill commands.
- Distroless image, hardened Compose stack bound to 127.0.0.1, CI with drill and backup/restore on the
  running stack, manual and disabled deploy workflow.
