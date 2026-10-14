// Talks to the Google Search Console API for lawdb.ca, so nobody has to click through it by hand.
//
// What the API allows (and what it does not):
//  - submit the sitemap, read its status and errors                         -> done here, every night and on demand
//  - URL Inspection: ask Google whether a page is on Google and why not    -> done here, a batch of pages per run
//  - "Request indexing" for ordinary pages: Google offers NO API for it (its Indexing API is for job postings and
//    livestreams only), so that single button stays manual in Search Console.
//
// Sign-in is a Google *service account*: its key is the Cloudflare secret GSC_SERVICE_ACCOUNT_JSON (never in the repo or in chat).
// We sign a short-lived token request with that key (RS256, Web Crypto) and trade it for an access token.
import { audit } from './audit.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters';
export const GSC_LIMITS = { batch: 40, keyPages: ['/', '/find-lawyers', '/news', '/for-firms'], timeoutMs: 15000 };

const dev = (env) => env.DEV_ECHO_LINK === '1';
const apiBase = (env) => (dev(env) && env.GSC_API_BASE) || 'https://www.googleapis.com';
const inspectBase = (env) => (dev(env) && env.GSC_API_BASE) || 'https://searchconsole.googleapis.com';
const tokenUrl = (env) => (dev(env) && env.GSC_TOKEN_URL) || 'https://oauth2.googleapis.com/token';

// The secret is the JSON file Google gives you. Returns null when it is missing or not usable.
export function gscKey(env) {
  if (!env.GSC_SERVICE_ACCOUNT_JSON) return null;
  try {
    const k = JSON.parse(env.GSC_SERVICE_ACCOUNT_JSON);
    if (typeof k.client_email !== 'string' || typeof k.private_key !== 'string' || !k.private_key.includes('PRIVATE KEY')) return null;
    return { email: k.client_email, privateKey: k.private_key.replace(/\\n/g, '\n') };
  } catch { return null; }
}

const b64url = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlText = (t) => b64url(new TextEncoder().encode(t));

async function signJwt(key, aud) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64urlText(JSON.stringify({ iss: key.email, scope: SCOPE, aud, iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(key.privateKey.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

let cached = { token: null, until: 0, email: '' };
async function accessToken(env) {
  const key = gscKey(env);
  if (!key) throw new Error('Google Search Console is not connected (secret GSC_SERVICE_ACCOUNT_JSON is missing or not the key file).');
  if (cached.token && cached.email === key.email && cached.until > Date.now() + 60000) return cached.token;
  const url = tokenUrl(env);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(key, url) }),
    signal: AbortSignal.timeout(GSC_LIMITS.timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google did not accept the key (${res.status}${data.error ? ' ' + data.error : ''}). Check the key file and that the Search Console API is enabled.`);
  cached = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000, email: key.email };
  return cached.token;
}

class GscError extends Error { constructor(message, status) { super(message); this.status = status; } }

async function gsc(env, method, url, body) {
  const token = await accessToken(env);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(GSC_LIMITS.timeoutMs),
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = data?.error?.message || res.statusText || 'error';
    if (res.status === 403) throw new GscError(`Google refused (403): ${why}. Make sure the service account's email is added as a user of the property in Search Console.`, 403);
    throw new GscError(`Google answered ${res.status}: ${why}`, res.status);
  }
  return data;
}

// The property to use: GSC_SITE if set, else the first of these that the service account can see.
let siteCache = { key: '', site: '' };
export async function findSite(env) {
  if (env.GSC_SITE) return env.GSC_SITE;
  const email = gscKey(env)?.email || '';
  if (siteCache.site && siteCache.key === email) return siteCache.site;
  const data = await gsc(env, 'GET', `${apiBase(env)}/webmasters/v3/sites`);
  const entries = (data.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  const host = new URL(env.SITE_ORIGIN || 'https://lawdb.ca').hostname.replace(/^www\./, '');
  const wanted = [`sc-domain:${host}`, `https://${host}/`, `https://www.${host}/`, `http://${host}/`];
  const hit = wanted.find((w) => entries.some((s) => s.siteUrl === w));
  if (!hit) throw new GscError(`The service account cannot see a property for ${host}. Add its email as a user in Search Console (Settings, Users and permissions).`, 403);
  siteCache = { key: email, site: hit };
  return hit;
}

const origin = (env) => (env.SITE_ORIGIN || 'https://lawdb.ca').replace(/\/+$/, '');
const sitemapUrl = (env) => `${origin(env)}/sitemap.xml`;

const stamp = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace('T', ' ') : null; }; // the format the admin screens read

// ---------------------------------------------------------------- settings stored in the database
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, typeof value === 'string' ? value : JSON.stringify(value)).run();
}
async function getSetting(env, key) {
  const r = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}
const getJson = async (env, key) => { try { return JSON.parse((await getSetting(env, key)) || 'null'); } catch { return null; } };

// ---------------------------------------------------------------- sitemap
export async function submitSitemap(env) {
  const site = await findSite(env);
  const sm = sitemapUrl(env);
  await gsc(env, 'PUT', `${apiBase(env)}/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(sm)}`);
  const at = stamp(Date.now());
  let status = null;
  try {
    const s = await gsc(env, 'GET', `${apiBase(env)}/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(sm)}`);
    status = {
      lastSubmitted: stamp(s.lastSubmitted), lastDownloaded: stamp(s.lastDownloaded), isPending: !!s.isPending,
      errors: Number(s.errors) || 0, warnings: Number(s.warnings) || 0,
      submitted: (s.contents || []).reduce((n, c) => n + (Number(c.submitted) || 0), 0),
    };
  } catch (err) { status = { note: 'Submitted; Google has not reported its reading of the sitemap yet.' }; }
  await setSetting(env, 'gsc_sitemap', { at, site, ...status });
  return { site, sitemap: sm, at, status };
}

// The page addresses in our own sitemap (read from the site's files, no outside request).
export async function sitemapUrls(env) {
  const res = await env.ASSETS.fetch(new Request('https://assets.local/sitemap.xml'));
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------- URL inspection
export async function inspectUrl(env, url, site) {
  site = site || (await findSite(env));
  const data = await gsc(env, 'POST', `${inspectBase(env)}/v1/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: site, languageCode: 'en' });
  const r = data.inspectionResult?.indexStatusResult || {};
  const row = {
    url, verdict: r.verdict || null, coverageState: r.coverageState || null, indexingState: r.indexingState || null,
    lastCrawlAt: r.lastCrawlTime ? String(r.lastCrawlTime).slice(0, 19).replace('T', ' ') : null,
    googleCanonical: r.googleCanonical || null, error: null,
  };
  await env.DB.prepare(
    `INSERT INTO search_pages (url, verdict, coverage_state, indexing_state, last_crawl_at, google_canonical, error, checked_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))
     ON CONFLICT (url) DO UPDATE SET verdict = excluded.verdict, coverage_state = excluded.coverage_state, indexing_state = excluded.indexing_state,
       last_crawl_at = excluded.last_crawl_at, google_canonical = excluded.google_canonical, error = NULL, checked_at = datetime('now')`
  ).bind(row.url, row.verdict, row.coverageState, row.indexingState, row.lastCrawlAt, row.googleCanonical).run();
  return row;
}

// One batch: the key pages first, then the next pages of the sitemap, round and round. Stops at the first sign-in/quota problem.
export async function inspectBatch(env, { limit = GSC_LIMITS.batch } = {}) {
  const site = await findSite(env);
  const all = await sitemapUrls(env);
  const keys = GSC_LIMITS.keyPages.map((p) => origin(env) + p);
  const rest = all.filter((u) => !keys.includes(u));
  const cursor = Math.max(0, Number(await getSetting(env, 'gsc_cursor')) || 0) % Math.max(rest.length, 1);
  const take = Math.max(0, limit - keys.length);
  const next = [];
  for (let i = 0; i < Math.min(take, rest.length); i++) next.push(rest[(cursor + i) % rest.length]);
  const queue = [...new Set([...keys, ...next])];
  let done = 0;
  let failed = 0;
  let stopped = null;
  // Google takes a few seconds per page, so five at a time: 40 pages in under a minute (a browser gives up on a request after about 100 seconds).
  let i = 0;
  const worker = async () => {
    while (!stopped && i < queue.length) {
      const url = queue[i++];
      try { await inspectUrl(env, url, site); done++; } catch (err) {
        failed++;
        await env.DB.prepare(
          `INSERT INTO search_pages (url, error, checked_at) VALUES (?,?,datetime('now')) ON CONFLICT (url) DO UPDATE SET error = excluded.error, checked_at = datetime('now')`
        ).bind(url, String(err.message).slice(0, 200)).run().catch(() => {});
        if (err.status === 401 || err.status === 403 || err.status === 429) stopped = err.message; // the others stop at their next page
      }
    }
  };
  await accessToken(env); // one sign-in before the five start, so they do not each ask Google for a token
  await Promise.all(Array.from({ length: 5 }, worker));
  await setSetting(env, 'gsc_cursor', String(rest.length ? (cursor + next.length) % rest.length : 0));
  return { checked: done, failed, stopped, totalInSitemap: all.length };
}

// ---------------------------------------------------------------- what the admin screen shows
export async function searchSummary(env) {
  const key = gscKey(env);
  const [states, total, sitemap, last, problems] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(coverage_state, CASE WHEN error IS NOT NULL THEN \'Could not be checked\' ELSE \'Unknown\' END) AS state, verdict, COUNT(*) AS n FROM search_pages GROUP BY 1, 2 ORDER BY n DESC').all(),
    env.DB.prepare('SELECT COUNT(*) AS n, MAX(checked_at) AS last FROM search_pages').first(),
    getJson(env, 'gsc_sitemap'),
    getJson(env, 'gsc_last_run'),
    env.DB.prepare("SELECT url, coverage_state AS state, last_crawl_at AS lastCrawlAt, error FROM search_pages WHERE verdict IS NOT 'PASS' ORDER BY checked_at DESC LIMIT 25").all(),
  ]);
  let sitemapCount = 0;
  try { sitemapCount = (await sitemapUrls(env)).length; } catch {}
  const onGoogle = states.results.filter((s) => s.verdict === 'PASS').reduce((n, s) => n + s.n, 0);
  return {
    connected: !!key, clientEmail: key?.email || null, site: env.GSC_SITE || sitemap?.site || null,
    sitemap, lastRun: last, sitemapPages: sitemapCount, pagesChecked: total.n, lastCheckedAt: total.last, onGoogle, notOnGoogle: total.n - onGoogle,
    states: states.results, problems: problems.results,
  };
}

// Everything a run does. `parts`: any of 'sitemap', 'inspect'. Records the outcome so the admin screen can show it.
export async function runSearchConsole(env, { parts = ['sitemap', 'inspect'], actor = null } = {}) {
  const out = { at: stamp(Date.now()), ok: true };
  if (!gscKey(env)) { out.ok = false; out.error = 'Not connected: the secret GSC_SERVICE_ACCOUNT_JSON is not set.'; return out; }
  try {
    if (parts.includes('sitemap')) out.sitemap = await submitSitemap(env);
    if (parts.includes('inspect')) out.inspect = await inspectBatch(env);
    if (out.inspect?.stopped) { out.ok = false; out.error = out.inspect.stopped; }
  } catch (err) { out.ok = false; out.error = String(err.message || err).slice(0, 300); }
  await setSetting(env, 'gsc_last_run', { at: out.at, ok: out.ok, error: out.error || null, checked: out.inspect?.checked ?? null, parts });
  await audit(env, actor, out.ok ? 'search.ok' : 'search.failed', 'search', 'gsc', { parts, error: out.error || null, checked: out.inspect?.checked ?? null });
  return out;
}

export const searchNightly = (env) => runSearchConsole(env, { parts: ['sitemap', 'inspect'] });
