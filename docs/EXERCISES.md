# Exercises

1. **Certificate expiry warnings.** After an HTTPS check, read `res.socket.getPeerCertificate().valid_to` and
   mark the monitor degraded 14 days before expiry. Add a TLS test server to the integration tests.
2. **TCP port monitors.** A second probe type using `net.connect` with the same policy and pinned address.
3. **Scheduled maintenance.** Incidents with a future start that switch to "in progress" and pause alerts for
   the affected monitors.
4. **A second checking location.** Run the scheduler in a second container and only open an incident when both
   agree; store the location with each check.
5. **PostgreSQL.** Replace better-sqlite3 behind the repo functions; the unique partial index and the
   transaction in `recordCheck` carry over.
6. **Email notifications** through an allowlisted SMTP relay, sharing the webhook's retry and recording.
7. **Status page subscriptions** (RSS or Atom feed of incidents): server-rendered, no JavaScript needed.
8. **Load test.** 500 monitors at 30 s against a local target; measure scheduler lag and database growth.
