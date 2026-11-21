// A firm's Articles page (/firms/<slug>/articles): the firm's own blog articles, as LawDB News already shows them, each linking to its LawDB story page.
//
// Every firm has its articles on a page of their own, never at the bottom of the Overview. When the tab exists (one rule, used by the page, the route and the sitemap):
//   - the firm has at least MIN_ARTICLES articles to show: fewer is not a page worth an address;
//   - and it is a tab for everybody, but only a FEATURED firm's page is offered to search engines. Every firm's articles are on LawDB News and have story pages, but
//     only a Featured firm's story pages are indexable (STORY_INDEXABLE_SQL in src/lib/stories.js): a page of excerpts that lead to pages search engines are told to
//     skip is the thin page the site avoids, so a Basic firm's Articles page is `noindex, follow` and stays out of the sitemap (see articlesIndexable). That is what
//     remains of the Featured benefit (FEATURED_PERKS): the articles are found on Google.
// A firm an admin holds to its own page (page_only, Basic) has no LawDB story pages, so its cards go straight to the firm's own article.
// What counts as an article is what the News page counts: a real article with its own picture (no headshot, logo, template or "welcomes" announcement), not
// an untouched WordPress "Hello world". At most MAX_ARTICLES (the stories kept per firm), newest first.
import { storyPath, isPlaceholderTitle } from './stories.js';
import { isBlogPhotoPost } from './post-photos.js';
import { plain } from './feeds.js';

export const MIN_ARTICLES = 3;
export const MAX_ARTICLES = 20;

const FROM = 'FROM firm_posts p JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1 JOIN firms f ON f.slug = p.firm_slug AND f.status = \'live\'';
const WITH_PICTURE = "p.image_url IS NOT NULL AND p.image_url != ''";
// 1 for a Basic firm an admin holds to its own page: LawDB has no story pages for it (the story route needs page_only = 0 or Featured).
const PAGE_ONLY = '(ff.page_only = 1 AND f.featured = 0) AS pageOnly';

// rows: { id, title, url, publishedAt, excerpt, image, pageOnly? }, newest first. Returns the ones the tab shows, each with the address of its LawDB story page
// (none for a page-only firm: its card links to the firm's own article).
export function shownArticles(rows, firmSlug) {
  const seen = new Set();
  return (rows || [])
    .filter((r) => !isPlaceholderTitle(r.title))
    .filter(isBlogPhotoPost)
    .filter((r) => (seen.has(r.url) ? false : seen.add(r.url)))
    .slice(0, MAX_ARTICLES)
    // some firms' previews still carry raw entities ("&middot;", "&reg;"): shown as the characters they stand for. The story address is made from the stored title, so it is the canonical one.
    .map((r) => ({ id: r.pageOnly ? null : r.id, title: plain(r.title) || r.title, url: r.url, publishedAt: r.publishedAt, excerpt: plain(r.excerpt), image: r.image, ...(r.pageOnly ? {} : { storyHref: storyPath(firmSlug, r.id, r.title) }) }));
}

// The Articles tab: every firm with enough articles has it.
export const articlesTabOn = (articles) => Array.isArray(articles) && articles.length >= MIN_ARTICLES;

// Only a Featured firm's Articles page is offered to search engines (its story pages are; nobody else's are). Everyone else's is noindex, follow and not in the sitemap.
export const articlesIndexable = (firm) => !!(firm && firm.featured);

// The articles of one firm.
export async function listArticles(env, firmSlug) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image, ${PAGE_ONLY} ${FROM} WHERE p.firm_slug = ? AND ${WITH_PICTURE} ORDER BY p.published_at DESC, p.id DESC LIMIT 60`
  ).bind(firmSlug).all();
  return shownArticles(results, firmSlug);
}

// The firms (by address) whose Articles page is offered to search engines, for the sitemap: every live Featured firm with enough articles, by the same rule as the page.
export async function indexableArticleSlugs(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.firm_slug AS firmSlug, p.id, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image ${FROM} AND f.featured = 1 WHERE ${WITH_PICTURE} ORDER BY p.firm_slug, p.published_at DESC, p.id DESC`
  ).all();
  const by = new Map();
  for (const r of results) { if (!by.has(r.firmSlug)) by.set(r.firmSlug, []); by.get(r.firmSlug).push(r); }
  const out = new Set();
  for (const [slug, rows] of by) if (articlesTabOn(shownArticles(rows, slug))) out.add(slug);
  return out;
}
