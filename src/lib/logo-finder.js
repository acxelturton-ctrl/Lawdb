// Logo finder (admin only): looks at a firm's own website for its logo, shows the candidates, and an admin accepts one.
// Nothing is saved without a person choosing it. A picture is only used if it is a real JPEG, PNG or WebP of a sensible size
// (the same checks as any upload), and only public https addresses are fetched.

import { checkFeedUrl } from './feeds.js';
import { imageInfo, IMAGE_RULES } from './images.js';
import { HttpError } from './http.js';

const UA = 'LawDB-LogoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const TIMEOUT = 8000;
const HEAD_BYTES = 96 * 1024; // enough of a picture to read its size

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
};
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

async function getBinary(env, raw, { maxBytes, accept }) {
  const allowLocal = env.DEV_ECHO_LINK === '1';
  let url = checkFeedUrl(raw, { allowLocal }).toString();
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = checkFeedUrl(new URL(res.headers.get('location'), url).toString(), { allowLocal }).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The website answered ${res.status}.`);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      chunks.push(value);
      if (total >= maxBytes) { await reader.cancel().catch(() => {}); break; }
    }
    const bytes = new Uint8Array(Math.min(total, maxBytes));
    let o = 0;
    for (const c of chunks) { const take = c.subarray(0, Math.min(c.length, bytes.length - o)); bytes.set(take, o); o += take.length; if (o >= bytes.length) break; }
    return { url, bytes, truncated: total >= maxBytes };
  }
  throw new Error('Too many redirects.');
}

// Pure: picks logo-like pictures out of a page. Highest score first. SVG, GIF and ICO files are skipped (they cannot be used).
export function logoCandidates(html, pageUrl) {
  const head = html.slice(0, 250_000);
  const found = new Map();
  const add = (href, source, score) => {
    if (!href) return;
    let u;
    try { u = new URL(decode(href).trim(), pageUrl); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || /\.(svg|gif|ico)(\?|$)/i.test(u.pathname) || /^data:/i.test(href)) return;
    u.hash = '';
    const key = u.toString();
    if (!found.has(key) || found.get(key).score < score) found.set(key, { url: key, source, score });
  };
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel || '').toLowerCase();
    const size = Number((a.sizes || '').split('x')[0]) || 0;
    if (rel.includes('apple-touch-icon')) add(a.href, 'site icon', 60 + Math.min(size, 512) / 10);
    else if (/\bicon\b/.test(rel) && /png|webp|jpe?g/i.test(a.type || a.href || '') && size >= 96) add(a.href, 'site icon', 40 + Math.min(size, 512) / 20);
  }
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.property || a.name || '').toLowerCase() === 'og:image') add(a.content, 'share picture', 30);
  }
  for (const m of head.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const src = a.src || a['data-src'] || a['data-lazy-src'];
    const hint = `${src || ''} ${a.alt || ''} ${a.class || ''} ${a.id || ''}`;
    if (/logo|brand/i.test(hint) && !/(partner|client|badge|award|winner|member|sponsor|facebook|twitter|linkedin|instagram|google|clio|association|as[-_ ]seen|seen[-_ ]on|featured[-_ ]in|press|media|news|forbes|cbc|lawzen|avvo|martindale|superlawyers|best[-_ ]lawyers|recogni[sz]ed|ranked|rating|reader|accredit|certified|university|college|alumni|\bubc\b)/i.test(hint)) add(src, 'logo on the page', 90);
  }
  return [...found.values()].sort((x, y) => y.score - x.score).slice(0, 5);
}

// Looks at the website, then checks each candidate really is a usable picture. Returns at most 3.
export async function findLogos(env, website) {
  const page = await getBinary(env, website, { maxBytes: 400_000, accept: 'text/html,application/xhtml+xml' });
  const html = new TextDecoder('utf-8').decode(page.bytes);
  const out = [];
  for (const c of logoCandidates(html, page.url)) {
    try {
      const { bytes } = await getBinary(env, c.url, { maxBytes: HEAD_BYTES, accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' });
      const info = imageInfo(bytes);
      if (!info || info.width < IMAGE_RULES.minSide || info.height < IMAGE_RULES.minSide || info.width > IMAGE_RULES.maxSide || info.height > IMAGE_RULES.maxSide) continue;
      out.push({ url: c.url, source: c.source, width: info.width, height: info.height, format: info.format });
      if (out.length >= 3) break;
    } catch { /* that candidate is not usable */ }
  }
  return out;
}

// The whole picture, for the preview and for saving. Never returns anything that is not a real JPEG, PNG or WebP.
export async function fetchPicture(env, url) {
  let got;
  try { got = await getBinary(env, url, { maxBytes: IMAGE_RULES.maxBytes + 1, accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' }); }
  catch (err) { throw new HttpError(422, String(err.message || err).slice(0, 160)); }
  const { bytes, truncated } = got;
  if (truncated || bytes.length > IMAGE_RULES.maxBytes) throw new HttpError(413, `Pictures can be up to ${IMAGE_RULES.maxBytes / 1024 / 1024} MB.`);
  const info = imageInfo(bytes);
  if (!info) throw new HttpError(415, 'That address is not a JPEG, PNG or WebP picture.');
  return { bytes, info };
}
