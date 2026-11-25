-- Lead Marketplace: verified firms unlock exclusive inquiries with prepaid credits (see docs/ARCHITECTURE.md, "Lead Marketplace").
-- A credit is one Canadian dollar. The whole feature is dark until the admin opens it (marketplace_config key "open").

-- Settings the admin can change without a deploy: whether it is open, prices, the price schedule, the Featured head start, the review list, the alert waves.
-- Only keys the admin has set are stored; src/lib/marketplace.js has the defaults.
CREATE TABLE marketplace_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,          -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);

-- A firm's place in the marketplace: its credit balance and what it wants to see. A row appears when an owner of a live firm first opens the Lead Marketplace tab.
-- Empty practice_areas / provinces mean "the firm's own" (its listed practice areas, its province). The balance can never go below zero.
CREATE TABLE marketplace_firms (
  firm_slug      TEXT PRIMARY KEY REFERENCES firms (slug) ON DELETE CASCADE,
  balance        INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  practice_areas TEXT NOT NULL DEFAULT '',
  provinces      TEXT NOT NULL DEFAULT '',
  cities         TEXT NOT NULL DEFAULT '',
  alerts         TEXT NOT NULL DEFAULT 'instant' CHECK (alerts IN ('instant', 'daily', 'off')),
  digest_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per inquiry. `summary_public` is all a firm sees before paying (made from a fixed vocabulary, never from the person's words); `details` holds the name,
-- email, phone and description, and is cleared when the inquiry expires or is rejected (and 12 months after it was unlocked). `consent` is the record of what the
-- person agreed to (version, exact wording, time, form, browser, hashed address). `firm_slug` is the buyer. `source_firm` is the firm a firm-page enquiry was sent to
-- (it already has it, so it is never offered that inquiry again).
CREATE TABLE marketplace_leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL CHECK (source IN ('general', 'firm-page')),
  source_lead_id INTEGER,
  source_firm    TEXT,
  practice_area  TEXT NOT NULL,
  province       TEXT NOT NULL,
  city           TEXT NOT NULL DEFAULT '',
  urgency        TEXT NOT NULL DEFAULT 'unspecified',
  summary_public TEXT NOT NULL,
  details        TEXT,
  consent        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('held', 'approved', 'unlocked', 'expired', 'rejected')),
  hold_reason    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  expires_at     TEXT,
  firm_slug      TEXT REFERENCES firms (slug) ON DELETE SET NULL,
  unlocked_at    TEXT,
  price_paid     INTEGER,
  charge_pending INTEGER NOT NULL DEFAULT 0,
  alert_wave     INTEGER NOT NULL DEFAULT 0,
  alert_next_at  TEXT,
  ip_hash        TEXT
);
CREATE INDEX idx_mpl_board ON marketplace_leads (status, province, practice_area, approved_at);
CREATE INDEX idx_mpl_buyer ON marketplace_leads (firm_slug, unlocked_at);
CREATE INDEX idx_mpl_alerts ON marketplace_leads (status, alert_next_at);
CREATE UNIQUE INDEX uq_mpl_source ON marketplace_leads (source_lead_id) WHERE source_lead_id IS NOT NULL;

-- Every top-up, unlock, refund and grant, never changed or removed. A firm's balance is the sum of its rows (marketplace_firms.balance is the same number, kept in the
-- same batch so an unlock can check it in one statement). One unlock and one refund per inquiry, one row per Stripe payment: a repeat cannot charge twice.
CREATE TABLE marketplace_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_slug     TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('topup', 'unlock', 'refund', 'promo', 'adjust')),
  amount        INTEGER NOT NULL,
  lead_id       INTEGER,
  stripe_ref    TEXT,
  note          TEXT,
  actor_user_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mpledger_firm ON marketplace_ledger (firm_slug, id);
CREATE UNIQUE INDEX uq_mpledger_unlock ON marketplace_ledger (lead_id) WHERE type = 'unlock';
CREATE UNIQUE INDEX uq_mpledger_refund ON marketplace_ledger (lead_id) WHERE type = 'refund';
CREATE UNIQUE INDEX uq_mpledger_stripe ON marketplace_ledger (stripe_ref) WHERE stripe_ref IS NOT NULL;
CREATE UNIQUE INDEX uq_mpledger_welcome ON marketplace_ledger (firm_slug) WHERE note = 'Welcome credits';
CREATE TRIGGER mpledger_no_update BEFORE UPDATE OF type, amount, lead_id, stripe_ref, note, actor_user_id, created_at ON marketplace_ledger
BEGIN SELECT RAISE(ABORT, 'the marketplace ledger cannot be changed'); END;
CREATE TRIGGER mpledger_no_delete BEFORE DELETE ON marketplace_ledger
BEGIN SELECT RAISE(ABORT, 'the marketplace ledger cannot be changed'); END;

-- "Report bad lead": one report per unlocked inquiry, within 48 hours, decided by the admin (a refund is credit, only for clear junk).
CREATE TABLE marketplace_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER NOT NULL,
  firm_slug       TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('disconnected', 'spam', 'fake', 'other')),
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'denied')),
  resolved_by     INTEGER,
  resolved_at     TEXT,
  resolution_note TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_mpr_lead ON marketplace_reports (lead_id);
CREATE INDEX idx_mpr_status ON marketplace_reports (status, id);

-- Which firm was told about which inquiry, in which wave (never twice).
CREATE TABLE marketplace_alerts (
  lead_id   INTEGER NOT NULL,
  firm_slug TEXT NOT NULL,
  wave      INTEGER NOT NULL,
  sent_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lead_id, firm_slug)
) WITHOUT ROWID;
