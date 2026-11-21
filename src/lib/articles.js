// A firm's Articles page (/firms/<slug>/articles): the firm's own blog articles, as LawDB News already shows them, each linking to its LawDB story page.
//
// When the tab exists (one rule, used by the page, the route and the sitemap):
//   - the firm is FEATURED. Every firm's articles are on LawDB News and have story pages, but only a Featured firm's story pages are offered to search engines
//     (STORY_INDEXABLE_SQL in src/lib/stories.js): a page of excerpts that lead to pages search engines are told to skip is the thin page the site avoids, so a
//     Basic firm keeps its "Recent articles" on the Overview and no tab. This is also what makes the tab one of Featured's benefits (FEATURED_PERKS);
//   - and it has at least MIN_ARTICLES articles to show: fewer is not a page worth an address (the Overview already shows the latest few).
// What counts as an article is what the News page counts: a real article with its own picture (no headshot, logo, template or "welcomes" announcement), not
// an untouched WordPress "Hello world". At most MAX_ARTICLES (the stories kept per firm), newest first.
import { storyPath, isPlaceholderTitle } from './stories.js';
import { isBlogPhotoPost } from './post-photos.js';
import { plain } from './feeds.js';

export const MIN_ARTICLES = 3;
export const MAX_ARTICLES = 20;

const FROM = 'FROM firm_posts p JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1';
const WITH_PICTURE = "p.image_url IS NOT NULL AND p.image_url != ''";

// rows: { id, title, url, publishedAt, excerpt, image }, newest first. Returns the ones the tab shows, each with the address of its LawDB story page.
export function shownArticles(rows, firmSlug) {
  const seen = new Set();
  return (rows || [])
    .filter((r) => !isPlaceholderTitle(r.title))
    .filter(isBlogPhotoPost)
    .filter((r) => (seen.has(r.url) ? false : seen.add(r.url)))
    .slice(0, MAX_ARTICLES)
    // some firms' previews still carry raw entities ("&middot;", "&reg;"): shown as the characters they stand for. The story address is made from the stored title, so it is the canonical one.
    .map((r) => ({ id: r.id, title: plain(r.title) || r.title, url: r.url, publishedAt: r.publishedAt, excerpt: plain(r.excerpt), image: r.image, storyHref: storyPath(firmSlug, r.id, r.title) }));
}

// The Articles tab exists only for a Featured firm with enough articles.
export const articlesTabOn = (firm, articles) => !!(firm && firm.featured && Array.isArray(articles) && articles.length >= MIN_ARTICLES);

// The articles of one firm (call it only for a Featured firm: nobody else has the tab).
export async function listArticles(env, firmSlug) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image ${FROM} WHERE p.firm_slug = ? AND ${WITH_PICTURE} ORDER BY p.published_at DESC, p.id DESC LIMIT 60`
  ).bind(firmSlug).all();
  return shownArticles(results, firmSlug);
}

// The firms (by address) whose Articles tab exists, for the sitemap: every live Featured firm with enough articles, by the same rule as the page.
export async function articleTabSlugs(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.firm_slug AS firmSlug, p.id, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image ${FROM} JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live' AND f.featured = 1 WHERE ${WITH_PICTURE} ORDER BY p.firm_slug, p.published_at DESC, p.id DESC`
  ).all();
  const by = new Map();
  for (const r of results) { if (!by.has(r.firmSlug)) by.set(r.firmSlug, []); by.get(r.firmSlug).push(r); }
  const out = new Set();
  for (const [slug, rows] of by) if (shownArticles(rows, slug).length >= MIN_ARTICLES) out.add(slug);
  return out;
}
