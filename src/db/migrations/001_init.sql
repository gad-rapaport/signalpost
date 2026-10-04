-- Signalpost schema. Times are Unix milliseconds (UTC); days are 'YYYY-MM-DD' in the app time zone.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash    BLOB PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE monitors (
  id                INTEGER PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  method            TEXT NOT NULL CHECK (method IN ('GET', 'HEAD')),
  interval_s        INTEGER NOT NULL CHECK (interval_s BETWEEN 5 AND 86400),
  timeout_ms        INTEGER NOT NULL CHECK (timeout_ms BETWEEN 500 AND 30000),
  expected_min      INTEGER NOT NULL CHECK (expected_min BETWEEN 100 AND 599),
  expected_max      INTEGER NOT NULL CHECK (expected_max BETWEEN expected_min AND 599),
  keyword           TEXT,
  degraded_ms       INTEGER NOT NULL CHECK (degraded_ms > 0),
  fail_threshold    INTEGER NOT NULL CHECK (fail_threshold BETWEEN 1 AND 10),
  recover_threshold INTEGER NOT NULL CHECK (recover_threshold BETWEEN 1 AND 10),
  is_public         INTEGER NOT NULL DEFAULT 1,
  is_paused         INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  state             TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'up', 'degraded', 'down')),
  state_since       INTEGER,
  consecutive_fail  INTEGER NOT NULL DEFAULT 0,
  consecutive_ok    INTEGER NOT NULL DEFAULT 0,
  consecutive_slow  INTEGER NOT NULL DEFAULT 0,
  last_checked_at   INTEGER,
  last_latency_ms   INTEGER,
  last_status_code  INTEGER,
  last_error        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE checks (
  id           INTEGER PRIMARY KEY,
  monitor_id   INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  at           INTEGER NOT NULL,
  ok           INTEGER NOT NULL,
  slow         INTEGER NOT NULL DEFAULT 0,
  status_code  INTEGER,
  latency_ms   INTEGER,
  error_kind   TEXT,
  error_detail TEXT
);
CREATE INDEX checks_monitor_at ON checks(monitor_id, at);
CREATE INDEX checks_at ON checks(at);

-- Per-day rollup, updated with every check, so uptime history outlives raw checks.
CREATE TABLE daily (
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  total       INTEGER NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 0,
  slow        INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  latency_max INTEGER NOT NULL DEFAULT 0,
  synthetic   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day)
);

CREATE TABLE incidents (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER REFERENCES monitors(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  impact      TEXT NOT NULL CHECK (impact IN ('outage', 'degraded', 'maintenance')),
  status      TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  is_auto     INTEGER NOT NULL DEFAULT 0,
  synthetic   INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX incidents_open ON incidents(resolved_at);
-- At most one open automatic incident per monitor.
CREATE UNIQUE INDEX incidents_one_open_auto ON incidents(monitor_id) WHERE is_auto = 1 AND resolved_at IS NULL;

CREATE TABLE incident_updates (
  id          INTEGER PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at          INTEGER NOT NULL,
  status      TEXT NOT NULL,
  body        TEXT NOT NULL,
  author      TEXT NOT NULL
);
CREATE INDEX incident_updates_incident ON incident_updates(incident_id, at);

CREATE TABLE webhook_deliveries (
  id          INTEGER PRIMARY KEY,
  incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,
  at          INTEGER NOT NULL,
  attempt     INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  status_code INTEGER,
  error       TEXT
);
CREATE INDEX webhook_deliveries_at ON webhook_deliveries(at);

CREATE TABLE audit_log (
  id     INTEGER PRIMARY KEY,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX audit_log_at ON audit_log(at);
