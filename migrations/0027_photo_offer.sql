-- "Use your LinkedIn (or Google) photo?" When someone signs in with LinkedIn or Google, the provider sends the address of their profile picture.
-- We keep that address only until the person says yes (the picture is then copied into their own profile photo) or no (we remember the no and never ask again).
ALTER TABLE users ADD COLUMN photo_offer_url TEXT;
ALTER TABLE users ADD COLUMN photo_offer_provider TEXT;
ALTER TABLE users ADD COLUMN photo_offer_declined INTEGER NOT NULL DEFAULT 0;
