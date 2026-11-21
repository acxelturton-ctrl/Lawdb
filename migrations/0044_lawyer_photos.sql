-- Pictures of a firm's lawyers, added by the firm (or an admin) from the Lawyers part of the profile editor. The files live in the private R2 bucket
-- (binding IMAGES, key img/<id>) next to the firm pictures and are served by the same address, /img/<id> (src/routes/images.js). Kept in a table of their own
-- so a lawyer's picture never appears among the firm's photos. The picture is tied to the lawyer by the lawyer's address on the firm's Lawyers page.
CREATE TABLE lawyer_photos (
  id           TEXT PRIMARY KEY,             -- random, 24 hex characters; also the public address /img/<id>
  firm_slug    TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  lawyer_slug  TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  uploaded_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lawyer_photos_firm ON lawyer_photos (firm_slug, lawyer_slug);
