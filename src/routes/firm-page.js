// /firms/<slug>: every live firm's page is drawn from the database (src/render/firm-page.js), the same way for every firm, whenever it was listed. Each success
// is cached at the edge for PUBLIC_CACHE_TTL seconds (default 60), so the database is read about once a minute per page, not once per visitor.
// If the database cannot answer, the saved copy of the page in the site files is served instead (an emergency copy, never a second kind of page).
import { renderFirmPage } from '../render/firm-page.js';
import { isIndexable } from '../lib/indexing.js';
import { getVerification, publicView } from '../lib/verification.js';
import { redirectTarget } from '../lib/firm-slug.js';
import { siblingsOf } from '../lib/locations.js';
import { firmStats } from '../lib/firm-stats.js';
import { bookingRow } from '../render/booking.js';
import { listArticles, articlesIndexable } from '../lib/articles.js';
import { lawyersOf } from '../lib/lawyers.js';

const CACHE_GENERATION = 11; // 11: the footer has a Lead Marketplace link and the firm's form has the optional Lead Marketplace box; 10: the greyed-out Book a call button is a plain tan button (no padlock, no Featured tag); 9: Basic lawyers show name, role and years in practice only, a page of their own is a Featured lawyer's; 8: 8: every firm's articles on the Articles page, none at the bottom of the Overview; 7: the Articles page and a tab bar that can hold more pages; // 6: lawyers confirmed by the firm, hidden lawyers and the firm's own lawyer pictures; 5: lawyer initials are first and last name; 4: the Lawyers page and lawyers' own pages; 3: one page for every firm (the hand-built path is gone); 2: Book a call is locked until a firm is Featured

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
  // /firms/<slug> (the Overview), /firms/<slug>/lawyers, /firms/<slug>/lawyers/<lawyer> and /firms/<slug>/articles: one page each, each with its own address.
  const m = url.pathname.match(/^\/firms\/([a-z0-9][a-z0-9-]*?)(?:\/(lawyers|articles)(?:\/([a-z0-9][a-z0-9-]*))?)?\/?$/);
  if (!m || (m[2] === 'articles' && m[3])) return env.ASSETS.fetch(request);
  const view = m[2] === 'articles' ? { tab: 'articles' } : m[3] ? { tab: 'lawyer', lawyer: m[3] } : m[2] === 'lawyers' ? { tab: 'lawyers' } : null;
  if (view && url.pathname.endsWith('/')) return new Response(null, { status: 301, headers: { location: url.pathname.replace(/\/+$/, '') + url.search, 'cache-control': 'public, max-age=3600' } }); // one address per page

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

  // An address the firm used to have goes permanently to the one it has now (see src/lib/firm-slug.js); this comes before the saved copy, which could be an old page.
  if (!row) {
    let moved = null;
    try { moved = await redirectTarget(env, m[1]); } catch (err) { console.error('firm redirect lookup failed', m[1], err); }
    if (moved) return new Response(null, { status: 301, headers: { location: `/firms/${moved}${url.search}`, 'cache-control': 'public, max-age=3600' } });
  }

  // A firm switched off in the admin is shown nowhere. A firm that is not live (waiting for approval) or not listed at all has no page.
  if (row && row.status === 'hidden') return env.ASSETS.fetch(new Request(url.origin + '/__hidden-firm__'));
  if (!row || row.status !== 'live') return env.ASSETS.fetch(request);

  let html;
  try {
    const firm = { ...JSON.parse(row.data), about: row.about || '' };
    const hours = row.hours ? JSON.parse(row.hours) : null;
    const photos = (await env.DB.prepare("SELECT id, alt FROM firm_images WHERE firm_slug = ? AND kind = 'photo' ORDER BY created_at, id").bind(m[1]).all()).results;
    const verified = publicView(await getVerification(env, m[1])); // only a firm the admin has checked; never the name or number the firm gave us
    // every firm's articles are on the Articles page, never on the Overview; the tab shows when there are enough (src/lib/articles.js). The page always works without them.
    const articles = await listArticles(env, m[1]).catch((err) => { console.error('articles lookup failed', m[1], err); return []; });
    html = renderFirmPage({ firm, hours, images: photos, articles, nearby: await nearbyFirms(env, firm), locations: await siblingsOf(env, m[1]), stats: await firmStats(env, firm), verified, view, origin: env.SITE_ORIGIN || url.origin });
    // A Lawyers page for a firm with no lawyers to show does not exist: 404, never an empty page. A lawyer who is listed but has no page of their own (only a Featured lawyer has one)
    // goes to the Lawyers page, so an address that was shared or indexed before still lands somewhere useful; a short cache so a lawyer who goes Featured gets the page soon.
    if (html === null) {
      if (view && view.tab === 'lawyer' && lawyersOf(firm).some((l) => l.slug === view.lawyer)) return new Response(null, { status: 302, headers: { location: `/firms/${m[1]}/lawyers`, 'cache-control': 'public, max-age=300' } });
      return env.ASSETS.fetch(request);
    }
  } catch (err) {
    console.error('profile render failed, serving the saved copy', m[1], err);
    return env.ASSETS.fetch(request);
  }
  // No real description yet: keep the page out of Google (it stays reachable and its links still count) until there is one.
  // A Basic firm's Articles page is for visitors only: its story pages are not offered to search engines, so neither is a page of excerpts that leads to them.
  const held = !isIndexable(row.about) || (view?.tab === 'articles' && !articlesIndexable(row));
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
