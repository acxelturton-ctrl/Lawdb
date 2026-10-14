-- "Latest from the firm's blog": headline, date, a short excerpt and a link to the firm's own site,
-- read from the firm's public RSS/Atom feed. We never store or show full articles.

CREATE TABLE firm_feeds (
  firm_slug       TEXT PRIMARY KEY REFERENCES firms (slug) ON DELETE CASCADE,
  feed_url        TEXT,                       -- discovered from the firm's website, or entered by hand
  source          TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  enabled         INTEGER NOT NULL DEFAULT 1, -- 0 = switched off (by the firm or the admin); stays off
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error', 'none')),
  last_checked_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE firm_posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_slug    TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  guid         TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at TEXT,
  excerpt      TEXT NOT NULL,                 -- plain text, at most 600 characters
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (firm_slug, guid)
);
CREATE INDEX idx_posts_firm ON firm_posts (firm_slug, published_at);
