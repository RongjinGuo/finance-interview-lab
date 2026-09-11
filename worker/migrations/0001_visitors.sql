CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  ip TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_time ON visits(time);
CREATE INDEX IF NOT EXISTS visits_ip ON visits(ip);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_expiry ON login_attempts(reset_at);

CREATE TABLE IF NOT EXISTS maintenance_state (
  name TEXT PRIMARY KEY,
  last_run INTEGER NOT NULL
);
INSERT OR IGNORE INTO maintenance_state (name,last_run) VALUES ('cleanup',0);
