// Public pages and data files that are rendered from the database at the edge.
//
// The static site ships firms_data.json, blog_data.json, firms_hours.json, and 65 pages (find-lawyers,
// the city hubs, two province hubs) with the whole firm list baked into an inline <script>. Those
// static files are now only the FALLBACK: when the database answers, visitors get live data, so admin
// edits show up everywhere within the cache window. If the database fails for any reason, the static
// file is served unchanged, so these pages can never go down because of the database.

const cacheSeconds = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

// Raw JSON strings straight from D1 (the `data` column already holds JSON), joined without a parse/stringify round trip.
async function firmsBody(env) {
  const { results } = await env.DB.prepare('SELECT data FROM firms ORDER BY rowid').all();
  return '[' + results.map((r) => r.data).join(',') + ']';
}

async function blogBody(env) {
  const { results } = await env.DB.prepare('SELECT data FROM blog_posts ORDER BY sort_order').all();
  return '[' + results.map((r) => r.data).join(',') + ']';
}

async function hoursBody(env) {
  const { results } = await env.DB.prepare('SELECT slug, hours FROM firms WHERE hours IS NOT NULL ORDER BY rowid').all();
  return '{' + results.map((r) => JSON.stringify(r.slug) + ':' + r.hours).join(',') + '}';
}

// Safe to embed inside an HTML <script>: no "</script>" and no JS line-separator surprises.
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const forScript = (json) => json.replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

const INLINE_FIRMS = /^const firms = \[.*\];$/gm;

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
  if ((html.match(INLINE_FIRMS) || []).length !== 1) return passthrough(); // not a page we know how to refresh

  let out;
  try {
    const json = forScript(await firmsBody(env));
    out = html.replace(INLINE_FIRMS, () => `const firms = ${json};`); // function replacer: "$" in data must not be interpreted
  } catch (err) {
    console.error('database read failed, serving static page', new URL(request.url).pathname, err);
    return passthrough();
  }
  const res = respond(out, 'text/html; charset=utf-8', ttl);
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
