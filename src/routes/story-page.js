// GET /news/<firm>/<headline>-<id>: one story's page; ?partial=1 returns just the story, for the expanded view on the News page.
// GET /sitemap-news.xml: every story page, for search engines.
import { renderStoryPage, renderStoryPartial } from '../render/story-page.js';
import { parseStoryPath, storyPath } from '../lib/stories.js';

const ttlOf = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

const notFound = () =>
  new Response('<!DOCTYPE html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Story not found | LawDB News</title><body style="font-family:system-ui;max-width:560px;margin:12vh auto;padding:0 20px"><h1>That story is no longer here</h1><p>Firms\' older articles rotate off LawDB News. <a href="/news">See the latest stories</a>.</p></body>', {
    status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });

export async function storyPage({ request, env, ctx }) {
  const url = new URL(request.url);
  const ref = parseStoryPath(url.pathname);
  if (!ref) return notFound();
  const partial = url.searchParams.get('partial') === '1';
  const ttl = ttlOf(env);
  const key = new Request(`${url.origin}${url.pathname}?partial=${partial ? 1 : 0}`, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  let post;
  let firmRow;
  try {
    post = await env.DB.prepare(
      `SELECT p.id, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image FROM firm_posts p
       JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1 JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live' AND (ff.page_only = 0 OR f.featured = 1)
       WHERE p.id = ? AND p.firm_slug = ?`
    ).bind(ref.id, ref.firmSlug).first();
    if (!post) return notFound();
    const right = storyPath(ref.firmSlug, post.id, post.title);
    if (url.pathname.replace(/\/$/, '') !== right) return Response.redirect(url.origin + right + url.search, 301); // wrong or old wording
    firmRow = await env.DB.prepare('SELECT data, featured FROM firms WHERE slug = ?').bind(ref.firmSlug).first();
    const firm = { ...JSON.parse(firmRow.data), slug: ref.firmSlug, featured: !!firmRow.featured };
    const more = (await env.DB.prepare('SELECT id, title FROM firm_posts WHERE firm_slug = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 5').bind(ref.firmSlug, post.id).all()).results;
    const nearby = (await env.DB.prepare("SELECT slug, json_extract(data, '$.name') AS name FROM firms WHERE status = 'live' AND city = ? AND province = ? AND slug != ? ORDER BY featured DESC, rating DESC, review_count DESC LIMIT 5").bind(firm.city, firm.province, ref.firmSlug).all()).results;
    const data = { post, firm, more, nearby, origin: env.SITE_ORIGIN || url.origin };
    const res = new Response(partial ? renderStoryPartial(data) : renderStoryPage(data), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache', 'x-content-type-options': 'nosniff', ...(partial ? { 'x-robots-tag': 'noindex' } : {}) },
    });
    if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error('story page failed', url.pathname, err);
    return new Response('That story could not be loaded right now. Please try again in a moment.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30' } });
  }
}

export async function storySitemap({ request, env }) {
  const origin = (env.SITE_ORIGIN || new URL(request.url).origin).replace(/\/+$/, '');
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.firm_slug AS slug, p.title, p.published_at AS publishedAt, p.fetched_at AS fetchedAt FROM firm_posts p
       JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1 JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live' AND (ff.page_only = 0 OR f.featured = 1)
       ORDER BY p.published_at DESC, p.id DESC LIMIT 2000`
    ).all();
    const day = (d) => { const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : ''; };
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      results.map((r) => `  <url><loc>${origin}${storyPath(r.slug, r.id, r.title)}</loc>${day(r.fetchedAt || r.publishedAt) ? `<lastmod>${day(r.fetchedAt || r.publishedAt)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
    return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
  } catch (err) {
    console.error('story sitemap failed', err);
    return new Response('Unavailable', { status: 503, headers: { 'retry-after': '60' } });
  }
}
