-- Every firm's blog is on LawDB News, not only Featured firms'. Before, feeds found automatically for non-Featured firms were "page only"
-- (cards on the firm's own page, nothing on News). Their story pages stay out of search engines (noindex, not in the story sitemap) until the
-- firm is Featured; see src/lib/stories.js. An admin can still hold a firm to its own page with PATCH /api/admin/firms/:slug/feed {pageOnly}.
UPDATE firm_feeds SET page_only = 0 WHERE page_only = 1;
