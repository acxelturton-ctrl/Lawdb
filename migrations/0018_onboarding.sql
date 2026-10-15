-- The short welcome steps after sign-up: name, location, current role, and what brings the person to LawDB.
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN province TEXT;
ALTER TABLE users ADD COLUMN job_title TEXT;
ALTER TABLE users ADD COLUMN employer TEXT;
ALTER TABLE users ADD COLUMN goal TEXT CHECK (goal IS NULL OR goal IN ('find', 'clients', 'staff', 'follow', 'study', 'other'));
ALTER TABLE users ADD COLUMN onboarded_at TEXT;
-- Existing people are not sent through the steps.
UPDATE users SET onboarded_at = datetime('now');
