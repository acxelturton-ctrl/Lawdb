-- Easy sign-in: Google and LinkedIn, a basic profile, and a welcome email sent once.
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('lawyer', 'staff', 'public', 'other'));
ALTER TABLE users ADD COLUMN provider TEXT;       -- how the account was first created: email, google or linkedin
ALTER TABLE users ADD COLUMN welcomed_at TEXT;    -- the welcome email has been sent
-- People who already have accounts are not welcomed again.
UPDATE users SET welcomed_at = datetime('now'), provider = 'email';

-- One row per sign-in attempt through Google or LinkedIn (single use, 10 minutes). Only a hash of the state is kept.
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  verifier   TEXT NOT NULL,
  next_path  TEXT NOT NULL DEFAULT '/account/',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
