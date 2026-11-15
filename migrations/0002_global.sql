-- Global (non-tenant) tables. Accessed only through src/server/db/global.ts (PLAN §5.1).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  locale TEXT,
  theme TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- user_id / display_name carry the pending registration between options and verify.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  invite_id TEXT,
  user_id TEXT,
  display_name TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  has_sample_data INTEGER NOT NULL DEFAULT 0,
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  ai_consent_at TEXT,
  ai_consent_by TEXT,
  ai_consent_provider TEXT,
  safety_buffer_minor INTEGER NOT NULL DEFAULT 0,
  forecast_daily_variable_minor INTEGER,
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE memberships (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bootstrap', 'owner', 'member', 'recovery')),
  household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
  role TEXT,
  target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT,
  revoked_at TEXT
);
CREATE INDEX invites_household ON invites(household_id);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Tenant table created early so security events can be recorded from M2 on.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_h_created ON audit_log(household_id, created_at);
