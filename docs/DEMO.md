# Demo script

About 7 minutes. `./scripts/ops.ps1 start`; open http://127.0.0.1:8105 and, in a second tab, /admin.

1. **Status page (1 min).** Overall state, three services with 30 daily bars (earlier days are generated demo
   history, as the note says), past incidents. View source: no scripts, no URLs.
2. **Admin (1 min).** Sign in. Monitors with state, latency and 24-hour uptime. Open Orders API: facts, latency
   chart, recent checks.
3. **The outbound policy (2 min).** Add monitor with `http://169.254.169.254/latest/meta-data/`: refused, with
   the reason. Try `http://localhost:3105/admin`, `file:///etc/passwd`, `http://demo-api:22/`. Then add
   `http://demo-api:8080/moved` (an allowed host) and press Check now: the result is "Redirect not followed
   (to http://169.254.169.254/…)". Settings shows the policy is read-only. Audit log lists the refusals.
4. **Failure drill (2 min).** Terminal: `./scripts/ops.ps1 drill outage`. Within about a minute the status page
   shows "Major outage" and three incidents whose text names no internal host. `./scripts/ops.ps1 drill
recover`: incidents resolve after two good checks.
5. **Operations (1 min).** `./scripts/ops.ps1 backup`, `ops.ps1 status` (about 55 MiB for the app). Mention
   `/metrics` and the webhook, both off until configured (SETUP.md shows how to try them).

## Questions to expect

- Why not just block private IPs? Because the name can resolve differently later (DNS rebinding) and because
  redirects can point anywhere: the check resolves once, pins the address and never follows redirects.
- Why SQLite? One process, one file, online backups; see DECISIONS.md.
- What if the checker's own network fails? It looks like an outage everywhere; checks come from one place
  (a stated limitation).
