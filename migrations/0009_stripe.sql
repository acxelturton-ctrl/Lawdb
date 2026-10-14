-- Featured subscriptions paid through Stripe. Stripe tells us (signed webhook) when a payment completes or a
-- subscription changes; a verified payment from an approved owner makes the firm Featured, the end of the
-- subscription takes it away again. Anything we cannot match to an owner waits for the admin ('needs_review').

CREATE TABLE firm_subscriptions (
  subscription_id      TEXT PRIMARY KEY,         -- Stripe's sub_...
  customer_id          TEXT,
  firm_slug            TEXT REFERENCES firms (slug) ON DELETE SET NULL,
  payer_email          TEXT,
  status               TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'needs_review', 'dismissed')),
  amount_cents         INTEGER,
  currency             TEXT,
  period_end           TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  featured_before      INTEGER NOT NULL DEFAULT 0, -- firm was already Featured (e.g. set by hand) when this started: never undone
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subs_firm ON firm_subscriptions (firm_slug, status);
CREATE INDEX idx_subs_status ON firm_subscriptions (status, created_at);

-- Every Stripe event we have handled, so a repeated delivery is never applied twice.
CREATE TABLE stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
