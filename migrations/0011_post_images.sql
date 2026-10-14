-- Blog cards can show the picture the firm chose for the article (its featured image). Only the address is kept, never the file:
-- the picture is loaded from the firm's own website or its image host, and a card without a working picture simply shows no picture.
ALTER TABLE firm_posts ADD COLUMN image_url TEXT;
