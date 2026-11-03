-- Every firm's page is drawn from the database, the same way, whenever the firm was listed: there is no longer a second, hand-built kind of page, and nothing reads
-- firms.page_mode any more. (In production every firm was already 'dynamic'.) This sets any left-over value to match so the column never tells a different story;
-- it is kept only because dropping a column from a table this size is not worth the risk.
UPDATE firms SET page_mode = 'dynamic' WHERE page_mode != 'dynamic';
