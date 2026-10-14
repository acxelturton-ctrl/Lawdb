-- Guide pages now live at clean addresses (no ".html"); the stored guide list follows.
UPDATE blog_posts SET data = replace(data, '.html"', '"') WHERE data LIKE '%grow-your-practice/%.html"%';

-- Every page address changed (no ".html"); what we recorded about the old addresses is no longer useful. The next Search Console run starts again from the new sitemap.
DELETE FROM search_pages;
DELETE FROM site_settings WHERE key = 'gsc_cursor';
