-- Phase B: firm owners. Self-service sign-up, claiming/creating listings, lead routing.

-- 'live' firms are public. 'pending' firms were submitted by an owner and wait for admin approval.
ALTER TABLE firms ADD COLUMN status TEXT NOT NULL DEFAULT 'live';
ALTER TABLE firms ADD COLUMN created_by INTEGER;

-- Who may edit a listing and see its leads. One row per (person, firm); the admin approves each one.
CREATE TABLE firm_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  firm_slug    TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  contact_name TEXT NOT NULL,
  job_title    TEXT,
  message      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at   TEXT,
  decided_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (user_id, firm_slug)
);
CREATE INDEX idx_members_firm ON firm_members (firm_slug, status);
CREATE INDEX idx_members_status ON firm_members (status, created_at);

-- Leads that came from a firm's own profile page are routed to that firm.
ALTER TABLE leads ADD COLUMN firm_slug TEXT;
CREATE INDEX idx_leads_firm ON leads (firm_slug, id);
UPDATE leads SET firm_slug = json_extract(payload, '$.firm')
 WHERE firm_slug IS NULL AND json_extract(payload, '$.firm') IN (SELECT slug FROM firms);

-- Open sign-up needs abuse limits: remember a hash of the requester's address and whether the link may create an account.
ALTER TABLE login_tokens ADD COLUMN signup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE login_tokens ADD COLUMN ip_hash TEXT;
CREATE INDEX idx_login_tokens_ip ON login_tokens (ip_hash, created_at);
