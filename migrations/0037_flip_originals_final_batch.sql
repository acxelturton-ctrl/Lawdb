-- The last hand-built firm pages -> database pages. The owner asked for every firm that still had the old layout to move to the new one.
-- On the live site these four were the only ones left (the other originals moved in batches 1 to 4; Blottman Legal Services was already switched on).
-- They give up their hand-written "Questions to ask before you call..." FAQ and guide text: the database page shows the guide only for Featured firms.
-- The hand-built file stays in the repository and is what the site serves if the database cannot be read.
-- To undo one firm, set its Profile page style to "Original hand-built page" in the admin (Firms > the firm > Basic Information).
-- To undo them all: UPDATE firms SET page_mode = 'static' WHERE slug IN (the same list).
UPDATE firms SET page_mode = 'dynamic', updated_at = datetime('now') WHERE page_mode = 'static' AND slug IN (
  'blottman-legal-services',
  'excelsior-avocats',
  'gagan-nahal-criminal-lawyer',
  'gupta-law-firm',
  'oatley-vigmond-personal-injury-lawyers-llp'
);
