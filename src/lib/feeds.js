// Reads a firm's public blog (RSS/Atom feed, or the public post list of a WordPress site) and keeps its latest few posts as small cards:
// headline, date, a short plain-text excerpt, and a link to the article on the firm's own website.
//
// Rules that keep this safe and fair to the firms:
//  - only the excerpt the feed itself publishes is used, cut to 600 characters; full articles are never stored or shown;
//  - all markup is stripped (text only), and every link must point at the firm's own site (or the feed's host);
//  - only public https addresses are fetched (no IP addresses, no internal names), with a timeout and a size cap.

import { audit } from './audit.js';
import { HttpError } from './http.js';

export const FEED_LIMITS = { posts: 20, excerpt: 600, title: 200, bytes: 1_500_000, pageBytes: 600_000, timeoutMs: 8000, redirects: 3, recheckMinutes: 5 };
const UA = 'LawDB-FeedReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const COMMON_PATHS = ['/feed', '/feed/', '/blog/feed', '/blog/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/blog/rss.xml', '/news/feed', '/blog/index.xml'];

// ---------------------------------------------------------------- safe fetching
// `allowLocal` is true only in local development, so tests can read a fixture feed from this computer.
export function checkFeedUrl(raw, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid web address.'); }
  const host = u.hostname.toLowerCase();
  if (allowLocal && (host === '127.0.0.1' || host === 'localhost') && (u.protocol === 'http:' || u.protocol === 'https:')) return u;
  if (u.protocol !== 'https:') throw new Error('The feed address must start with https://');
  if (u.username || u.password) throw new Error('The feed address cannot contain a login.');
  if (host.includes(':') || host.startsWith('[') || /^\d+(\.\d+){0,3}$/.test(host)) throw new Error('Use the website name, not an IP address.');
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) throw new Error('That address is not a public website.');
  if (u.port && u.port !== '443') throw new Error('Only the standard https port is allowed.');
  return u;
}

async function readLimited(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); break; } // enough: parse what we have
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder('utf-8').decode(all);
}

export async function safeGet(env, raw, { maxBytes, accept }) {
  const allowLocal = env.DEV_ECHO_LINK === '1';
  let url = checkFeedUrl(raw, { allowLocal }).toString();
  for (let hop = 0; hop <= FEED_LIMITS.redirects; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(FEED_LIMITS.timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = checkFeedUrl(new URL(res.headers.get('location'), url).toString(), { allowLocal }).toString(); // every hop is checked too
      continue;
    }
    if (!res.ok) throw new Error(`The website answered ${res.status}.`);
    return { url, text: await readLimited(res, maxBytes) };
  }
  throw new Error('Too many redirects.');
}

// ---------------------------------------------------------------- parsing
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// Feed text -> plain text. Markup is removed; entities are decoded; whitespace is tidied.
export function plain(raw) {
  if (!raw) return '';
  let s = raw.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(s);
  s = cdata ? cdata[1] : decode(s); // CDATA already holds HTML; otherwise the HTML is entity-escaped
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  s = decode(s).replace(/<[^>]*>/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const cut = (s, n) => {
  if (s.length <= n) return s;
  const t = s.slice(0, n);
  return t.slice(0, Math.max(t.lastIndexOf(' '), n - 40)).replace(/[\s,;:.\-]+$/, '') + '...';
};

const tag = (block, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
};
const baseHost = (h) => h.toLowerCase().replace(/^www\./, '');
const sameSite = (host, allowed) => allowed.some((a) => host === a || host.endsWith('.' + a));

// A card picture is only ever an address. It must be a public https image (http is upgraded), no logins, no SVG, no tracking pixels or emoji.
export function cleanImageUrl(raw, base, { allowLocal = false } = {}) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(decode(raw.trim()), base);
    if (!allowLocal && u.protocol === 'http:') u.protocol = 'https:';
    checkFeedUrl(u.toString(), { allowLocal });
    u.hash = '';
    const s = u.toString();
    if (s.length > 500 || /\.(svg|gif|ico)(\?|$)/i.test(u.pathname) || /(pixel|spacer|gravatar|emoji|feedburner|doubleclick|\/ads?\/|1x1|blank\.)/i.test(s)) return null;
    return s;
  } catch { return null; }
}

// If the same picture heads several posts it is the blog's stand-in image or logo, not an article picture: leave it out.
function dropRepeatedImages(posts) {
  const count = new Map();
  for (const p of posts) if (p.image) count.set(p.image, (count.get(p.image) || 0) + 1);
  for (const p of posts) if (p.image && count.get(p.image) > 1) p.image = null;
  return posts;
}

// Returns up to FEED_LIMITS.posts newest items, only those linking to an allowed host.
export function parseFeed(xml, { feedUrl, siteUrl, allowLocal = false }) {
  const allowed = [];
  for (const u of [feedUrl, siteUrl]) { try { allowed.push(baseHost(new URL(u).hostname)); } catch {} }
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entries = blocks.length ? [] : [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const posts = [];
  for (const block of [...blocks, ...entries].slice(0, 25)) {
    const title = cut(plain(tag(block, 'title')), FEED_LIMITS.title);
    let link = plain(tag(block, 'link'));
    if (!link) {
      const alt = /<link\b[^>]*\brel=["']alternate["'][^>]*>/i.exec(block) || /<link\b[^>]*>/i.exec(block);
      const href = alt && /\bhref=["']([^"']+)["']/i.exec(alt[0]);
      link = href ? decode(href[1]) : '';
    }
    let url;
    try {
      const u = new URL(link, feedUrl);
      const okProto = u.protocol === 'https:' || (allowLocal && u.protocol === 'http:' && u.hostname === '127.0.0.1');
      if (!okProto || !sameSite(baseHost(u.hostname), allowed)) continue; // only the firm's own site
      u.hash = '';
      url = u.toString();
    } catch { continue; }
    // Prefer the feed's own summary; if only the full text is given, take just its opening words.
    const body = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content');
    let excerpt = plain(body).replace(/\s*The post .{1,300} appeared first on .{1,200}$/i, '').replace(/\s*(Continue reading|Read more)[^.]{0,60}$/i, '').trim();
    excerpt = cut(excerpt, FEED_LIMITS.excerpt);
    const guid = plain(tag(block, 'guid') || tag(block, 'id')) || url;
    const when = plain(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'));
    let published = null;
    const d = new Date(when);
    if (when && !Number.isNaN(d.getTime()) && d.getTime() < Date.now() + 86400000 && d.getFullYear() > 1999) published = d.toISOString().slice(0, 19).replace('T', ' ');
    if (!title) continue;
    posts.push({ guid: guid.slice(0, 300), title, url, publishedAt: published, excerpt, image: rssImage(block, feedUrl, allowLocal) });
  }
  posts.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return dropRepeatedImages(posts.slice(0, FEED_LIMITS.posts));
}

// The picture an RSS/Atom item offers: media:content / media:thumbnail / an image enclosure, else the first picture inside the item's own text.
function rssImage(block, feedUrl, allowLocal) {
  const attr = (tagRe, re) => { const m = new RegExp(`<${tagRe}\\b[^>]*>`, 'gi'); for (const t of block.matchAll(m)) { const a = re.exec(t[0]); if (a) return a[1]; } return ''; };
  const cands = [];
  for (const t of block.matchAll(/<media:content\b[^>]*>/gi)) if (!/medium=["'](?!image)/i.test(t[0]) && !/type=["'](?!image)/i.test(t[0])) { const u = /\burl=["']([^"']+)["']/i.exec(t[0]); if (u) cands.push(u[1]); }
  cands.push(attr('media:thumbnail', /\burl=["']([^"']+)["']/i));
  for (const t of block.matchAll(/<enclosure\b[^>]*>/gi)) if (/type=["']image\//i.test(t[0])) { const u = /\burl=["']([^"']+)["']/i.exec(t[0]); if (u) cands.push(u[1]); }
  cands.push(attr('itunes:image', /\bhref=["']([^"']+)["']/i));
  const inner = tag(block, 'content:encoded') || tag(block, 'description') || tag(block, 'content') || tag(block, 'summary');
  const html = /^\s*<!\[CDATA\[/.test(inner) ? inner : decode(inner);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const w = /\bwidth=["']?(\d+)/i.exec(m[0]);
    if (w && Number(w[1]) < 200) continue; // icons and emoji
    const src = /\bsrc=["']([^"']+)["']/i.exec(m[0]);
    if (src) cands.push(src[1]);
  }
  for (const c of cands) { const ok = cleanImageUrl(c, feedUrl, { allowLocal }); if (ok) return ok; }
  return null;
}

// WordPress sites publish their posts at /wp-json/wp/v2/posts. Same rules as for feeds: short plain text, own-site links only.
export const wpPostsUrl = (origin) => `${origin}/wp-json/wp/v2/posts?per_page=${FEED_LIMITS.posts}&_fields=id,date,link,title,excerpt`;
export const isWpUrl = (u) => /\/wp-json\/wp\/v2\/posts/i.test(u);
// The same list, also asking for each post's featured picture (_embed). Sites that refuse this are read the plain way.
export function wpPostsUrlWithImages(feedUrl) {
  const u = new URL(feedUrl);
  u.searchParams.set('per_page', String(FEED_LIMITS.posts));
  u.searchParams.set('_embed', 'wp:featuredmedia');
  u.searchParams.set('_fields', 'id,date,link,title,excerpt,featured_media,jetpack_featured_media_url,yoast_head_json.og_image,_embedded');
  return u.toString();
}

// The featured picture of a WordPress post: a medium-large size when there is one, else the full file.
function wpImage(p, feedUrl, allowLocal) {
  const media = Array.isArray(p?._embedded?.['wp:featuredmedia']) ? p._embedded['wp:featuredmedia'][0] : null;
  const cands = [];
  if (media && typeof media === 'object' && !media.code) {
    const sizes = media.media_details?.sizes || {};
    const w = Number(media.media_details?.width) || 0;
    if (!w || w >= 300) {
      for (const k of ['medium_large', 'large', 'full']) if (sizes[k]?.source_url) cands.push(sizes[k].source_url);
      if (media.source_url) cands.push(media.source_url);
    }
  }
  if (typeof p?.jetpack_featured_media_url === 'string') cands.push(p.jetpack_featured_media_url);
  const og = Array.isArray(p?.yoast_head_json?.og_image) ? p.yoast_head_json.og_image[0] : null; // the picture the SEO plugin names for sharing
  if (og && typeof og.url === 'string' && !(Number(og.width) && Number(og.width) < 300)) cands.push(og.url);
  for (const c of cands) { const ok = cleanImageUrl(c, feedUrl, { allowLocal }); if (ok) return ok; }
  return null;
}

export function parseWpPosts(json, { feedUrl, siteUrl, allowLocal = false }) {
  if (!Array.isArray(json)) return [];
  const allowed = [];
  for (const u of [feedUrl, siteUrl]) { try { allowed.push(baseHost(new URL(u).hostname)); } catch {} }
  const posts = [];
  for (const p of json.slice(0, 25)) {
    if (!p || typeof p !== 'object') continue;
    const title = cut(plain(String(p.title?.rendered ?? '')), FEED_LIMITS.title);
    let url;
    try {
      const u = new URL(String(p.link || ''), feedUrl);
      const okProto = u.protocol === 'https:' || (allowLocal && u.protocol === 'http:' && u.hostname === '127.0.0.1');
      if (!okProto || !sameSite(baseHost(u.hostname), allowed)) continue;
      u.hash = '';
      url = u.toString();
    } catch { continue; }
    if (!title) continue;
    const excerpt = cut(plain(String(p.excerpt?.rendered ?? '')).replace(/\s*\[(?:…|&hellip;|\.\.\.)\]\s*$/, '...').replace(/\s*The post .{1,300} appeared first on .{1,200}$/i, '').trim(), FEED_LIMITS.excerpt);
    const d = new Date(String(p.date || ''));
    const published = p.date && !Number.isNaN(d.getTime()) && d.getTime() < Date.now() + 86400000 && d.getFullYear() > 1999 ? d.toISOString().slice(0, 19).replace('T', ' ') : null;
    posts.push({ guid: `wp:${p.id ?? url}`.slice(0, 300), title, url, publishedAt: published, excerpt, image: wpImage(p, feedUrl, allowLocal), mediaId: Number(p.featured_media) > 0 ? Number(p.featured_media) : 0 });
  }
  posts.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return dropRepeatedImages(posts.slice(0, FEED_LIMITS.posts));
}

// Some WordPress sites hide the embedded picture but still list their media: ask for the featured pictures of the posts that have none, in one request.
export async function fillWpMedia(env, posts, feedUrl, { allowLocal = false } = {}) {
  const need = posts.filter((p) => !p.image && p.mediaId);
  if (!need.length) return posts;
  try {
    const origin = new URL(feedUrl).origin;
    const q = `${origin}/wp-json/wp/v2/media?include=${[...new Set(need.map((p) => p.mediaId))].slice(0, FEED_LIMITS.posts).join(',')}&per_page=${FEED_LIMITS.posts}&_fields=id,source_url,media_details.width,media_details.sizes.medium_large.source_url,media_details.sizes.large.source_url`;
    const { url, text } = await safeGet(env, q, { maxBytes: FEED_LIMITS.pageBytes, accept: 'application/json' });
    const byId = new Map();
    for (const m of JSON.parse(text)) {
      if (!m || typeof m !== 'object') continue;
      const w = Number(m.media_details?.width) || 0;
      if (w && w < 300) continue;
      for (const c of [m.media_details?.sizes?.medium_large?.source_url, m.media_details?.sizes?.large?.source_url, m.source_url]) {
        const ok = cleanImageUrl(c, url, { allowLocal });
        if (ok) { byId.set(m.id, ok); break; }
      }
    }
    for (const p of need) p.image = byId.get(p.mediaId) || null;
    return dropRepeatedImages(posts);
  } catch { return posts; } // pictures are a nicety: never fail the blog over them
}

// ---------------------------------------------------------------- finding and refreshing
export async function discoverFeed(env, siteUrl) {
  const allowLocal = env.DEV_ECHO_LINK === '1';
  const home = await safeGet(env, siteUrl, { maxBytes: FEED_LIMITS.pageBytes, accept: 'text/html,*/*' }).catch(() => null);
  const origin = new URL(home ? home.url : siteUrl).origin;

  // 1. WordPress: one small request that returns headlines, dates and the site's own excerpts.
  try {
    const wp = wpPostsUrl(origin);
    const { url, text } = await safeGet(env, wp, { maxBytes: FEED_LIMITS.bytes, accept: 'application/json' });
    if (parseWpPosts(JSON.parse(text), { feedUrl: url, siteUrl, allowLocal }).length) return { url: wp, kind: 'wp' };
  } catch { /* not WordPress, or no public post list */ }

  // 2. An RSS/Atom feed announced on the home page, then the usual addresses.
  const candidates = [];
  if (home) {
    for (const m of home.text.matchAll(/<link\b[^>]*>/gi)) {
      const t = m[0];
      if (/type=["']application\/(rss|atom)\+xml["']/i.test(t) && /rel=["']alternate["']/i.test(t)) {
        const href = /href=["']([^"']+)["']/i.exec(t);
        if (href) candidates.push(new URL(decode(href[1]), home.url).toString());
      }
    }
  }
  for (const p of COMMON_PATHS) candidates.push(origin + p);
  let tried = 0;
  for (const c of [...new Set(candidates)]) {
    if (tried++ >= 5) break; // stays well inside the platform's limit on outgoing requests
    try {
      const { url, text } = await safeGet(env, c, { maxBytes: FEED_LIMITS.bytes, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' });
      if (/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 2000)) && parseFeed(text, { feedUrl: url, siteUrl, allowLocal }).length) return { url, kind: 'rss' };
    } catch { /* try the next one */ }
  }
  return null;
}

export async function getFeedInfo(env, slug) {
  const row = await env.DB.prepare('SELECT feed_url AS feedUrl, source, kind, enabled, status, last_checked_at AS lastCheckedAt, last_error AS lastError FROM firm_feeds WHERE firm_slug = ?').bind(slug).first();
  const { results } = await env.DB.prepare('SELECT title, url, published_at AS publishedAt FROM firm_posts WHERE firm_slug = ? ORDER BY published_at DESC, id DESC').bind(slug).all();
  return { feed: row ? { ...row, enabled: !!row.enabled } : null, posts: results };
}

// Checks one firm's feed now. `discover` also looks for the feed if none is known yet.
export async function refreshFirmFeed(env, slug, { discover = true } = {}) {
  const firm = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(slug).first();
  if (!firm) throw new Error('Firm not found');
  const website = JSON.parse(firm.data).website || '';
  const allowLocal = env.DEV_ECHO_LINK === '1';
  await env.DB.prepare('INSERT OR IGNORE INTO firm_feeds (firm_slug) VALUES (?)').bind(slug).run();
  const row = await env.DB.prepare('SELECT feed_url, kind FROM firm_feeds WHERE firm_slug = ?').bind(slug).first();
  let feedUrl = row.feed_url;
  let kind = row.kind;
  const set = (status, error, url = feedUrl) =>
    env.DB.prepare("UPDATE firm_feeds SET status = ?, last_error = ?, feed_url = ?, kind = ?, last_checked_at = datetime('now') WHERE firm_slug = ?").bind(status, error ? String(error).slice(0, 200) : null, url, kind, slug).run();
  try {
    if (!feedUrl) {
      if (!website || !discover) { await set('none', website ? null : 'The firm has no website on file.'); return { status: 'none', posts: 0 }; }
      const found = await discoverFeed(env, website);
      if (!found) { await set('none', 'No blog was found on the website.', null); return { status: 'none', posts: 0 }; }
      feedUrl = found.url; kind = found.kind;
    }
    const wp = kind === 'wp' || isWpUrl(feedUrl);
    kind = wp ? 'wp' : 'rss';
    const accept = wp ? 'application/json' : 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*';
    let got;
    if (wp) {
      // Ask for the pictures too; if the site refuses that, read the plain list (cards then have no picture).
      try { got = await safeGet(env, wpPostsUrlWithImages(feedUrl), { maxBytes: FEED_LIMITS.bytes * 2, accept }); JSON.parse(got.text); } catch { got = null; }
    }
    if (!got) { const plainUrl = new URL(feedUrl); if (wp) plainUrl.searchParams.set('per_page', String(FEED_LIMITS.posts)); got = await safeGet(env, plainUrl.toString(), { maxBytes: FEED_LIMITS.bytes, accept }); }
    const { url, text } = got;
    let posts;
    if (wp) {
      let json;
      try { json = JSON.parse(text); } catch { throw new Error('That address did not return a WordPress post list.'); }
      posts = await fillWpMedia(env, parseWpPosts(json, { feedUrl: url, siteUrl: website || url, allowLocal }), url, { allowLocal });
    } else {
      if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 2000))) throw new Error('That address is not an RSS or Atom feed.');
      posts = parseFeed(text, { feedUrl: url, siteUrl: website || url, allowLocal });
    }
    if (!posts.length) throw new Error('No posts were found that link to the firm\'s own website.');
    const sourceChanged = row.feed_url !== feedUrl || row.kind !== kind; // a different address or type: the old posts could repeat the same articles
    await env.DB.batch([
      ...(sourceChanged ? [env.DB.prepare('DELETE FROM firm_posts WHERE firm_slug = ?').bind(slug)] : []),
      ...posts.map((p) => env.DB.prepare(
        `INSERT INTO firm_posts (firm_slug, guid, title, url, published_at, excerpt, image_url) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (firm_slug, guid) DO UPDATE SET title = excluded.title, url = excluded.url, published_at = excluded.published_at, excerpt = excluded.excerpt, image_url = excluded.image_url, fetched_at = datetime('now')`
      ).bind(slug, p.guid, p.title, p.url, p.publishedAt, p.excerpt, p.image || null)),
      // Keep only the newest few.
      env.DB.prepare(`DELETE FROM firm_posts WHERE firm_slug = ? AND id NOT IN (SELECT id FROM firm_posts WHERE firm_slug = ? ORDER BY published_at DESC, id DESC LIMIT ${FEED_LIMITS.posts})`).bind(slug, slug),
    ]);
    await set('ok', null, feedUrl);
    return { status: 'ok', posts: posts.length };
  } catch (err) {
    await set('error', err.message);
    return { status: 'error', error: err.message, posts: 0 };
  }
}

// Used by the News page: reads blogs that have never been read, or not for half a day. Never more than a few per visit.
export async function dueFeeds(env, limit = 3) {
  const dev = env.DEV_ECHO_LINK === '1';
  // Featured firms are on the page without waiting for the nightly job: give them a feed row so their blog is looked for on this visit.
  if (!dev) await env.DB.prepare(
    "INSERT OR IGNORE INTO firm_feeds (firm_slug) SELECT slug FROM firms WHERE featured = 1 AND status = 'live' AND json_extract(data, '$.website') IS NOT NULL AND json_extract(data, '$.website') != ''"
  ).run();
  const { results } = await env.DB.prepare(
    `SELECT f.firm_slug AS slug FROM firm_feeds f JOIN firms m ON m.slug = f.firm_slug
     WHERE f.enabled = 1 AND m.status = 'live' ${dev ? "AND f.source = 'manual'" : ''} AND (
       (f.status != 'none' AND (f.last_checked_at IS NULL OR f.last_checked_at < datetime('now', '-12 hours')))
       OR (f.status = 'none' AND f.last_checked_at < datetime('now', '-7 days')))
     ORDER BY f.last_checked_at LIMIT ?`
  ).bind(limit).all();
  return results.map((r) => r.slug);
}

// Nightly: Featured firms get cards automatically (unless switched off); every enabled feed is refreshed.
export async function refreshAllFeeds(env) {
  // Local development never goes looking at real websites; it only re-reads feeds entered by hand.
  const dev = env.DEV_ECHO_LINK === '1';
  if (!dev) await env.DB.prepare(
    "INSERT OR IGNORE INTO firm_feeds (firm_slug) SELECT slug FROM firms WHERE featured = 1 AND status = 'live' AND json_extract(data, '$.website') IS NOT NULL AND json_extract(data, '$.website') != ''"
  ).run();
  // Feeds with a known address are re-read daily; firms still without one are retried weekly.
  const { results } = await env.DB.prepare(
    `SELECT f.firm_slug AS slug, f.feed_url FROM firm_feeds f JOIN firms m ON m.slug = f.firm_slug
     WHERE f.enabled = 1 AND m.status = 'live' ${dev ? "AND f.source = 'manual'" : ''} AND (
       (f.feed_url IS NOT NULL AND (f.last_checked_at IS NULL OR f.last_checked_at < datetime('now', '-20 hours')))
       OR (f.feed_url IS NULL AND (f.last_checked_at IS NULL OR f.last_checked_at < datetime('now', '-7 days'))))
     ORDER BY f.last_checked_at LIMIT 14`
  ).all();
  const out = { checked: 0, ok: 0, failed: 0, discoveries: 0 };
  for (const r of results) {
    if (!r.feed_url && out.discoveries >= 4) continue; // discovery costs several requests; a few per night keeps us inside the platform limit (50 outgoing requests per run)
    if (!r.feed_url) out.discoveries++;
    const res = await refreshFirmFeed(env, r.slug);
    out.checked++;
    if (res.status === 'ok') out.ok++; else if (res.status === 'error') out.failed++;
  }
  await audit(env, null, 'feeds.refresh', 'system', 'nightly', out);
  return out;
}


// ---------------------------------------------------------------- settings (admin, or the firm's own owner)
// body: { enabled?: boolean, feedUrl?: string }. An empty feedUrl goes back to finding the feed automatically.
export async function updateFeedSettings(env, actor, slug, body, exec) {
  const keys = Object.keys(body);
  if (!keys.length || keys.some((k) => k !== 'enabled' && k !== 'feedUrl')) throw new HttpError(422, 'Send enabled and/or feedUrl.');
  if ('enabled' in body && typeof body.enabled !== 'boolean') throw new HttpError(422, 'enabled must be true or false.');
  let url;
  if ('feedUrl' in body) {
    const v = typeof body.feedUrl === 'string' ? body.feedUrl.trim() : '';
    if (v) { try { url = checkFeedUrl(v, { allowLocal: env.DEV_ECHO_LINK === '1' }).toString(); } catch (err) { throw new HttpError(422, err.message); } }
    else url = null;
  }
  if (!(await env.DB.prepare('SELECT 1 FROM firms WHERE slug = ?').bind(slug).first())) throw new HttpError(404, 'Firm not found');
  await env.DB.prepare('INSERT OR IGNORE INTO firm_feeds (firm_slug) VALUES (?)').bind(slug).run();
  const sets = [];
  const args = [];
  if ('enabled' in body) { sets.push('enabled = ?'); args.push(body.enabled ? 1 : 0); }
  if ('feedUrl' in body) { sets.push('feed_url = ?', 'source = ?', 'kind = ?', "status = 'pending'", 'last_error = NULL', 'last_checked_at = NULL'); args.push(url, url ? 'manual' : 'auto', url && isWpUrl(url) ? 'wp' : 'rss'); }
  await env.DB.prepare(`UPDATE firm_feeds SET ${sets.join(', ')} WHERE firm_slug = ?`).bind(...args, slug).run();
  if ('feedUrl' in body) await env.DB.prepare('DELETE FROM firm_posts WHERE firm_slug = ?').bind(slug).run(); // a new address starts fresh
  await audit(env, actor, 'feed.update', 'firm', slug, body);
  // Read it now when we know where it is; otherwise find it in the background (that takes a few requests).
  const row = await env.DB.prepare('SELECT feed_url, enabled FROM firm_feeds WHERE firm_slug = ?').bind(slug).first();
  if (row.enabled) {
    if (row.feed_url) await refreshFirmFeed(env, slug);
    else exec(refreshFirmFeed(env, slug).catch((err) => console.error('feed discovery failed', slug, err)));
  }
}

export async function checkFeedNow(env, actor, slug, { admin }, exec) {
  const row = await env.DB.prepare("SELECT feed_url, enabled, last_checked_at, (last_checked_at > datetime('now', ?)) AS recent FROM firm_feeds WHERE firm_slug = ?").bind(`-${FEED_LIMITS.recheckMinutes} minutes`, slug).first();
  if (!row) throw new HttpError(404, 'Blog cards are not set up for this firm yet.');
  if (!admin && row.recent) throw new HttpError(429, `Please wait a few minutes between checks.`);
  if (!row.feed_url) { exec(refreshFirmFeed(env, slug).catch((err) => console.error('feed discovery failed', slug, err))); return { status: 'pending' }; }
  return refreshFirmFeed(env, slug);
}
