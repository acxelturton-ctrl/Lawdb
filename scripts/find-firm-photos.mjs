// Looks for each firm's own share picture (the og:image / twitter:image its website names for previews) as a candidate cover or bio photo.
//   NODE_USE_ENV_PROXY=1 node scripts/find-firm-photos.mjs <out-dir> [--limit=N]
// Public https only, same checks as every picture the site takes (a real JPEG, PNG or WebP), at least 600 px wide.
// Writes <out-dir>/<slug>.<ext> and <out-dir>/manifest.json ({ slug: { url, width, height, bytes, file } }). Nothing goes on the site
// until a person has looked at the pictures: scripts/apply-firm-photos.mjs only uses the ones listed in data/firm-photos.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import sharp from 'sharp';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/find-firm-photos.mjs <out-dir> [--limit=N]'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
mkdirSync(out, { recursive: true });
const UA = 'LawDB-PhotoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const MAX_BYTES = 6 * 1024 * 1024;

const firms = JSON.parse(readFileSync('firms_data.json', 'utf8')).map((f) => ({ slug: f.slug, website: f.website }));
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.push({ slug: f.slug, website: f.website });
}

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
async function get(url, accept, max) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(String(res.status));
  if (!/^https:/i.test(res.url)) throw new Error('not https');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('too big');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > max) throw new Error('too big');
  return { bytes, url: res.url, type: res.headers.get('content-type') || '' };
}

function pictureUrls(html, base) {
  const urls = [];
  for (const t of html.match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    const isMeta = /(?:property|name)\s*=\s*["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src)["']/i.test(t);
    const isLink = /rel\s*=\s*["']image_src["']/i.test(t);
    if (!isMeta && !isLink) continue;
    const c = t.match(/(?:content|href)\s*=\s*"([^"]*)"|(?:content|href)\s*=\s*'([^']*)'/i);
    if (!c) continue;
    try { const u = new URL(decode(c[1] ?? c[2]), base); if (u.protocol === 'https:' && !urls.includes(u.toString())) urls.push(u.toString()); } catch { /* skip */ }
  }
  return urls;
}

async function one(f, manifest) {
  try {
    const page = await get(f.website.replace(/^http:/i, 'https:'), 'text/html', 800_000);
    const html = new TextDecoder().decode(page.bytes);
    for (const u of pictureUrls(html, page.url).slice(0, 3)) {
      try {
        const pic = await get(u, 'image/jpeg,image/png,image/webp,image/*;q=0.8', MAX_BYTES);
        const meta = await sharp(pic.bytes).metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || meta.width < 600 || meta.height < 250) continue;
        const file = `${f.slug}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
        writeFileSync(`${out}/${file}`, pic.bytes);
        manifest[f.slug] = { url: pic.url, width: meta.width, height: meta.height, bytes: pic.bytes.length, file };
        return;
      } catch { /* try the next candidate */ }
    }
  } catch { /* the site did not answer */ }
}

const mpath = `${out}/manifest.json`;
const manifest = existsSync(mpath) ? JSON.parse(readFileSync(mpath, 'utf8')) : {};
const todo = firms.filter((f) => f.website && !manifest[f.slug]).slice(0, limit);
let i = 0;
await Promise.all(Array.from({ length: 12 }, async () => { while (i < todo.length) { await one(todo[i++], manifest); process.stdout.write('.'); } }));
writeFileSync(mpath, JSON.stringify(manifest, null, 1));
console.log(`\nfound a picture for ${Object.keys(manifest).length} of ${firms.length} firms`);
