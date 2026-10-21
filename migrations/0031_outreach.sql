-- The Outreach desk (admin only): who the owner has contacted about listing, claiming or upgrading, where each conversation stands, and when to
-- follow up. Plain notes for the owner's own use; nothing here is shown on the public site or sent anywhere.
--   stage: connected (accepted a connection), messaged, replied, call (a call is booked or was held), agreed (said yes), not-now (not interested for now)
--   firm_slug: the firm's LawDB page when it is listed (the desk shows whether it has since been claimed or become Featured); firm_name is for firms that are not listed yet
CREATE TABLE outreach (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person       TEXT NOT NULL,
  firm_slug    TEXT,
  firm_name    TEXT NOT NULL DEFAULT '',
  channel      TEXT NOT NULL DEFAULT 'linkedin' CHECK (channel IN ('linkedin', 'phone', 'email', 'in-person', 'other')),
  link         TEXT NOT NULL DEFAULT '',
  stage        TEXT NOT NULL DEFAULT 'connected' CHECK (stage IN ('connected', 'messaged', 'replied', 'call', 'agreed', 'not-now')),
  note         TEXT NOT NULL DEFAULT '',
  follow_up    TEXT,
  last_contact TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE INDEX idx_outreach_follow ON outreach (follow_up);
CREATE INDEX idx_outreach_stage ON outreach (stage);

-- the "Claim-your-listing invites and an outreach tracker" idea on the Future projects page is now being worked on
UPDATE projects SET status = 'doing', updated_at = datetime('now') WHERE source = 'claude' AND status = 'idea' AND title LIKE 'Claim-your-listing invites%';
