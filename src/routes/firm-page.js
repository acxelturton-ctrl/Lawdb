// /<handle> and /<name> (the old /firms/<slug> redirects): every live firm's page is drawn from the database (src/render/firm-page.js), the same way for every firm, whenever it was listed. Each success
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
import { firmPath, firmByToken, currentAddress, couldBeFirm } from '../lib/firm-handle.js';
import { lawyerDirectory } from '../lib/lawyer-address.js';

const CACHE_GENERATION = 13; // 13: the addresses are /<handle> and /<name> (no dashes, nothing in front); 12: the share picture is images/og-lawdb.jpg and og:type is "website"; 11: the footer has a Lead Marketplace link and the firm's form has the optional Lead Marketplace box; 10: the greyed-out Book a call button is a plain tan button (no padlock, no Featured tag); 9: Basic lawyers show name, role and years in practice only, a page of their own is a Featured lawyer's; 8: 8: every firm's articles on the Articles page, none at the bottom of the Overview; 7: the Articles page and a tab bar that can hold more pages; // 6: lawyers confirmed by the firm, hidden lawyers and the firm's own lawyer pictures; 5: lawyer initials are first and last name; 4: the Lawyers page and lawyers' own pages; 3: one page for every firm (the hand-built path is gone); 2: Book a call is locked until a firm is Featured

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
  .on('body', { element(el) { el.setAttribute('data-firm', slug); el.append('<script src="/follow.js" defer></script>', { html: true }); } })
  .transform(res);

const bookingUrlOf = (row) => { try { return JSON.parse(row.data).bookingUrl || ''; } catch { return ''; } };
const nameOf = (row) => { try { return JSON.parse(row.data).name || 'This firm'; } catch { return 'This firm'; } };

// Where an old /firms/<slug>... address goes now (a permanent redirect, so no shared link or search result breaks): the firm's /<handle> page, its Lawyers or Articles page, or, for a
// lawyer who has a page of their own, /<name>.
async function oldAddress(env, url, m) {
  const cur = await currentAddress(env, m[1]);
  if (!cur || cur.status !== 'live') return null; // a firm switched off or not yet approved has no page, so its old address is not sent anywhere
  let to = firmPath(cur, m[2] || '');
  if (m[2] === 'lawyers' && m[3]) {
    const dir = await lawyerDirectory(env);
    const addr = (dir.byFirm.get(cur.slug) || {})[m[3]];
    to = addr ? `/${addr}` : firmPath(cur, 'lawyers');
  }
  return new Response(null, { status: 301, headers: { location: to + url.search, 'cache-control': 'public, max-age=3600' } });
}

export async function firmPage({ request, env, ctx }) {
  const url = new URL(request.url);
  // /<handle> (the Overview), /<handle>/lawyers and /<handle>/articles; /<name> (a Featured lawyer's own page); and the old /firms/<slug>... addresses, which redirect.
  const old = url.pathname.match(/^\/firms\/([a-z0-9][a-z0-9-]*?)(?:\/(lawyers|articles)(?:\/([a-z0-9][a-z0-9-]*))?)?\/?$/);
  if (old) {
    try { const moved = await oldAddress(env, url, old); if (moved) return moved; } catch (err) { console.error('old address lookup failed, serving the saved copy', old[1], err); }
    return env.ASSETS.fetch(request); // not in the database: the saved copy in the site files, if there is one (an emergency copy), else the 404 page
  }
  const m = url.pathname.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(lawyers|articles))?\/?$/);
  if (!m || !couldBeFirm(m[1])) return env.ASSETS.fetch(request); // not a firm's address: one of the site's own words, or something that is not an address at all
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) return new Response(null, { status: 301, headers: { location: url.pathname.replace(/\/+$/, '') + url.search, 'cache-control': 'public, max-age=3600' } }); // one address per page

  const ttl = ttlOf(env);
  const key = new Request(url.origin + url.pathname + '?g=' + CACHE_GENERATION, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }

  let row = null, view = null, slug = '', lawyerAddr = null;
  try {
    row = await firmByToken(env, m[1]);
    if (row) {
      slug = row.slug;
      view = m[2] === 'articles' ? { tab: 'articles' } : m[2] === 'lawyers' ? { tab: 'lawyers' } : null;
      // a Featured firm's lawyers who have a page of their own are linked on its pages (the Overview teaser, the Lawyers page)
      if (row.featured) lawyerAddr = (await lawyerDirectory(env)).byFirm.get(slug) || null;
      if (lawyerAddr) view = { tab: 'overview', ...view, lawyerAddr };
    } else if (!m[2]) {
      // not a firm: a Featured lawyer's own page is at the same kind of address
      const dir = await lawyerDirectory(env);
      const at = dir.byAddr.get(m[1]);
      if (at) {
        slug = at.firm;
        lawyerAddr = dir.byFirm.get(slug) || null;
        view = { tab: 'lawyer', lawyer: at.lawyer, lawyerAddr };
        row = await env.DB.prepare('SELECT slug, handle, data, hours, about, status, featured FROM firms WHERE slug = ?').bind(slug).first();
      }
    }
    // an address the firm used to have (its old slug or handle), or its slug when it has a handle: one permanent redirect to the handle
    if (!row) {
      const cur = await currentAddress(env, m[1]);
      if (cur && cur.status === 'live' && firmPath(cur) !== `/${m[1]}`) return new Response(null, { status: 301, headers: { location: firmPath(cur, m[2] || '') + url.search, 'cache-control': 'public, max-age=3600' } });
    }
  } catch (err) {
    console.error('firm lookup failed, serving the saved copy', m[1], err);
    // the saved copy of a firm page is kept at its old address, /firms/<slug> (only reachable by slug, and only for the firms that have one)
    return env.ASSETS.fetch(new Request(`${url.origin}/firms/${m[1]}`, request));
  }

  // A firm switched off in the admin is shown nowhere. A firm that is not live (waiting for approval) or not listed at all has no page.
  if (row && row.status === 'hidden') return env.ASSETS.fetch(new Request(url.origin + '/__hidden-firm__'));
  if (!row || row.status !== 'live') return env.ASSETS.fetch(request);

  let html;
  try {
    const firm = { ...JSON.parse(row.data), about: row.about || '', ...(row.handle ? { handle: row.handle } : {}) };
    const hours = row.hours ? JSON.parse(row.hours) : null;
    const photos = (await env.DB.prepare("SELECT id, alt FROM firm_images WHERE firm_slug = ? AND kind = 'photo' ORDER BY created_at, id").bind(slug).all()).results;
    const verified = publicView(await getVerification(env, slug)); // only a firm the admin has checked; never the name or number the firm gave us
    // every firm's articles are on the Articles page, never on the Overview; the tab shows when there are enough (src/lib/articles.js). The page always works without them.
    const articles = await listArticles(env, slug).catch((err) => { console.error('articles lookup failed', slug, err); return []; });
    html = renderFirmPage({ firm, hours, images: photos, articles, nearby: await nearbyFirms(env, firm), locations: await siblingsOf(env, slug), stats: await firmStats(env, firm), verified, view, origin: env.SITE_ORIGIN || url.origin });
    // A Lawyers page for a firm with no lawyers to show does not exist: 404, never an empty page.
    if (html === null) return env.ASSETS.fetch(request);
  } catch (err) {
    console.error('profile render failed, serving the saved copy', slug, err);
    return env.ASSETS.fetch(request);
  }
  // No real description yet: keep the page out of Google (it stays reachable and its links still count) until there is one.
  // A Basic firm's Articles page is for visitors only: its story pages are not offered to search engines, so neither is a page of excerpts that leads to them.
  const held = !isIndexable(row.about) || (view?.tab === 'articles' && !articlesIndexable(row));
  if (held) html = html.replace('</head>', '<meta name="robots" content="noindex,follow">\n</head>');
  const managed = await managedBy(env, slug);
  const res = withFollow(new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-lawdb-source': 'database',
      ...(held ? { 'x-robots-tag': 'noindex, follow' } : {}),
    },
  }), slug, managed, bookingRow({ url: bookingUrlOf(row), name: nameOf(row), managed, featured: !!row.featured }));
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
