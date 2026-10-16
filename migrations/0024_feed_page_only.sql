-- Blog cards for every firm. Featured firms (and any feed set up by hand) appear on LawDB News and get story pages, as before.
-- Feeds found automatically for other firms are "page only": the cards show on the firm's own page and link to the firm's own article.
ALTER TABLE firm_feeds ADD COLUMN page_only INTEGER NOT NULL DEFAULT 0;
