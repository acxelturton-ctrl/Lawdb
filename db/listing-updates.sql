-- Hand-written listing fixes for firms already in the database. Each statement only changes a row that still has the
-- value it was written against, so running this file twice changes nothing the second time.
-- Rocky Mountain German Law Ltd.: the listing had family, real estate and business law; its site describes German
-- citizenship, inheritance and tax work, so the listing now shows immigration and wills & estates.
UPDATE firms SET data = json_set(data, '$.tags', json('["Immigration","Wills & Estates"]'), '$.caseTypes', json('["immigration","wills"]'), '$.blurb', 'Immigration / Wills & Estates in Calgary. Rated 5.0 from 24 Google reviews.'), updated_at = datetime('now') WHERE slug = 'rocky-mountain-german-law-ltd-calgary' AND data LIKE '%"Family Law"%';

-- Kaysi Fagan: the listing's phone number was not a valid number (+1 035 171 7773); the firm's site (kaysifagan.com) lists 587-391-5735.
UPDATE firms SET data = json_set(data, '$.phone', '+15873915735'), updated_at = datetime('now') WHERE slug = 'kaysi-fagan-calgary' AND json_extract(data, '$.phone') = '+10351717773';
