-- Lalande Personal Injury & Long-Term Disability Lawyers sent new pictures for its listing (the LawDB owner supplied them):
--  - logo: a black square with the white L from the firm's wordmark. It fills the whole round badge (logoBg), with no white around it;
--  - cover: the firm's black LALANDE / Personal Injury Lawyers wordmark as a banner (placed high, so the round logo does not cover it);
--  - company picture (shown under the description): the office photo, in place of the old share picture from injured.ca.
-- The files are in images/logos, images/hero and images/bio. This runs once, and only while the listing still has the logo that was uploaded in the
-- admin (img/05ee89385376ed1209690de2) and no cover, so a picture the firm or an admin has put there since is never replaced.
-- That old logo upload is taken off the firm's picture list too, as when a logo is replaced in the admin, so a later picture edit cannot bring it back.
UPDATE firms
SET data = json_remove(json_set(data,
      '$.type', 'logo',
      '$.src', 'images/logos/lalande-personal-injury-long-term-disability-lawyers-black.png',
      '$.logoBg', '#000000',
      '$.heroImage', 'images/hero/lalande-personal-injury-long-term-disability-lawyers.webp',
      '$.heroPos', 'center top',
      '$.bioImage', 'images/bio/lalande-personal-injury-long-term-disability-lawyers-office.webp'), '$.origSrc'),
    updated_at = datetime('now')
WHERE slug = 'lalande-personal-injury-long-term-disability-lawyers'
  AND json_extract(data, '$.src') = 'img/05ee89385376ed1209690de2'
  AND json_extract(data, '$.heroImage') IS NULL;

DELETE FROM firm_images
WHERE firm_slug = 'lalande-personal-injury-long-term-disability-lawyers' AND kind = 'logo' AND id = '05ee89385376ed1209690de2'
  AND EXISTS (SELECT 1 FROM firms WHERE slug = 'lalande-personal-injury-long-term-disability-lawyers'
              AND json_extract(data, '$.src') = 'images/logos/lalande-personal-injury-long-term-disability-lawyers-black.png');
