// Reads a firm's public blog feed (RSS or Atom) and keeps its latest few posts as small cards:
// headline, date, a short plain-text excerpt, and a link to the article on the firm's own website.
//
// Rules that keep this safe and fair to the firms:
//  - only the excerpt the feed itself publishes is used, cut to 600 characters; full articles are never stored or shown;
//  - all markup is stripped (text only), and every link must point at the firm's own site (or the feed's host);
//  - only public https addresses are fetched (no IP addresses, no internal names), with a timeout and a size cap.

import { audit } from './audit.js';
import { HttpError } from './http.js';

export const FEED_LIMITS = { posts: 6, excerpt: 600, title: 200, bytes: 1_500_000, pageBytes: 600_000, timeoutMs: 8000, redirects: 3, recheckMinutes: 5 };
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
    posts.push({ guid: guid.slice(0, 300), title, url, publishedAt: published, excerpt });
  }
  posts.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return posts.slice(0, FEED_LIMITS.posts);
}

// ---------------------------------------------------------------- finding and refreshing
export async function discoverFeed(env, siteUrl) {
  const home = await safeGet(env, siteUrl, { maxBytes: FEED_LIMITS.pageBytes, accept: 'text/html,*/*' }).catch(() => null);
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
  const origin = new URL(home ? home.url : siteUrl).origin;
  for (const p of COMMON_PATHS) candidates.push(origin + p);
  let tried = 0;
  for (const c of [...new Set(candidates)]) {
    if (tried++ >= 6) break; // stays well inside the platform's limit on outgoing requests
    try {
      const { url, text } = await safeGet(env, c, { maxBytes: FEED_LIMITS.bytes, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' });
      if (/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 2000)) && parseFeed(text, { feedUrl: url, siteUrl, allowLocal: env.DEV_ECHO_LINK === '1' }).length) return url;
    } catch { /* try the next one */ }
  }
  return null;
}

export async function getFeedInfo(env, slug) {
  const row = await env.DB.prepare('SELECT feed_url AS feedUrl, source, enabled, status, last_checked_at AS lastCheckedAt, last_error AS lastError FROM firm_feeds WHERE firm_slug = ?').bind(slug).first();
  const { results } = await env.DB.prepare('SELECT title, url, published_at AS publishedAt FROM firm_posts WHERE firm_slug = ? ORDER BY published_at DESC, id DESC').bind(slug).all();
  return { feed: row ? { ...row, enabled: !!row.enabled } : null, posts: results };
}

// Checks one firm's feed now. `discover` also looks for the feed if none is known yet.
export async function refreshFirmFeed(env, slug, { discover = true } = {}) {
  const firm = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(slug).first();
  if (!firm) throw new Error('Firm not found');
  const website = JSON.parse(firm.data).website || '';
  await env.DB.prepare('INSERT OR IGNORE INTO firm_feeds (firm_slug) VALUES (?)').bind(slug).run();
  const row = await env.DB.prepare('SELECT feed_url, source FROM firm_feeds WHERE firm_slug = ?').bind(slug).first();
  let feedUrl = row.feed_url;
  const set = (status, error, url = feedUrl) =>
    env.DB.prepare("UPDATE firm_feeds SET status = ?, last_error = ?, feed_url = ?, last_checked_at = datetime('now') WHERE firm_slug = ?").bind(status, error ? String(error).slice(0, 200) : null, url, slug).run();
  try {
    if (!feedUrl) {
      if (!website || !discover) { await set('none', website ? null : 'The firm has no website on file.'); return { status: 'none', posts: 0 }; }
      feedUrl = await discoverFeed(env, website);
      if (!feedUrl) { await set('none', 'No blog feed was found on the website.', null); return { status: 'none', posts: 0 }; }
    }
    const { url, text } = await safeGet(env, feedUrl, { maxBytes: FEED_LIMITS.bytes, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' });
    if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 2000))) throw new Error('That address is not an RSS or Atom feed.');
    const posts = parseFeed(text, { feedUrl: url, siteUrl: website || url, allowLocal: env.DEV_ECHO_LINK === '1' });
    if (!posts.length) throw new Error('The feed has no posts that link to the firm\'s own website.');
    await env.DB.batch([
      ...posts.map((p) => env.DB.prepare(
        `INSERT INTO firm_posts (firm_slug, guid, title, url, published_at, excerpt) VALUES (?,?,?,?,?,?)
         ON CONFLICT (firm_slug, guid) DO UPDATE SET title = excluded.title, url = excluded.url, published_at = excluded.published_at, excerpt = excluded.excerpt, fetched_at = datetime('now')`
      ).bind(slug, p.guid, p.title, p.url, p.publishedAt, p.excerpt)),
      // Keep only the newest few.
      env.DB.prepare(`DELETE FROM firm_posts WHERE firm_slug = ? AND id NOT IN (SELECT id FROM firm_posts WHERE firm_slug = ? ORDER BY published_at DESC, id DESC LIMIT ${FEED_LIMITS.posts})`).bind(slug, slug),
    ]);
    await set('ok', null, url);
    return { status: 'ok', posts: posts.length };
  } catch (err) {
    await set('error', err.message);
    return { status: 'error', error: err.message, posts: 0 };
  }
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
  if ('feedUrl' in body) { sets.push('feed_url = ?', "source = ?", "status = 'pending'", 'last_error = NULL', 'last_checked_at = NULL'); args.push(url, url ? 'manual' : 'auto'); }
  await env.DB.prepare(`UPDATE firm_feeds SET ${sets.join(', ')} WHERE firm_slug = ?`).bind(...args, slug).run();
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
