-- LawDB initial schema.
-- "data" holds the full original record as JSON, so the API returns exactly the
-- shape the website already uses. Columns beside it exist for filtering/sorting.

CREATE TABLE firms (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  province     TEXT NOT NULL,
  region       TEXT,
  featured     INTEGER NOT NULL DEFAULT 0,
  rating       REAL,
  review_count INTEGER,
  lat          REAL,
  lng          REAL,
  data         TEXT NOT NULL,   -- full firm record (JSON)
  hours        TEXT,            -- opening hours (JSON), nullable
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_firms_province ON firms (province);
CREATE INDEX idx_firms_city ON firms (province, city);

CREATE TABLE blog_posts (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  city       TEXT,
  province   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,     -- full post record (JSON)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_blog_province ON blog_posts (province);

-- Every form submission is stored here (contact, list-your-firm, book-a-call).
CREATE TABLE leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  form       TEXT NOT NULL,
  name       TEXT,
  email      TEXT,
  phone      TEXT,
  message    TEXT,
  payload    TEXT NOT NULL,     -- everything submitted (JSON)
  page       TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_created ON leads (created_at);
CREATE INDEX idx_leads_status ON leads (status);
