# Security

## The main risk: server-side request forgery

A monitoring tool fetches URLs that an administrator types in. Without controls, anyone who can create a
monitor (or steal an admin session) can make the server request `http://169.254.169.254/latest/meta-data/`
(cloud credentials), `http://localhost:…/admin`, a database port on the internal network, or a public name that
resolves to a private address. Signalpost treats every outbound request as untrusted and applies the same
policy to checks and to the webhook (`src/net/policy.ts`, `src/net/probe.ts`).

| Control                | Rule                                                                                                                                                      | Where             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Scheme                 | `http` and `https` only (no `file:`, `gopher:`, `ftp:`)                                                                                                   | `parseTarget`     |
| Credentials in URLs    | Refused; they would be stored and shown                                                                                                                   | `parseTarget`     |
| Host allowlist         | `ALLOWED_HOSTS`: exact names or `*.example.org` (subdomains only). Empty means nothing can be monitored.                                                  | `hostAllowed`     |
| IP literals            | Only if listed exactly, and still classified                                                                                                              | `parseTarget`     |
| Port allowlist         | `ALLOWED_PORTS` (default 80, 443)                                                                                                                         | `parseTarget`     |
| DNS validation         | Every address in the answer is classified; one forbidden address fails the check                                                                          | `resolveTarget`   |
| Forbidden ranges       | Loopback, link-local (incl. 169.254.169.254), unspecified, multicast, broadcast, reserved, documentation, benchmarking, IPv4-mapped forms of all of these | `classifyAddress` |
| Private ranges         | RFC 1918, fc00::/7, 100.64/10: refused unless the host is in `ALLOW_PRIVATE_HOSTS` (exact names). Loopback and link-local are refused even then.          | `resolveTarget`   |
| DNS rebinding          | The connection uses a custom `lookup` that returns the validated address, so no second resolution happens                                                 | `pinnedLookup`    |
| TLS                    | Certificate verified against the hostname (SNI), not the pinned address                                                                                   | `probe`           |
| Redirects              | Never followed; a 3xx outside the expected range is recorded as `redirect` with the target shown to admins                                                | `probe`           |
| Response size and time | At most 64 KB read; one deadline covers DNS, connect, TLS and response                                                                                    | `probe`           |
| Headers                | Fixed user agent, no custom headers, fresh connection per check (`agent: false`)                                                                          | `probe`           |
| Re-check on every run  | The policy runs on each check, not only when saving, so DNS changes and config changes take effect at once                                                | `Scheduler`       |
| Configuration          | The policy comes from environment variables only; the admin UI shows it read-only, so a stolen session cannot widen it                                    | `config.ts`       |
| Network                | The demo target is on an `internal: true` network; the app container is the only member of both networks                                                  | `compose.yaml`    |

Tests: `tests/unit/policy.test.ts` (address classes, rules, DNS answers including rebinding and mixed answers),
`tests/integration/probe.test.ts` (real server: redirect to the metadata address not followed, loopback after
rebinding refused before any connection, pinned address used when DNS changes, body cap, timeout), E2E (the
form refuses metadata, localhost, `file:` and a blocked port; a monitor on an allowed host that redirects to
169.254.169.254 records "Redirect not followed").

## Other controls

| Area                           | Control                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin sign-in                  | Argon2id (OWASP parameters), timing-equalised unknown accounts, 10 attempts per minute per address                                                               |
| Sessions                       | Random 256-bit token, only its SHA-256 stored; `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS; 12 h                                                          |
| CSRF                           | Per-session token in every form, compared in constant time; `Origin` must match when present                                                                     |
| Output                         | All HTML through an escaping template tag; CSP `default-src 'self'; script-src 'none'; frame-ancestors 'none'`                                                   |
| Information on the status page | Names and states only. Incident texts written by the system name the kind of failure ("no response in time"), never hosts, addresses or raw errors (unit-tested) |
| Metrics                        | Disabled unless `METRICS_TOKEN` (24+ characters) is set; bearer token compared in constant time                                                                  |
| Webhook                        | Disabled unless `WEBHOOK_URL` and `WEBHOOK_SECRET` (32+ characters) are set; HMAC-SHA256 over `timestamp.body`; same outbound policy                             |
| Audit                          | Sign-ins, monitor changes, refused monitors, incident posts                                                                                                      |
| Logs                           | Cookies and authorization headers redacted; request ids                                                                                                          |
| Container                      | Distroless, non-root, read-only root, `cap_drop: ALL`, `no-new-privileges`, memory and pid limits, port bound to 127.0.0.1                                       |
| Supply chain                   | Exact versions and lockfile, `npm ci --ignore-scripts`, production audit, gitleaks, Trivy report in CI                                                           |

## Known gaps

- One admin role; no per-user permissions or two-factor sign-in.
- HSTS is sent only when `COOKIE_SECURE=true` (the TLS proxy is not part of this repository).
- Allowlisting a wildcard hands trust to whoever controls that zone's DNS; the address checks still apply.
- The demo control endpoint on `demo-api` is protected by a token and reachable only on the internal network.
