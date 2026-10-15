// GET /news: LawDB News, built from the database. Falls back to the static page if the database is unavailable.
import { renderNewsPage } from '../render/news-page.js';
import { dueFeeds, refreshFirmFeed } from '../lib/feeds.js';
import { storyPath } from '../lib/stories.js';

const ttlOf = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

export const getSetting = async (env, key, fallback = '') => {
  const r = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first();
  return r ? r.value : fallback;
};

// The page is a picture feed: every post with a picture, but only a few without one (the newest), so it never turns into a wall of text.
export const MAX_WITHOUT_PICTURE = 3;
export function limitWithoutPicture(posts, max = MAX_WITHOUT_PICTURE) {
  let plain = 0;
  return posts.filter((p) => p.image || ++plain <= max);
}

async function loadPosts(env) {
  const featuredOnly = (await getSetting(env, 'news_featured_only', '0')) === '1';
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.firm_slug AS firmSlug, json_extract(f.data, '$.name') AS firmName, f.featured AS featured, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image, json_extract(f.data, '$.src') AS logo
     FROM firm_posts p JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1 JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live'
     ${featuredOnly ? 'WHERE f.featured = 1' : ''}
     ORDER BY p.published_at DESC, p.id DESC LIMIT 60`
  ).all();
  const seen = new Set();
  return results.filter((r) => (seen.has(r.firmSlug + '|' + r.url) ? false : seen.add(r.firmSlug + '|' + r.url))).map((r) => ({ ...r, featured: !!r.featured, storyHref: storyPath(r.firmSlug, r.id, r.title) }));
}

export async function newsPage({ request, env, ctx }) {
  const url = new URL(request.url);
  const selected = (url.searchParams.get('firm') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const ttl = ttlOf(env);
  const key = new Request(`${url.origin}/news?firm=${selected}`, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  try {
    let posts = await loadPosts(env);
    // Blogs are read when someone visits, so the page fills itself: never-read or half-day-old blogs, a few per visit.
    const due = await dueFeeds(env);
    if (due.length) {
      const work = Promise.all(due.map((slug) => refreshFirmFeed(env, slug).catch((err) => console.error('news refresh failed', slug, err))));
      if (!posts.length) {
        // An empty page would be a poor first impression: wait (briefly) for the first posts.
        await Promise.race([work, new Promise((r) => setTimeout(r, 12000))]);
        posts = await loadPosts(env);
      } else ctx.waitUntil(work);
    }
    const firms = [...new Map(posts.map((p) => [p.firmSlug, { slug: p.firmSlug, name: p.firmName, logo: p.logo }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    const stats = { firms: firms.length, articles: limitWithoutPicture(posts).length, latest: posts[0]?.publishedAt || null };
    const shown = limitWithoutPicture(selected ? posts.filter((p) => p.firmSlug === selected) : posts);
    const res = new Response(renderNewsPage({ posts: shown, firms, stats, selected: firms.some((f) => f.slug === selected) ? selected : '' }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': ttl > 0 && posts.length ? `public, max-age=${ttl}` : 'no-cache', 'x-content-type-options': 'nosniff', 'x-lawdb-source': 'database' },
    });
    if (ttl > 0 && posts.length) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error('news page failed, serving static page', err);
    return env.ASSETS.fetch(request);
  }
}
