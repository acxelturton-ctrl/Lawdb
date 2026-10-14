-- Profile page support.
--   page_mode 'static'  : the original hand-built page in /firms/<slug>.html (all existing firms, unchanged)
--   page_mode 'dynamic' : rendered from the database by the Worker (new firms, and any firm switched over)
--   about               : the firm's written description. A column, not part of `data`, so the public firm list
--                         (firms_data.json, embedded in 65 pages) does not get heavier.
ALTER TABLE firms ADD COLUMN page_mode TEXT NOT NULL DEFAULT 'static';
ALTER TABLE firms ADD COLUMN about TEXT;
