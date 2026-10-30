// GET /new-firms: the most recently added live firms that have both a logo and a cover, newest first, built from the database.
// Firms are added in order, so the newest have the highest row number.
import { renderNewFirmsPage } from '../render/new-firms-page.js';
import { safeUrl } from '../render/firm-page.js';

const SHOWN = 48;
const SCAN = 300; // newest rows read; most of them have a logo and a cover, and the rest are skipped

const ttlOf = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

// Live firms with a logo (uploaded or remote) and a cover picture, newest first.
const WITH_PICTURES = "SELECT slug, province, city, featured, data FROM firms WHERE status = 'live'" +
  " AND json_extract(data, '$.heroImage') IS NOT NULL AND json_extract(data, '$.heroImage') != ''" +
  " AND ((json_extract(data, '$.src') IS NOT NULL AND json_extract(data, '$.src') != '') OR (json_extract(data, '$.logoUrl') IS NOT NULL AND json_extract(data, '$.logoUrl') != ''))" +
  ' ORDER BY rowid DESC LIMIT ?';

export async function newFirmsPage({ request, env, ctx }) {
  const ttl = ttlOf(env);
  const key = new Request(`${new URL(request.url).origin}/new-firms`, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  try {
    const { results } = await env.DB.prepare(WITH_PICTURES).bind(SCAN).all();
    const firms = [];
    for (const r of results) {
      if (firms.length >= SHOWN) break;
      const d = JSON.parse(r.data);
      const cover = safeUrl(d.heroImage);
      const logo = safeUrl(d.src) || safeUrl(d.logoUrl);
      if (!cover || !logo) continue; // only firms that have both
      firms.push({
        slug: r.slug, name: d.name || r.slug, city: r.city, province: r.province, featured: !!r.featured, coverPos: d.heroPos,
        tags: (Array.isArray(d.tags) ? d.tags : []).filter((t) => typeof t === 'string' && t),
        cover, logo,
      });
    }
    const res = new Response(renderNewFirmsPage({ firms }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache', 'x-content-type-options': 'nosniff', 'x-lawdb-source': 'database' },
    });
    if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error('new firms page failed', err);
    return new Response('<!DOCTYPE html><meta charset="UTF-8"><title>New listed firms | LawDB.ca</title><p>New listed firms are unavailable right now. Please try again shortly.</p>', {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
