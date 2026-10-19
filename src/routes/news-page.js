// GET /news: LawDB News, built from the database. Falls back to the static page if the database is unavailable.
import { renderNewsPage } from '../render/news-page.js';
import { dueFeeds, refreshFirmFeed } from '../lib/feeds.js';
import { storyPath, isIndexableStory } from '../lib/stories.js';

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

// A firm's posts show on News unless an admin held it to its own page (page_only); Featured firms always show.
const VISIBLE = `FROM firm_posts p JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1 JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live' AND (ff.page_only = 0 OR f.featured = 1)`;
export const PER_FIRM = 3; // in the all-firms view, so one busy blog never fills the page
export const SHOWN = 60;

async function loadPosts(env, featuredOnly, firm = '') {
  const where = [featuredOnly ? 'f.featured = 1' : '', firm ? 'p.firm_slug = ?' : ''].filter(Boolean);
  const stmt = env.DB.prepare(
    `SELECT p.id, p.firm_slug AS firmSlug, json_extract(f.data, '$.name') AS firmName, f.featured AS featured, ff.source AS source, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image, json_extract(f.data, '$.src') AS logo
     ${VISIBLE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.published_at DESC, p.id DESC LIMIT ${firm ? SHOWN : 600}`
  );
  const { results } = await (firm ? stmt.bind(firm) : stmt).all();
  const seen = new Set();
  const perFirm = new Map();
  const rows = results
    .filter((r) => (seen.has(r.firmSlug + '|' + r.url) ? false : seen.add(r.firmSlug + '|' + r.url)))
    .filter((r) => firm || (perFirm.set(r.firmSlug, (perFirm.get(r.firmSlug) || 0) + 1), perFirm.get(r.firmSlug) <= PER_FIRM));
  return limitWithoutPicture(rows).slice(0, SHOWN).map((r) => ({ ...r, featured: !!r.featured, indexable: isIndexableStory(r), storyHref: storyPath(r.firmSlug, r.id, r.title) }));
}

// Every firm that has articles on the page (for the filter and the "firms writing here" strip), and the totals.
async function loadFirms(env, featuredOnly) {
  const where = featuredOnly ? 'WHERE f.featured = 1' : '';
  const [{ results }, totals] = await Promise.all([
    env.DB.prepare(`SELECT p.firm_slug AS slug, json_extract(f.data, '$.name') AS name, json_extract(f.data, '$.src') AS logo, MAX(p.published_at) AS latest ${VISIBLE} ${where} GROUP BY p.firm_slug ORDER BY name`).all(),
    env.DB.prepare(`SELECT COUNT(*) AS articles, MAX(p.published_at) AS latest ${VISIBLE} ${where}`).first(),
  ]);
  return { firms: results, articles: totals?.articles || 0, latest: totals?.latest || null };
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
    const featuredOnly = (await getSetting(env, 'news_featured_only', '0')) === '1';
    let [info, posts] = await Promise.all([loadFirms(env, featuredOnly), loadPosts(env, featuredOnly, selected)]);
    // Blogs are read when someone visits, so the page fills itself: never-read or half-day-old blogs, a few per visit.
    const due = await dueFeeds(env);
    if (due.length) {
      const work = Promise.all(due.map((slug) => refreshFirmFeed(env, slug).catch((err) => console.error('news refresh failed', slug, err))));
      if (!info.articles) {
        // An empty page would be a poor first impression: wait (briefly) for the first posts.
        await Promise.race([work, new Promise((r) => setTimeout(r, 12000))]);
        [info, posts] = await Promise.all([loadFirms(env, featuredOnly), loadPosts(env, featuredOnly, selected)]);
      } else ctx.waitUntil(work);
    }
    const firms = info.firms;
    const valid = firms.some((f) => f.slug === selected) ? selected : '';
    const people = [...firms].sort((a, b) => String(b.latest).localeCompare(String(a.latest))).slice(0, 16);
    const stats = { firms: firms.length, articles: info.articles, latest: info.latest };
    const res = new Response(renderNewsPage({ posts, firms, people, stats, selected: valid }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': ttl > 0 && posts.length ? `public, max-age=${ttl}` : 'no-cache', 'x-content-type-options': 'nosniff', 'x-lawdb-source': 'database' },
    });
    if (ttl > 0 && posts.length) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error('news page failed, serving static page', err);
    return env.ASSETS.fetch(request);
  }
}
