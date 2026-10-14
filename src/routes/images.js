// Serves pictures to the public: GET /img/<id>. Only pictures that are still listed in the database,
// for firms that are live, are served, so removing a picture takes effect even if the file lingers in storage.

import { imageCacheKey } from '../lib/images.js';

const text404 = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function serveImage({ request, env, ctx }) {
  const id = new URL(request.url).pathname.slice('/img/'.length);
  if (!/^[0-9a-f]{24}$/.test(id) || !env.IMAGES) return text404();

  const ttl = Number(env.PUBLIC_CACHE_TTL ?? 60);
  const key = imageCacheKey(id);
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  const row = await env.DB.prepare(
    "SELECT i.content_type FROM firm_images i JOIN firms f ON f.slug = i.firm_slug WHERE i.id = ? AND f.status = 'live'"
  ).bind(id).first();
  if (!row) return text404();
  const obj = await env.IMAGES.get(`img/${id}`);
  if (!obj) return text404();

  const res = new Response(obj.body, {
    headers: {
      'content-type': row.content_type,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      // Even if a file were somehow not an image, a browser must not run it.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'cross-origin-resource-policy': 'cross-origin',
    },
  });
  if (ttl > 0) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
