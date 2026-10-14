-- Hardening: abuse limits on enquiries, recorded acceptance of the firm terms.
ALTER TABLE leads ADD COLUMN ip_hash TEXT;
CREATE INDEX idx_leads_ip ON leads (ip_hash, created_at);
ALTER TABLE firm_members ADD COLUMN terms_accepted_at TEXT;
