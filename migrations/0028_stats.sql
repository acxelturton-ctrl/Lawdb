-- First-party traffic counts that never track a person. One row per day, kind and label with a running count: no IP address, no browser
-- details, no cookie and no visitor id is stored, so there is nothing here that could be tied back to someone.
--   pv      page views, label = page address            visit   new visits (first page of a browser tab session)
--   entry   first page of a visit                       ref     where a visit came from (a website name, or "direct")
--   dev     mobile or desktop                           geo     country and province of a new visit, from Cloudflare's coarse location
--   utm     the utm_source of a campaign link           ev      clicks that matter: call, website, directions, follow, claim, cta-*
--   search  what kind of lawyer and where was searched  town    a town or words nobody has a page for yet, with the case type (kept 90 days)
--   noparse words from a search that matched nothing at all (kept 90 days)
CREATE TABLE stats_daily (
  day  TEXT NOT NULL,
  kind TEXT NOT NULL,
  k1   TEXT NOT NULL DEFAULT '',
  k2   TEXT NOT NULL DEFAULT '',
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, k1, k2)
) WITHOUT ROWID;
CREATE INDEX idx_stats_kind_day ON stats_daily (kind, day);
