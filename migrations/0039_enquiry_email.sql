-- A Featured firm can have its enquiries sent to one more address (for example the intake desk), as well as to the people who manage the listing.
-- It lives in its own column, not in the firm's public data, so it never appears in the public firm list or on the page.
ALTER TABLE firms ADD COLUMN enquiry_email TEXT;
