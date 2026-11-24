-- Featured LAWYER subscriptions ($99 / month) paid through Stripe. Same webhook as the firm plan: a payment whose checkout link names
-- "lawyer:<firm slug>:<lawyer slug>" and comes from an approved owner of that firm switches the lawyer's Featured listing on; the end of the
-- subscription switches it off. Anything else waits for the admin ('needs_review'), who can still use "Make Featured lawyer" by hand.

CREATE TABLE lawyer_subscriptions (
  subscription_id      TEXT PRIMARY KEY,         -- Stripe's sub_...
  customer_id          TEXT,
  firm_slug            TEXT REFERENCES firms (slug) ON DELETE SET NULL,
  lawyer_slug          TEXT,
  payer_email          TEXT,
  status               TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'needs_review', 'dismissed')),
  amount_cents         INTEGER,
  currency             TEXT,
  period_end           TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  featured_before      INTEGER NOT NULL DEFAULT 0, -- the lawyer was already Featured (set by hand) when this started: never undone
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lsubs_firm ON lawyer_subscriptions (firm_slug, lawyer_slug, status);
