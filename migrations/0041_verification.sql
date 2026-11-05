-- Verified by LawDB.
--
-- A firm asks to be verified (or the admin starts one), the admin looks the lawyer up in the province's public law society directory, and records what
-- was checked and when. The public page shows only that the firm is verified, the date, what was checked and a link to the law society's directory.
-- It never shows the name or number given here, and it is not an endorsement: it says a check was made on that date, nothing about the lawyer's work.
--   requested  the firm asked (or the admin began it); nothing is shown on the page
--   verified   the admin made the checks below; the page shows the badge
-- One row per firm. Removing a verification deletes the row (the audit log keeps the history).
CREATE TABLE firm_verifications (
  firm_slug            TEXT PRIMARY KEY REFERENCES firms (slug) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'verified')),
  law_society          TEXT NOT NULL,                       -- ON, QC, BC, AB or MB (see src/lib/verification.js)
  registrant_name      TEXT NOT NULL,                       -- the lawyer who is registered, as the firm gave it; private
  registration_ref     TEXT,                                -- the law society number, if the firm gave it; private
  requested_by         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  requested_at         TEXT NOT NULL DEFAULT (datetime('now')),
  checked_identity     INTEGER NOT NULL DEFAULT 0,          -- the person who manages the profile is who they say they are
  checked_registration INTEGER NOT NULL DEFAULT 0,          -- the lawyer is in the law society's directory
  checked_office       INTEGER NOT NULL DEFAULT 0,          -- the office address and phone match
  verified_by          INTEGER REFERENCES users (id) ON DELETE SET NULL,
  verified_at          TEXT,
  note                 TEXT                                 -- the admin's own note; private
);
CREATE INDEX idx_verifications_status ON firm_verifications (status, requested_at);
