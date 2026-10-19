// Second look for a cover picture, for firms that still have none: the pictures on the firm's OWN home page (the large banner or hero picture,
// a team or office photo), not only the share picture the first search used (scripts/find-firm-photos.mjs).
//   NODE_USE_ENV_PROXY=1 node scripts/find-firm-covers.mjs <out-dir> [--limit=N]
// Public https only; a site's robots.txt is honoured (a home page it disallows for everyone is not read); same checks as every picture the
// site takes (a real JPEG, PNG or WebP, big enough). Logos, icons, badges, social and payment pictures are skipped by name, and a picture that
// turns up on more than one firm's site (a theme's stock banner) is dropped. Writes up to two candidates per firm to <out-dir> and a
// manifest.json. NOTHING goes on the site until a person has looked at the pictures: scripts/apply-firm-photos.mjs only uses what is listed
// in data/firm-photos.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/find-firm-covers.mjs <out-dir> [--limit=N]'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
mkdirSync(out, { recursive: true });
const UA = 'LawDB-PhotoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const MAX_BYTES = 6 * 1024 * 1024;

// firms that still have no cover picture
const photos = JSON.parse(readFileSync('data/firm-photos.json', 'utf8'));
const have = new Set(Object.entries(photos).filter(([, p]) => p.kind === 'cover').map(([s]) => s.replace(/\+cover$/, '')));
const firms = [];
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) {
  const page = readFileSync(`firms/${f.slug}.html`, 'utf8');
  const cover = page.match(/<div class="li-cover([^"]*)">/);
  if (f.heroImage || have.has(f.slug) || (cover && !/\bgen\b/.test(cover[1]))) continue;
  firms.push({ slug: f.slug, website: f.website });
}
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) if (!f.heroImage && !have.has(f.slug)) firms.push({ slug: f.slug, website: f.website });
}

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

async function get(url, accept, max, asText = false) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(String(res.status));
  if (!/^https:/i.test(res.url)) throw new Error('not https');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('too big');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > max) throw new Error('too big');
  return { bytes, url: res.url, type: res.headers.get('content-type') || '' };
}

// robots.txt: "Disallow" lines under User-agent: * (or us)
const robotsCache = new Map();
async function allowed(origin, path) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const res = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return [];
        const rules = []; let applies = false, sawAgent = false;
        for (const raw of (await res.text()).split(/\r?\n/)) {
          const line = raw.replace(/#.*$/, '').trim();
          const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
          if (!m) continue;
          const k = m[1].toLowerCase();
          if (k === 'user-agent') { if (!sawAgent) applies = false; sawAgent = true; if (m[2].trim() === '*' || /lawdb/i.test(m[2])) applies = true; }
          else { sawAgent = false; if (applies && k === 'disallow' && m[2].trim()) rules.push(m[2].trim()); }
        }
        return rules;
      } catch { return []; }
    })());
  }
  const rules = await robotsCache.get(origin);
  return !rules.some((r) => (r === '/' ? true : !!r.split('*')[0] && path.startsWith(r.split('*')[0])));
}

const SKIP_NAME = /(logo|icon|favicon|sprite|avatar|badge|award|seal|trust|rating|review|star|social|facebook|linkedin|twitter|instagram|youtube|yelp|google|clio|payment|visa|mastercard|spinner|loading|placeholder|blank|pixel|1x1|transparent|arrow|bullet|button|\bmap\b|qr|signature|thumb-?nail-?small|wp-emoji|gravatar|certificate|\bbbb\b|lexpert|avvo|superlawyers|martindale|best-lawyers)/i;
const HERO_CTX = /(hero|banner|slider|slide|masthead|jumbotron|splash|cover|header|featured|intro|top-?section|parallax|backdrop)/i;

// candidate picture addresses on the page, best first: hero-like places, then the first big pictures in page order
function candidates(html, base) {
  const found = [];
  const add = (raw, score) => {
    if (!raw) return;
    let u; try { u = new URL(decode(raw).trim(), base); } catch { return; }
    if (u.protocol !== 'https:' || !/\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname + u.search) || SKIP_NAME.test(decodeURIComponent(u.pathname.split('/').pop() || ''))) return;
    const k = u.toString();
    const e = found.find((x) => x.url === k);
    if (e) e.score = Math.max(e.score, score); else found.push({ url: k, score });
  };
  const bestOfSrcset = (s) => { const parts = String(s || '').split(',').map((p) => p.trim().split(/\s+/)).filter((p) => p[0]); parts.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0)); return parts[0] && parts[0][0]; };
  // <img> tags (lazy-load attributes too), scored by the words around them
  let order = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0]; order++;
    const get = (a) => (t.match(new RegExp(`\\b${a}\\s*=\\s*"([^"]*)"|\\b${a}\\s*=\\s*'([^']*)'`, 'i')) || []).slice(1).find(Boolean);
    const src = bestOfSrcset(get('srcset') || get('data-srcset')) || get('data-src') || get('data-lazy-src') || get('data-original') || get('src');
    const ctx = html.slice(Math.max(0, m.index - 320), m.index);
    const w = parseInt(get('width') || '0', 10), h = parseInt(get('height') || '0', 10);
    if ((w && w < 400) || (h && h < 200)) continue;
    add(src, (HERO_CTX.test(ctx + ' ' + (get('class') || '') + ' ' + (get('id') || '')) ? 60 : 20) + (w >= 900 ? 15 : 0) - Math.min(order, 20));
  }
  // inline backgrounds and posters
  for (const m of html.matchAll(/url\(\s*["']?([^"')\s]+\.(?:jpe?g|png|webp)[^"')\s]*)["']?\s*\)/gi)) add(m[1], 55 - Math.min(m.index / 4000, 20));
  for (const m of html.matchAll(/\b(?:data-bg|data-background|data-background-image|poster)\s*=\s*"([^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)) add(m[1], 58);
  for (const m of html.matchAll(/"image"\s*:\s*"([^"]+)"/g)) add(m[1], 30);
  return found.sort((a, b) => b.score - a.score).map((x) => x.url);
}

const mpath = `${out}/manifest.json`;
const manifest = existsSync(mpath) ? JSON.parse(readFileSync(mpath, 'utf8')) : {};
const seenHash = new Map(); // picture hash -> firm slugs, to drop a theme's shared stock banner
const pending = [];

async function one(f) {
  const got = [];
  try {
    const site = new URL(f.website.replace(/^http:/i, 'https:'));
    if (!(await allowed(site.origin, site.pathname || '/'))) return;
    const page = await get(site.toString(), 'text/html', 1_000_000);
    const html = new TextDecoder().decode(page.bytes);
    for (const u of candidates(html, page.url).slice(0, 8)) {
      if (got.length >= 2) break;
      try {
        const pic = await get(u, 'image/jpeg,image/png,image/webp,image/*;q=0.8', MAX_BYTES);
        const meta = await sharp(pic.bytes).metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || meta.width < 900 || meta.height < 380) continue;
        const ar = meta.width / meta.height;
        if (ar < 1.25 || ar > 4.2) continue;
        const stats = await sharp(pic.bytes).resize(64, 64, { fit: 'inside' }).stats();
        const flat = stats.channels.slice(0, 3).every((c) => c.stdev < 14); // a near-blank or one-colour picture
        if (flat) continue;
        const hash = createHash('md5').update(pic.bytes).digest('hex');
        const file = `${f.slug}-${got.length + 1}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
        writeFileSync(`${out}/${file}`, pic.bytes);
        got.push({ url: pic.url, width: meta.width, height: meta.height, bytes: pic.bytes.length, file, hash });
        if (!seenHash.has(hash)) seenHash.set(hash, []);
        seenHash.get(hash).push(f.slug);
      } catch { /* try the next candidate */ }
    }
  } catch { /* the site did not answer */ }
  if (got.length) manifest[f.slug] = got;
}

const todo = firms.filter((f) => f.website && !manifest[f.slug]).slice(0, limit);
console.log(`${firms.length} firms have no cover; looking at ${todo.length} home pages`);
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => { while (i < todo.length) { await one(todo[i++]); if (i % 25 === 0) { process.stdout.write(`${i} `); writeFileSync(mpath, JSON.stringify(manifest, null, 1)); } } }));
// drop pictures that appear on more than one firm's site
for (const [hash, slugs] of seenHash) if (new Set(slugs).size > 1) for (const s of slugs) if (manifest[s]) { manifest[s] = manifest[s].filter((p) => p.hash !== hash); if (!manifest[s].length) delete manifest[s]; }
writeFileSync(mpath, JSON.stringify(manifest, null, 1));
console.log(`\ncandidates for ${Object.keys(manifest).length} firms`);
