// /firms/<slug>: every live firm's page is drawn from the database (src/render/firm-page.js), the same way for every firm, whenever it was listed. Each success
// is cached at the edge for PUBLIC_CACHE_TTL seconds (default 60), so the database is read about once a minute per page, not once per visitor.
// If the database cannot answer, the saved copy of the page in the site files is served instead (an emergency copy, never a second kind of page).
import { storyPath } from '../lib/stories.js';
import { renderFirmPage } from '../render/firm-page.js';
import { isIndexable } from '../lib/indexing.js';
import { firmStats } from '../lib/firm-stats.js';
import { bookingRow } from '../render/booking.js';

const CACHE_GENERATION = 3; // 3: one page for every firm (the hand-built path is gone); 2: Book a call is locked until a firm is Featured

const ttlOf = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

async function nearbyFirms(env, f) {
  const cols = 'data';
  const seen = new Set([f.slug]);
  const out = [];
  const take = (rows) => {
    for (const r of rows) {
      const n = JSON.parse(r.data);
      if (!seen.has(n.slug) && out.length < 10) { seen.add(n.slug); out.push(n); }
    }
  };
  const order = 'ORDER BY featured DESC, rating DESC, review_count DESC, name';
  take((await env.DB.prepare(`SELECT ${cols} FROM firms WHERE status = 'live' AND city = ? AND province = ? AND slug != ? ${order} LIMIT 10`).bind(f.city, f.province, f.slug).all()).results);
  if (out.length < 6 && f.region) {
    take((await env.DB.prepare(`SELECT ${cols} FROM firms WHERE status = 'live' AND region = ? AND slug != ? ${order} LIMIT 10`).bind(f.region, f.slug).all()).results);
  }
  return out;
}

// The firm's latest blog posts (for the cards), only when its feed is switched on.
async function feedPosts(env, slug) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image, (f.page_only = 1 AND m.featured = 0) AS pageOnly
       FROM firm_posts p JOIN firm_feeds f ON f.firm_slug = p.firm_slug JOIN firms m ON m.slug = p.firm_slug
       WHERE p.firm_slug = ? AND f.enabled = 1 ORDER BY p.published_at DESC, p.id DESC LIMIT 3`
    ).bind(slug).all();
    // Page-only cards go straight to the firm's own article; there is no LawDB story page for them.
    return results.map((r) => (r.pageOnly ? { id: null, title: r.title, url: r.url, publishedAt: r.publishedAt, excerpt: r.excerpt, image: r.image } : { ...r, storyHref: storyPath(slug, r.id, r.title) }));
  } catch (err) {
    console.error('blog cards lookup failed', slug, err);
    return []; // the page always works without the cards
  }
}

// What the Worker adds to the drawn page: the claim line under the button row, the Book a call button in its slot, the member-ratings box under the map, and the small
// script that runs Follow, ratings and the claim button.
const managedBy = async (env, slug) => {
  try { return !!(await env.DB.prepare("SELECT 1 FROM firm_members WHERE firm_slug = ? AND status = 'approved'").bind(slug).first()); } catch { return false; }
};
const claimLine = (slug, managed) => managed
  ? '<p class="lw-claim lw-claimed">&#10003; Managed by the firm</p>'
  : `<p class="lw-claim"><a href="/account/#find/${slug}" data-claim="${slug}">Is this your firm? Claim this listing</a></p>`;

const withFollow = (res, slug, managed, booking = '') => new HTMLRewriter()
  .on('div.pf-actions', { element(el) { el.after(claimLine(slug, managed), { html: true }); } })
  .on('span[data-slot="book"]', { element(el) { el.replace(booking, { html: true }); } })
  .on('span[data-slot="rate"]', { element(el) { el.replace(`<div class="lw-rate" data-rate="${slug}" id="rate"></div>`, { html: true }); } })
  .on('body', { element(el) { el.append('<script src="/follow.js" defer></script>', { html: true }); } })
  .transform(res);

const bookingUrlOf = (row) => { try { return JSON.parse(row.data).bookingUrl || ''; } catch { return ''; } };
const nameOf = (row) => { try { return JSON.parse(row.data).name || 'This firm'; } catch { return 'This firm'; } };

export async function firmPage({ request, env, ctx }) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/firms\/([a-z0-9][a-z0-9-]*?)\/?$/);
  if (!m) return env.ASSETS.fetch(request);

  const ttl = ttlOf(env);
  const key = new Request(url.origin + url.pathname + '?g=' + CACHE_GENERATION, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }

  let row = null;
  try {
    row = await env.DB.prepare('SELECT data, hours, about, status, featured FROM firms WHERE slug = ?').bind(m[1]).first();
  } catch (err) {
    console.error('firm lookup failed, serving the saved copy', m[1], err);
    return env.ASSETS.fetch(request);
  }

  // A firm switched off in the admin is shown nowhere. A firm that is not live (waiting for approval) or not listed at all has no page.
  if (row && row.status === 'hidden') return env.ASSETS.fetch(new Request(url.origin + '/__hidden-firm__'));
  if (!row || row.status !== 'live') return env.ASSETS.fetch(request);

  let html;
  try {
    const firm = { ...JSON.parse(row.data), about: row.about || '' };
    const hours = row.hours ? JSON.parse(row.hours) : null;
    const photos = (await env.DB.prepare("SELECT id, alt FROM firm_images WHERE firm_slug = ? AND kind = 'photo' ORDER BY created_at, id").bind(m[1]).all()).results;
    html = renderFirmPage({ firm, hours, images: photos, posts: await feedPosts(env, m[1]), nearby: await nearbyFirms(env, firm), stats: await firmStats(env, firm), origin: env.SITE_ORIGIN || url.origin });
  } catch (err) {
    console.error('profile render failed, serving the saved copy', m[1], err);
    return env.ASSETS.fetch(request);
  }
  // No real description yet: keep the page out of Google (it stays reachable and its links still count) until there is one.
  const held = !isIndexable(row.about);
  if (held) html = html.replace('</head>', '<meta name="robots" content="noindex,follow">\n</head>');
  const managed = await managedBy(env, m[1]);
  const res = withFollow(new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-lawdb-source': 'database',
      ...(held ? { 'x-robots-tag': 'noindex, follow' } : {}),
    },
  }), m[1], managed, bookingRow({ url: bookingUrlOf(row), name: nameOf(row), managed, featured: !!row.featured }));
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
