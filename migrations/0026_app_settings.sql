-- App-wide settings set by the super-admin (D-R34). First use: the shared Shortcuts' iCloud links
-- (keys 'shortcut_purchase_link' / 'shortcut_file_link'), offered to every household that hasn't
-- published its own. A shortcut carries no household or key (each person pastes theirs), so one works for all.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
