// Serves pictures to the public: GET /img/<id>. Only pictures that are still listed in the database,
// for firms that are live, are served, so removing a picture takes effect even if the file lingers in storage.

import { imageCacheKey } from '../lib/images.js';

const text404 = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function serveImage({ request, env, ctx }) {
  const named = new URL(request.url).pathname.slice('/img/'.length);
  // /img/lawyer/<id> is a lawyer's picture the admin accepted (src/lib/lawyer-photos.js); it has no row in firm_images, its record is the firm's `lawyerPhotos`
  const lawyerPic = /^lawyer\/[0-9a-f]{24}$/.test(named);
  const id = lawyerPic ? named.slice('lawyer/'.length) : named;
  if (!/^[0-9a-f]{24}$/.test(id) || !env.IMAGES) return text404();

  const ttl = Number(env.PUBLIC_CACHE_TTL ?? 60);
  const key = imageCacheKey(id);
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  const row = lawyerPic ? { content_type: '' } : await env.DB.prepare(
    "SELECT i.content_type FROM firm_images i JOIN firms f ON f.slug = i.firm_slug WHERE i.id = ? AND f.status = 'live'"
  ).bind(id).first();
  if (!row) return text404();
  const obj = await env.IMAGES.get(`${lawyerPic ? 'lawyer' : 'img'}/${id}`);
  if (!obj) return text404();
  if (lawyerPic) {
    // the file is removed from storage when the picture is erased, so what is still there is what was accepted; only a picture type is ever served
    row.content_type = obj.httpMetadata && obj.httpMetadata.contentType;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(row.content_type)) return text404();
  }

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
