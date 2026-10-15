-- Enquiries dashboard: a private note on each enquiry, when the firm first saw it, and when the weekly summary email last went out.
ALTER TABLE leads ADD COLUMN note TEXT;
ALTER TABLE leads ADD COLUMN seen_at TEXT;
ALTER TABLE firm_members ADD COLUMN digest_at TEXT;
CREATE INDEX idx_leads_firm_status ON leads (firm_slug, status, id);
