-- Admin extras: the Future projects list, the daily journal and the record of what shipped.
--   projects  the owner's list of big things to do (edited in the admin Projects tab). source: 'you' = you asked or agreed, 'claude' = an idea Claude suggested.
--   ship_log  one row per merged pull request, written when the site deploys (scripts/record-deploy.mjs), so the journal knows what shipped on which day.
--   journal   one short entry per Toronto day, written by the nightly job (src/lib/journal.js); the owner can add a note to any day.
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'you' CHECK (source IN ('you', 'claude')),
  asked_on   TEXT,
  status     TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'next', 'doing', 'done')),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  done_at    TEXT
);
CREATE TABLE ship_log (
  pr    INTEGER PRIMARY KEY,
  day   TEXT NOT NULL,
  at    TEXT NOT NULL,
  title TEXT NOT NULL
);
CREATE INDEX idx_ship_log_day ON ship_log (day);
CREATE TABLE journal (
  day        TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Move the rest of the hand-built firm pages onto database pages', 'You said yes on Oct 19: it is better for scalability and SEO. Batch 1 (100 firms) is live. Three batches of about 100 remain, the busiest firms last. Each batch waits until Search Console shows the one before it is healthy (about a week).', 'you', '2026-10-19', 'next', 10);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Launch the Facebook ads', 'Six 15-second videos are made. Still to do: a landing page for each ad pitch, and ad links tagged with utm_source=facebook so the Traffic tab shows which ads bring firms. The ad account, budget and audience are yours to set up.', 'you', '2026-10-16', 'next', 20);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Beat the big directories on SEO with ideas nobody uses', 'Ongoing. Done so far: one clean address per page, a guard that keeps thin pages out of Google, firm pages built from real facts on each firm''s own site, city and practice-area pages, and News from the firms'' blogs. The Claude ideas further down this page are candidates for what to try next.', 'you', '2026-10-16', 'doing', 30);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Grow coverage without thin pages', 'You asked for 50 more firms per province on Oct 18, then said on Oct 19 that 1,000 is already a lot and you don''t want Google to punish thin pages. On Oct 20 Quebec (165) and Manitoba (59) were thin next to Ontario (571). Add firms only when each page can be high quality (own logo, real description, hours), and add provinces once the Traffic tab shows demand.', 'you', '2026-10-18', 'idea', 40);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Reach $10K a month, then $100K', 'At $89 a month, $10K needs about 113 Featured firms and $100K about 1,124. On Oct 20, 6 firms were Featured. The path: firms claim their listings (built), outreach and ads bring them in, and the enquiries dashboard proves Featured pays off.', 'you', '2026-10-14', 'idea', 50);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Founder LinkedIn posts about building LawDB', 'You want a progress blog so people get to know the owner. The Journal tab now collects what shipped each day, which is the raw material for a short post after each big milestone.', 'you', '2026-10-16', 'idea', 60);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Pages for the towns people search that we have no page for', 'The Traffic tab now lists towns people typed with no firms (this is where the Keswick problem came from). After a few weeks of data, add firms and pages for the top ones.', 'claude', NULL, 'idea', 70);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Speed check of the home page and firm pages', 'The home page loads two big photos, the map and fonts. Measure on a phone and fix the biggest delays; Google ranks slow pages lower.', 'claude', NULL, 'idea', 80);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('Claim-your-listing invites and an outreach tracker', 'Revenue comes from firms claiming and upgrading. Build one-click invite emails and a simple list in admin of who you called, emailed and heard back from. Canada''s anti-spam law (CASL) limits cold emails, so you choose who gets contacted.', 'claude', NULL, 'idea', 90);
INSERT INTO projects (title, detail, source, asked_on, status, sort) VALUES ('French pages for Quebec', 'Most Quebec searches and firms are in French, so French pages would reach people the English site cannot. A big job (translation and addresses), worth it only if Quebec becomes a priority.', 'claude', NULL, 'idea', 100);
