-- Following and saving: a signed-in person follows law firms (their listings) and saves stories. Private to the person; only the total number of
-- followers of a firm is ever shown. Removed when the account or the firm / story is removed.
CREATE TABLE follows (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  firm_slug  TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, firm_slug)
);
CREATE INDEX idx_follows_firm ON follows (firm_slug);

CREATE TABLE saved_stories (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id    INTEGER NOT NULL REFERENCES firm_posts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
