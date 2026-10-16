// Firm pictures: validation, storage in R2, and keeping the firm's public record in step.
//
// Safety: the file type is decided by reading the file's own first bytes (never the browser's claim),
// only JPEG, PNG and WebP are accepted (no SVG, which can carry scripts), size and dimensions are capped,
// and pictures are always served with headers that stop a browser treating them as anything else.

import { HttpError } from './http.js';
import { audit } from './audit.js';
import { checkOwnerText } from './content-rules.js';

export const IMAGE_RULES = { maxBytes: 3 * 1024 * 1024, minSide: 64, maxSide: 8000, maxPhotos: 6, perUserPerHour: 20 };
const KINDS = ['logo', 'cover', 'photo'];
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

// Reads the real format and pixel size from the file itself. Returns null for anything else.
export function imageInfo(b) {
  if (b.length < 30) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m === 0xff) { o++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      const len = u16be(b, o + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) {
        return { format: 'jpeg', height: u16be(b, o + 5), width: u16be(b, o + 7) };
      }
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(b, 12, 4) === 'IHDR') {
    return { format: 'png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') return { format: 'webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { format: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { format: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  return null;
}

// Same key for reading, writing and clearing the edge cache entry of a picture.
export const imageCacheKey = (id) => new Request(`https://cache.invalid/img/${id}`);

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function listImages(env, slug) {
  const { results } = await env.DB.prepare(
    'SELECT id, kind, alt, bytes, width, height, created_at AS createdAt FROM firm_images WHERE firm_slug = ? ORDER BY kind, created_at, id'
  ).bind(slug).all();
  return results.map((r) => ({ ...r, url: `/img/${r.id}` }));
}

// Logo and cover live in the firm's public record (the same fields the hand-built pages already use), so every
// directory page, map card and search result shows them. The original file name is remembered for undoing.
async function syncFirm(env, slug) {
  const row = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(slug).first();
  if (!row) return;
  const firm = JSON.parse(row.data);
  const { results } = await env.DB.prepare("SELECT kind, id FROM firm_images WHERE firm_slug = ? AND kind IN ('logo','cover') ORDER BY created_at DESC, id").bind(slug).all();
  const logo = results.find((r) => r.kind === 'logo');
  const cover = results.find((r) => r.kind === 'cover');
  const mine = (v) => typeof v === 'string' && v.startsWith('img/');
  if (logo) {
    if (firm.src && !mine(firm.src) && !firm.origSrc) firm.origSrc = firm.src;
    firm.type = 'logo';
    firm.src = `img/${logo.id}`;
  } else if (mine(firm.src)) {
    if (firm.origSrc) { firm.src = firm.origSrc; firm.type = 'logo'; delete firm.origSrc; } else { delete firm.src; firm.type = 'mono'; }
  }
  if (cover) {
    if (firm.heroImage && !mine(firm.heroImage) && !firm.origHero) firm.origHero = firm.heroImage;
    firm.heroImage = `img/${cover.id}`;
  } else if (mine(firm.heroImage)) {
    if (firm.origHero) { firm.heroImage = firm.origHero; delete firm.origHero; } else delete firm.heroImage;
  }
  await env.DB.prepare("UPDATE firms SET data = ?, updated_at = datetime('now') WHERE slug = ?").bind(JSON.stringify(firm), slug).run();
}

export async function addImage(env, actor, slug, request, { admin }) {
  if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || 'photo';
  if (!KINDS.includes(kind)) throw new HttpError(422, `kind must be one of: ${KINDS.join(', ')}`);
  let alt = (url.searchParams.get('alt') || '').trim().slice(0, 120);
  if (alt && !admin) checkOwnerText('Picture description', alt);

  const firm = await env.DB.prepare('SELECT name FROM firms WHERE slug = ?').bind(slug).first();
  if (!firm) throw new HttpError(404, 'Firm not found');

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM firm_images WHERE uploaded_by = ? AND created_at > datetime('now','-1 hour')").bind(actor.id).first();
  if (recent.n >= (admin ? 300 : IMAGE_RULES.perUserPerHour)) throw new HttpError(429, 'Too many uploads this hour. Please try again later.');
  if (kind === 'photo') {
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM firm_images WHERE firm_slug = ? AND kind = 'photo'").bind(slug).first();
    if (c.n >= IMAGE_RULES.maxPhotos) throw new HttpError(409, `A firm can have up to ${IMAGE_RULES.maxPhotos} photos. Remove one first.`);
  }

  const declared = Number(request.headers.get('content-length'));
  if (declared && declared > IMAGE_RULES.maxBytes + 1024) throw new HttpError(413, `Pictures can be up to ${IMAGE_RULES.maxBytes / 1024 / 1024} MB.`);
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length) throw new HttpError(422, 'No picture was sent.');
  if (body.length > IMAGE_RULES.maxBytes) throw new HttpError(413, `Pictures can be up to ${IMAGE_RULES.maxBytes / 1024 / 1024} MB.`);
  const info = imageInfo(body);
  if (!info) throw new HttpError(415, 'Please upload a JPEG, PNG or WebP picture.');
  const { width, height } = info;
  if (!(width >= IMAGE_RULES.minSide && height >= IMAGE_RULES.minSide)) throw new HttpError(422, `The picture is too small. Each side must be at least ${IMAGE_RULES.minSide} pixels.`);
  if (width > IMAGE_RULES.maxSide || height > IMAGE_RULES.maxSide) throw new HttpError(422, `The picture is too large. Each side can be at most ${IMAGE_RULES.maxSide} pixels.`);

  const id = hex(12);
  const contentType = MIME[info.format];
  await env.IMAGES.put(`img/${id}`, body, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare('INSERT INTO firm_images (id, firm_slug, kind, alt, content_type, bytes, width, height, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, slug, kind, alt || null, contentType, body.length, width, height, actor.id).run();
  } catch (err) {
    await env.IMAGES.delete(`img/${id}`).catch(() => {});
    throw err;
  }
  // A new logo or cover replaces the old one.
  let replaced = [];
  if (kind !== 'photo') {
    const { results } = await env.DB.prepare('SELECT id FROM firm_images WHERE firm_slug = ? AND kind = ? AND id != ?').bind(slug, kind, id).all();
    replaced = results.map((r) => r.id);
    if (replaced.length) {
      await env.DB.batch(replaced.map((rid) => env.DB.prepare('DELETE FROM firm_images WHERE id = ?').bind(rid)));
      await env.IMAGES.delete(replaced.map((rid) => `img/${rid}`)).catch(() => {});
    }
  }
  await syncFirm(env, slug);
  await audit(env, actor, 'image.add', 'firm', slug, { id, kind, bytes: body.length, width, height, replaced });
  return { id, kind, alt: alt || null, url: `/img/${id}`, bytes: body.length, width, height };
}

export async function removeImage(env, actor, slug, id) {
  const img = await env.DB.prepare('SELECT id, kind FROM firm_images WHERE id = ? AND firm_slug = ?').bind(id, slug).first();
  if (!img) throw new HttpError(404, 'Picture not found');
  await env.DB.prepare('DELETE FROM firm_images WHERE id = ?').bind(id).run();
  await syncFirm(env, slug);
  if (env.IMAGES) await env.IMAGES.delete(`img/${id}`).catch((err) => console.error('image delete failed', id, err));
  await caches.default.delete(imageCacheKey(id)).catch(() => {});
  await audit(env, actor, 'image.remove', 'firm', slug, { id, kind: img.kind });
}
