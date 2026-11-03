-- Free month trial + the owner's analytics.
--
-- firm_stats_daily: the same kind of privacy-safe counters as stats_daily (no IP address, no cookie, no visitor id, nothing that could be tied
-- to a person), but kept PER FIRM, so a firm's dashboard reads only its own rows: about 30 days x a dozen labels, however many firms or visits
-- the site has. (stats_daily keeps the site-wide totals the owner's Traffic tab shows.)
--   pv       page views of the firm's page            visitor  browser-tab visits that looked at the page (once per tab session)
--   entry    visits that started on the page          ev       a button or link clicked: call, website, directions, book, message, email, social-*, ...
--   ref      where the view came from                 dev      mobile or desktop
--   geo      country and province of a new visit      utm      the utm_source of a campaign link
-- k is the label (the button, the website, "mobile", "CA|ON"); n is a running count for that day.
CREATE TABLE firm_stats_daily (
  firm_slug TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  metric    TEXT NOT NULL,
  k         TEXT NOT NULL DEFAULT '',
  n         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (firm_slug, day, metric, k)
) WITHOUT ROWID;
CREATE INDEX idx_firm_stats_day ON firm_stats_daily (day);

-- What we already counted per firm page before today (page views and clicks), so a dashboard opens with history instead of empty charts.
INSERT INTO firm_stats_daily (firm_slug, day, metric, k, n)
SELECT substr(s.k1, 8), s.day, 'pv', '', s.n
FROM stats_daily s
WHERE s.kind = 'pv' AND s.k1 LIKE '/firms/%' AND instr(substr(s.k1, 8), '/') = 0
  AND EXISTS (SELECT 1 FROM firms f WHERE f.slug = substr(s.k1, 8))
ON CONFLICT (firm_slug, day, metric, k) DO NOTHING;

INSERT INTO firm_stats_daily (firm_slug, day, metric, k, n)
SELECT substr(s.k2, 8), s.day, 'ev', s.k1, s.n
FROM stats_daily s
WHERE s.kind = 'ev' AND s.k2 LIKE '/firms/%' AND instr(substr(s.k2, 8), '/') = 0
  AND EXISTS (SELECT 1 FROM firms f WHERE f.slug = substr(s.k2, 8))
ON CONFLICT (firm_slug, day, metric, k) DO NOTHING;

-- One free month of Featured per firm, ever. No card is needed: it simply ends on its own, back to Basic, unless the firm subscribes.
--   active      running                                      ended       ran out, the firm is back to Basic
--   subscribed  the firm paid (before or during the trial)   kept        the admin made the firm Featured by hand during the trial
-- views/actions are the firm's own numbers during the trial, written when it ends, so the "here is what you got" email and the
-- admin's conversion figures never depend on counters that may be pruned later.
CREATE TABLE firm_trials (
  firm_slug  TEXT PRIMARY KEY REFERENCES firms (slug) ON DELETE CASCADE,
  started_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  source     TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'admin')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'subscribed', 'kept')),
  warned_at  TEXT,
  ended_at   TEXT,
  views      INTEGER,
  actions    INTEGER,
  enquiries  INTEGER
);
CREATE INDEX idx_trials_status ON firm_trials (status, ends_at);

-- The weekly "your week on LawDB" email: when the owner's last one went out, and a switch to turn it off.
ALTER TABLE firm_members ADD COLUMN report_at TEXT;
ALTER TABLE firm_members ADD COLUMN reports_off INTEGER NOT NULL DEFAULT 0;
