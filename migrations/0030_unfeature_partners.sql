-- Only the firms LawDB has a commission arrangement with (Blottman Legal Services and Barbarian Law) are marked Featured.
-- The other four firms that were marked Featured when the directory launched (no subscription, no owner) go back to a basic listing.
-- This runs once: a firm that pays for Featured later is switched on by the Stripe webhook and is not touched again.
UPDATE firms SET featured = 0, data = json_set(data, '$.featured', json('false')), updated_at = datetime('now')
WHERE featured = 1 AND slug IN ('daniel-brown-law-llp', 'nelligan-law', 'amlea-avocats', 'gagan-nahal-criminal-lawyer');
