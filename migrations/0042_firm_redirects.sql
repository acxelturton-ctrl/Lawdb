-- Old page addresses of firms whose address was changed (see src/lib/firm-slug.js).
-- /firms/<old_slug> and the firm's story pages answer with a permanent (301) redirect to the new address, so links, bookmarks and search engines follow.
-- An address that becomes a firm's live address again (changed back) is removed from here.
CREATE TABLE firm_redirects (
  old_slug   TEXT PRIMARY KEY,
  new_slug   TEXT NOT NULL,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_redirects_new ON firm_redirects (new_slug);
