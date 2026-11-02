-- Lalande Personal Injury & Long-Term Disability Lawyers moved their Hamilton office; the firm asked for the listing to be updated.
-- New address: 25 Main St W Ste 1616, Hamilton, ON L8P 1H1 (map pin: the building at 25 Main St W).
-- This runs once and only while the listing still has the old address, so an edit made in the admin or by the firm in the meantime is never overwritten.
-- The Google place link (mapsUrl) is left as it is: it points at the firm's Google listing, which the firm updates itself.
UPDATE firms
SET lat = 43.2554209,
    lng = -79.8709642,
    data = json_set(data,
      '$.address', '25 Main St W Ste 1616, Hamilton, ON L8P 1H1',
      '$.lat', 43.2554209,
      '$.lng', -79.8709642,
      '$.dirUrl', 'https://www.google.com/maps/dir/?api=1&destination=25+Main+St+W+Ste+1616%2C+Hamilton%2C+ON+L8P+1H1'),
    updated_at = datetime('now')
WHERE slug = 'lalande-personal-injury-long-term-disability-lawyers'
  AND json_extract(data, '$.address') = '1 King St W Ste 1705, Hamilton, ON L8P 1A1';
