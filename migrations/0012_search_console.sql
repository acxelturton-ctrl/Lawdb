-- What Google says about our pages (from the Search Console URL Inspection API), one row per page, refreshed a batch at a time.
CREATE TABLE search_pages (
  url              TEXT PRIMARY KEY,
  verdict          TEXT,              -- PASS (on Google), NEUTRAL, FAIL, or NULL if the check failed
  coverage_state   TEXT,              -- Google's own wording, e.g. "Submitted and indexed", "Crawled - currently not indexed"
  indexing_state   TEXT,
  last_crawl_at    TEXT,
  google_canonical TEXT,
  error            TEXT,
  checked_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
