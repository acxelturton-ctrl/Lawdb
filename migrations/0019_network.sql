-- "My network": when a member last looked at their feed (to show a dot when the firms they follow have posted something new).
ALTER TABLE users ADD COLUMN feed_seen_at TEXT;
-- Suggestions and the lists on follow pages read firms by place and rating.
CREATE INDEX IF NOT EXISTS idx_firms_live_city ON firms (status, city, province);
