# Testing

## Suites

| Suite              | File                                  | Count | Covers                                                                                                                                                                                                |
| ------------------ | ------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address and policy | `tests/unit/policy.test.ts`           | 40    | 21 address classes (IPv4, IPv6, mapped), wildcards, schemes, credentials, ports, DNS answers incl. rebinding and mixed answers, IP literals                                                           |
| State machine      | `tests/unit/evaluate.test.ts`         | 7     | Thresholds both ways, unknown start, degraded and recovery into degraded                                                                                                                              |
| Web and helpers    | `tests/unit/web.test.ts`              | 17    | HTML escaping, form validation, overall status, metrics format, DST-safe days, public failure text, signatures                                                                                        |
| Probe              | `tests/integration/probe.test.ts`     | 8     | Real HTTP server: success, status, keyword, redirect to metadata not followed, timeout, 64 KB cap, rebinding refused before connecting, pinned address, refused connection                            |
| Lifecycle          | `tests/integration/lifecycle.test.ts` | 5     | Outage opens one incident and recovery resolves it; signed webhooks; policy refusal never contacts the target; webhook refused outside the policy; seed idempotence; retention                        |
| App                | `tests/integration/app.test.ts`       | 14    | Status page and headers, JSON, health, metrics auth, stored XSS escaped, sign-in, cookie flags, CSRF and origin, policy refusals with audit, monitor CRUD, incidents, login limit, backup and restore |
| E2E desktop        | `tests/e2e/flows.spec.ts`             | 8     | Status page without URLs, admin pages with axe, form refusals, redirect probe, check/pause/resume, incident on the status page, sessions, headers                                                     |
| E2E phone          | `tests/e2e/mobile.spec.ts`            | 1     | No horizontal scrolling, axe on status page and admin                                                                                                                                                 |
| CI stack           | `.github/workflows/ci.yml`            | 2     | Failure drill (stop demo-api, 3 incidents open, start, all resolve) and backup/restore on the running stack                                                                                           |

Integration tests never use loopback for targets (the policy forbids it); they listen on the machine's first
private IPv4 address and map test host names to it with an injected resolver.

## Results (2026-10-04, local)

- Unit: 64 passed. Integration: 27 passed (about 3 s). E2E: 9 passed (about 14 s).
- Failure drill on the local stack: with `demo-api` stopped, the first incidents opened 40-60 s later and all
  three within 80 s; after `drill recover`, all resolved within 40-60 s.
- Webhook drill: with the webhook enabled, `demo-api` verified 6 of 6 signatures (3 opened, 3 resolved).
- Backup and restore through `ops.ps1`: a 108 KB backup restored and the app came back ready.

## Gaps

- HTTPS targets are covered by unit tests of the policy, not by an integration test with a local TLS server.
- IPv6-only targets are classified and tested in unit tests; the Docker networks here are IPv4.
- No load test: the scheduler has run with the demo's 3-4 monitors; capacity figures in SLIM.md are estimates.
