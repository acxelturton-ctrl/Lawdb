-- Firms with several offices: one page per office (so each office shows in its own city and on its own map pin), and ONE Featured plan for all of them.
--   main_slug       the listing that holds the plan (its owner pays, starts the free month, and so on)
--   location_slug   an extra office page of that firm; its Featured flag follows the main listing's (src/lib/locations.js keeps them in step)
-- A location cannot be a main and a main cannot be a location, so there is one level only. Removing a firm's page removes its links; the other pages stay.
CREATE TABLE firm_locations (
  location_slug TEXT PRIMARY KEY REFERENCES firms (slug) ON DELETE CASCADE,
  main_slug     TEXT NOT NULL REFERENCES firms (slug) ON DELETE CASCADE,
  created_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (location_slug <> main_slug)
);
CREATE INDEX idx_locations_main ON firm_locations (main_slug);
