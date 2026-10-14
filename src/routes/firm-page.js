// /firms/<slug>: serves the hand-built static page, or renders the page from the database for firms in
// 'dynamic' mode. Every success is cached at the edge for PUBLIC_CACHE_TTL seconds (default 60), so the
// database is read about once a minute per page, not once per visitor.
import { renderFirmPage } from '../render/firm-page.js';

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

export async function firmPage({ request, env, ctx }) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/firms\/([a-z0-9][a-z0-9-]*?)(\.html)?\/?$/);
  if (!m) return env.ASSETS.fetch(request);

  // The old .html address keeps redirecting to the clean one, exactly as before.
  if (m[2]) return Response.redirect(`${url.origin}/firms/${m[1]}${url.search}`, 307);

  const ttl = ttlOf(env);
  const key = new Request(url.origin + url.pathname, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }

  let row = null;
  try {
    row = await env.DB.prepare('SELECT data, hours, page_mode, about, status FROM firms WHERE slug = ?').bind(m[1]).first();
  } catch (err) {
    console.error('firm lookup failed, serving static page', m[1], err);
    return env.ASSETS.fetch(request);
  }

  if (!row || row.status !== 'live' || row.page_mode !== 'dynamic') {
    const res = await env.ASSETS.fetch(request); // the original page (or a 404 for an unknown firm)
    if (res.status === 200 && ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  }

  let html;
  try {
    const firm = { ...JSON.parse(row.data), about: row.about || '' };
    const hours = row.hours ? JSON.parse(row.hours) : null;
    const photos = (await env.DB.prepare("SELECT id, alt FROM firm_images WHERE firm_slug = ? AND kind = 'photo' ORDER BY created_at, id").bind(m[1]).all()).results;
    html = renderFirmPage({ firm, hours, images: photos, nearby: await nearbyFirms(env, firm), origin: env.SITE_ORIGIN || url.origin });
  } catch (err) {
    console.error('profile render failed', m[1], err);
    return env.ASSETS.fetch(request);
  }
  const res = new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-lawdb-source': 'database',
    },
  });
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
