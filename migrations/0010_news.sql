-- LawDB News: a page of blog cards from member firms. Blogs are read either from an RSS/Atom feed or, for WordPress sites,
-- from the site's public post list (wp-json). Site settings let the admin narrow the page to Featured members only.
ALTER TABLE firm_feeds ADD COLUMN kind TEXT NOT NULL DEFAULT 'rss' CHECK (kind IN ('rss', 'wp'));

CREATE TABLE site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 0 = show every firm that has blog cards switched on; 1 = only Featured firms (the plan for later).
INSERT INTO site_settings (key, value) VALUES ('news_featured_only', '0');

-- The blogs already known to work (checked by hand). Rows are added only for firms that exist, so a fresh database stays empty.
INSERT OR IGNORE INTO firm_feeds (firm_slug, feed_url, source, kind, enabled)
SELECT slug, 'https://barbarianlaw.ca/wp-json/wp/v2/posts?per_page=6&_fields=id,date,link,title,excerpt', 'manual', 'wp', 1 FROM firms WHERE slug = 'barbarian-law';
INSERT OR IGNORE INTO firm_feeds (firm_slug, feed_url, source, kind, enabled)
SELECT slug, 'https://www.weaversimmons.com/wp-json/wp/v2/posts?per_page=6&_fields=id,date,link,title,excerpt', 'manual', 'wp', 1 FROM firms WHERE slug = 'weaver-simmons-llp';
INSERT OR IGNORE INTO firm_feeds (firm_slug, feed_url, source, kind, enabled)
SELECT slug, 'https://nelliganlaw.ca/wp-json/wp/v2/posts?per_page=6&_fields=id,date,link,title,excerpt', 'manual', 'wp', 1 FROM firms WHERE slug = 'nelligan-law';
INSERT OR IGNORE INTO firm_feeds (firm_slug, feed_url, source, kind, enabled)
SELECT slug, 'https://www.danielbrownlaw.ca/wp-json/wp/v2/posts?per_page=6&_fields=id,date,link,title,excerpt', 'manual', 'wp', 1 FROM firms WHERE slug = 'daniel-brown-law-llp';
-- Blottman: found automatically from its website.
INSERT OR IGNORE INTO firm_feeds (firm_slug, enabled) SELECT slug, 1 FROM firms WHERE slug = 'blottman-legal-services';
