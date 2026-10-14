-- Member ratings: a signed-in person rates a firm from 1 to 5 stars and may add a short comment. One rating per person per firm (rating again replaces it).
-- Stars count straight away; a comment waits for an admin's approval before anyone else sees it. An admin can hide any rating.
CREATE TABLE firm_ratings (
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  firm_slug      TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  stars          INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment        TEXT,
  comment_status TEXT NOT NULL DEFAULT 'none' CHECK (comment_status IN ('none', 'pending', 'approved', 'rejected')),
  status         TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'hidden')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, firm_slug)
);
CREATE INDEX idx_ratings_firm ON firm_ratings (firm_slug, status);
CREATE INDEX idx_ratings_pending ON firm_ratings (comment_status, updated_at);
