// /firms/<slug>: serves the hand-built static page, or renders the page from the database for firms in
// 'dynamic' mode. Every success is cached at the edge for PUBLIC_CACHE_TTL seconds (default 60), so the
// database is read about once a minute per page, not once per visitor.
import { renderBlogCards } from '../render/blog-cards.js';
import { storyPath } from '../lib/stories.js';
import { renderFirmPage } from '../render/firm-page.js';
import { isIndexable } from '../lib/indexing.js';
import { firmStats } from '../lib/firm-stats.js';
import { profilesBox, hasLinkedIn } from '../render/profiles.js';
import { bookingRow } from '../render/booking.js';
import { staticLogoHtml } from '../render/logo.js';

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

// Every firm page gets a Follow button (next to Call / Website / Directions), a Book a call button under them (active when the firm has given a booking link, greyed out when not),
// the member-ratings box under the contact form, and the small script that runs them.
const managedBy = async (env, slug) => {
  try { return !!(await env.DB.prepare("SELECT 1 FROM firm_members WHERE firm_slug = ? AND status = 'approved'").bind(slug).first()); } catch { return false; }
};
const claimLine = (slug, managed) => managed
  ? '<p class="lw-claim lw-claimed">&#10003; Managed by the firm</p>'
  : `<p class="lw-claim"><a href="/account/#find/${slug}" data-claim="${slug}">Is this your firm? Claim this listing</a></p>`;

// profiles: the Profiles box (the firm's social icons) for a hand-built page, put right under the contact form, which sits under the description; a database page already has it. A firm with a real LinkedIn page
// does not need the generic "Search on LinkedIn" link of the hand-built pages.
const withFollow = (res, slug, managed, profiles = '', linkedin = false, booking = '') => {
  return new HTMLRewriter()
    .on('div.li-actions', { element(el) { el.before(`<div class="lw-fline"><span class="lw-fcount" data-fcount="${slug}"></span><button class="lw-fbtn" type="button" data-follow="${slug}">+ Follow</button></div>`, { html: true }); } })
    .on('div.li-actions', { element(el) { el.after(booking + claimLine(slug, managed), { html: true }); } })
    .on('div.socials a', { element(el) { if (linkedin && /^https:\/\/www\.linkedin\.com\/search\//.test(el.getAttribute('href') || '')) el.remove(); } })
    .on('div.lead-slim', { element(el) { el.after(`<div class="lw-rate" data-rate="${slug}" id="rate"></div>` + profiles, { html: true }); } })
    .on('body', { element(el) { el.append('<script src="/follow.js" defer></script>', { html: true }); } })
    .transform(res);
};

const bookingUrlOf = (row) => { try { return JSON.parse(row.data).bookingUrl || ''; } catch { return ''; } };
const nameOf = (row) => { try { return JSON.parse(row.data).name || 'This firm'; } catch { return 'This firm'; } };

export async function firmPage({ request, env, ctx }) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/firms\/([a-z0-9][a-z0-9-]*?)\/?$/);
  if (!m) return env.ASSETS.fetch(request);

  const ttl = ttlOf(env);
  const key = new Request(url.origin + url.pathname, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }

  let row = null;
  try {
    row = await env.DB.prepare('SELECT data, hours, page_mode, about, status, featured FROM firms WHERE slug = ?').bind(m[1]).first();
  } catch (err) {
    console.error('firm lookup failed, serving static page', m[1], err);
    return env.ASSETS.fetch(request);
  }

  if (!row || row.status !== 'live' || row.page_mode !== 'dynamic') {
    let res = await env.ASSETS.fetch(request); // the original page (or a 404 for an unknown firm)
    if (res.status === 200 && row && row.status === 'live') {
      // Hand-built pages get the blog cards slipped in: after their "From the Firm" block, or before the fine print.
      const posts = await feedPosts(env, m[1]);
      if (posts.length) {
        const cards = renderBlogCards({ firmName: JSON.parse(row.data).name, posts });
        let placed = false;
        res = new HTMLRewriter()
          .on('div.from-firm', { element(el) { placed = true; el.after(cards, { html: true }); } })
          .on('div.fine', { element(el) { if (!placed) { placed = true; el.before(cards, { html: true }); } } })
          .transform(res);
      }
    }
    // The "Before you call about..." guide is the same text on every firm in a case type, so only Featured firms keep it
    // (the city and case-type pages already carry that guidance once, where it belongs).
    if (res.status === 200 && row && row.status === 'live' && !row.featured) res = new HTMLRewriter().on('div.guide', { element(el) { el.remove(); } }).transform(res);
    if (res.status === 200 && row && row.status === 'live') {
      const rec = JSON.parse(row.data);
      const managed = await managedBy(env, m[1]);
      // The logo saved in the database (admin / owner screens) wins over the one baked into the file.
      const logo = staticLogoHtml(rec);
      if (logo) res = new HTMLRewriter().on('span.li-logo', { element(el) { el.setInnerContent(logo, { html: true }); } }).transform(res);
      res = withFollow(res, m[1], managed, profilesBox(rec.social, rec.name), hasLinkedIn(rec.social), bookingRow({ url: rec.bookingUrl, name: rec.name, managed }));
    }
    if (res.status === 200 && ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  }

  let html;
  try {
    const firm = { ...JSON.parse(row.data), about: row.about || '' };
    const hours = row.hours ? JSON.parse(row.hours) : null;
    const photos = (await env.DB.prepare("SELECT id, alt FROM firm_images WHERE firm_slug = ? AND kind = 'photo' ORDER BY created_at, id").bind(m[1]).all()).results;
    html = renderFirmPage({ firm, hours, images: photos, posts: await feedPosts(env, m[1]), nearby: await nearbyFirms(env, firm), stats: await firmStats(env, firm), origin: env.SITE_ORIGIN || url.origin });
  } catch (err) {
    console.error('profile render failed', m[1], err);
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
  }), m[1], managed, '', false, bookingRow({ url: bookingUrlOf(row), name: nameOf(row), managed }));
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
