-- Owner invites: an admin invites a firm's owner by email (after a phone call). The link signs them in and gives them
-- that firm straight away, so there is no claim-and-wait step. Only a hash of the token is stored.
CREATE TABLE firm_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  firm_slug   TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  switch_page INTEGER NOT NULL DEFAULT 0,
  invited_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX idx_invites_firm ON firm_invites (firm_slug, created_at);
