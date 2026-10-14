-- Firm pictures. The files live in the private R2 bucket (binding IMAGES, key img/<id>);
-- this table decides what is shown, in what order, and who added it.
CREATE TABLE firm_images (
  id           TEXT PRIMARY KEY,             -- random, 24 hex characters; also the public address /img/<id>
  firm_slug    TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('logo', 'cover', 'photo')),
  alt          TEXT,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  uploaded_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_images_firm ON firm_images (firm_slug, kind, created_at);
