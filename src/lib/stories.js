// Every blog card has its own LawDB page: /news/<firm>/<headline-words>-<id>. The id makes the address stable and unique;
// the words are for people and search engines (a wrong or old wording redirects to the right one).
export const slugify = (s) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'story';

export const storyPath = (firmSlug, id, title) => `/news/${firmSlug}/${slugify(title)}-${id}`;

export function parseStoryPath(pathname) {
  const m = /^\/news\/([a-z0-9][a-z0-9-]*)\/([a-z0-9-]*?)-?(\d{1,12})\/?$/.exec(pathname);
  return m ? { firmSlug: m[1], slug: m[2], id: Number(m[3]) } : null;
}

// Every firm's blog is on LawDB News, but a story page is offered to search engines (indexed, in the story sitemap) only for Featured firms and
// feeds an admin added by hand. Everyone else's story pages work and can be shared, yet are noindex: they are excerpts of articles that live on
// the firm's own site, and thousands of them would weigh down the site's quality.
export const STORY_INDEXABLE_SQL = "(f.featured = 1 OR (ff.source = 'manual' AND ff.page_only = 0))";
export const isIndexableStory = (r) => !!(r.featured || r.source === 'manual');

// A WordPress site's untouched first post is not news.
export const isPlaceholderTitle = (t) => /^\s*(hello,? world!?|sample page|test( post)?)\s*$/i.test(String(t || ''));

// Offices of one firm (the same website) often share one blog, so the same article would be listed once per office.
// In the all-firms view each article appears once, under the firm record that was added first.
export function dedupeSameSite(rows) {
  const keyOf = (r) => `${r.website ? String(r.website).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '') : 'firm:' + r.firmSlug}|${r.url}`;
  const first = new Map();
  for (const r of rows) { const k = keyOf(r); if (!first.has(k) || r.id < first.get(k).id) first.set(k, r); }
  return rows.filter((r) => first.get(keyOf(r)) === r);
}
