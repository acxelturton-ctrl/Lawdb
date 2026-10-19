// Public pages and data files that are rendered from the database at the edge.
//
// The static site ships firms_data.json, blog_data.json, firms_hours.json, and 65 pages (find-lawyers,
// the city hubs, two province hubs) with the whole firm list baked into an inline <script>. Those
// static files are now only the FALLBACK: when the database answers, visitors get live data, so admin
// edits show up everywhere within the cache window. If the database fails for any reason, the static
// file is served unchanged, so these pages can never go down because of the database.
import { withHomeNews } from './home-news.js';

const cacheSeconds = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

// What the browser needs to list and map a firm. These stay in the database (and on the firm's own page) but are not sent with the
// directory list: a Maps link nobody reads, a one-line blurb, the picture files of the firm's own page, and the Directions link, which the
// page rebuilds from the address (see SHIM). Together they were about a third of the list.
export const DROPPED_FIELDS = ['mapsUrl', 'blurb', 'dirUrl', 'heroImage', 'bioImage', 'details'];
const slimRow = (json) => {
  const o = JSON.parse(json);
  for (const k of DROPPED_FIELDS) delete o[k];
  return JSON.stringify(o);
};

// The firm list as JSON. With a province, only that province's firms (a city page lists one province; lawdb-map.js fetches the rest
// the first time someone uses the search box).
async function firmsBody(env, province = null) {
  const st = env.DB.prepare("SELECT data FROM firms WHERE status = 'live'" + (province ? ' AND province = ?' : '') + ' ORDER BY rowid');
  const { results } = await (province ? st.bind(province) : st).all();
  return '[' + results.map((r) => slimRow(r.data)).join(',') + ']';
}

// A city page or province hub lists one province; /find-lawyers and anything else gets everything.
const SCOPES = { ontario: 'ON', quebec: 'QC', 'british-columbia': 'BC', alberta: 'AB', manitoba: 'MB' };
export const scopeOf = (pathname) => SCOPES[pathname.split('/')[1]] || null;

// Runs right after the list: the Directions link is rebuilt from the address.
const SHIM = "\nfirms.forEach(function(f){ if(!f.dirUrl) f.dirUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(f.address || f.name).replace(/%20/g, '+'); });";

async function blogBody(env) {
  const { results } = await env.DB.prepare('SELECT data FROM blog_posts ORDER BY sort_order').all();
  return '[' + results.map((r) => r.data).join(',') + ']';
}

async function hoursBody(env) {
  const { results } = await env.DB.prepare("SELECT slug, hours FROM firms WHERE hours IS NOT NULL AND status = 'live' ORDER BY rowid").all();
  return '{' + results.map((r) => JSON.stringify(r.slug) + ':' + r.hours).join(',') + '}';
}

// Safe to embed inside an HTML <script>: no "</script>" and no JS line-separator surprises.
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const forScript = (json) => json.replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

const INLINE_FIRMS = /^const firms = \[.*\];$/gm;

// Totals typed into a static page (home page, For Law Firms, the Browse-by-city chips) are marked data-live="firms" | "cities" | "city:PROV|City".
// The numbers in the file are the fallback; when the database answers, the page shows today's count, so a firm that lists itself or a batch
// that is released never leaves a stale number behind.
async function liveStats(env) {
  const total = await env.DB.prepare("SELECT COUNT(*) AS firms, COUNT(DISTINCT province || '|' || city) AS cities FROM firms WHERE status = 'live'").first();
  const { results } = await env.DB.prepare("SELECT province || '|' || city AS k, COUNT(*) AS n FROM firms WHERE status = 'live' GROUP BY 1").all();
  return { firms: total.firms, cities: total.cities, byCity: Object.fromEntries(results.map((r) => [r.k, r.n])) };
}
const withLiveStats = async (html, stats) => {
  const num = (n) => Number(n).toLocaleString('en-CA');
  return new HTMLRewriter().on('[data-live]', {
    element(el) {
      const k = el.getAttribute('data-live');
      const v = k === 'firms' ? stats.firms : k === 'cities' ? stats.cities : k.startsWith('city:') ? stats.byCity[k.slice(5)] : undefined;
      if (v !== undefined) el.setInnerContent(num(v));
    },
  }).transform(new Response(html)).text();
};

const cacheKey = (request) => {
  const u = new URL(request.url);
  return new Request(u.origin + u.pathname, { method: 'GET' }); // one entry per path, ignoring query strings
};

const respond = (body, contentType, ttl) =>
  new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-lawdb-source': 'database',
    },
  });

async function serveData({ request, env, ctx }, build) {
  const ttl = cacheSeconds(env);
  const key = cacheKey(request);
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  let body;
  try {
    body = await build();
  } catch (err) {
    console.error('database read failed, serving static file', new URL(request.url).pathname, err);
    return env.ASSETS.fetch(request);
  }
  const res = respond(body, 'application/json; charset=utf-8', ttl);
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

export const firmsJson = (c) => serveData(c, () => firmsBody(c.env));
export const blogJson = (c) => serveData(c, () => blogBody(c.env));
export const hoursJson = (c) => serveData(c, () => hoursBody(c.env));

// Any HTML page that carries the inline firm list gets the database's list instead.
// Everything else (redirects, 404s, pages without the list) passes through untouched.
export async function page({ request, env, ctx }) {
  const ttl = cacheSeconds(env);
  const key = cacheKey(request);
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 200 || !(asset.headers.get('content-type') || '').includes('text/html')) return asset;

  const html = await asset.text();
  const passthrough = () => new Response(html, { status: asset.status, headers: asset.headers });
  if (html.includes('data-live="')) {
    let live;
    try { live = await withLiveStats(html, await liveStats(env)); } catch (err) { console.error('live totals failed, serving static page', new URL(request.url).pathname, err); return passthrough(); }
    try { live = await withHomeNews(live, env); } catch (err) { console.error('home news failed', err); } // the home page's LawDB News feed (does nothing on other pages, and never fails the page)
    const res = respond(live, 'text/html; charset=utf-8', ttl);
    if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  }
  if ((html.match(INLINE_FIRMS) || []).length !== 1) return passthrough(); // not a page we know how to refresh

  let out;
  try {
    const scope = scopeOf(new URL(request.url).pathname);
    const json = forScript(await firmsBody(env, scope));
    // function replacer: "$" in data must not be interpreted
    out = html.replace(INLINE_FIRMS, () => `const firms = ${json};${SHIM}${scope ? `\nvar LAWDB_SCOPE = ${JSON.stringify(scope)};` : ''}`);
  } catch (err) {
    console.error('database read failed, serving static page', new URL(request.url).pathname, err);
    return passthrough();
  }
  const res = respond(out, 'text/html; charset=utf-8', ttl);
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
