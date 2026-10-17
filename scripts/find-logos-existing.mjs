// Finds a logo for every listed firm that still shows initials, from the firm's own website, and records the result in
// data/logos-existing.json ({ slug: { src, site } }). Same finder, same checks as the admin Logos tab.
//   NODE_USE_ENV_PROXY=1 node scripts/find-logos-existing.mjs [--limit=N]
// Resumable: firms already in the file, or listed in data/logo-rejects.txt, are skipped.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { findLogos, fetchPicture } from '../src/lib/logo-finder.js';

const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const firms = JSON.parse(readFileSync('firms_data.json', 'utf8'));
const OUT = 'data/logos-existing.json';
const map = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const rejects = new Set(readFileSync('data/logo-rejects.txt', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')));
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
mkdirSync('images/logos', { recursive: true });

const UA = 'LawDB-LogoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)';
async function httpsOf(site) {
  if (!/^http:\/\//i.test(site)) return site;
  const https = site.replace(/^http:/i, 'https:');
  try { const r = await fetch(https, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(9000) }); if (r.ok) return https; } catch { /* keep http: the finder will say so */ }
  return site;
}
async function one(f) {
  const site = await httpsOf(f.website.replace(/\/+$/, ''));
  try {
    const cands = await findLogos({}, site);
    const pick = cands.find((c) => c.source === 'logo on the page' && c.width / c.height <= 6 && c.height / c.width <= 3)
      || cands.find((c) => c.source === 'site icon' && c.width >= 150 && Math.abs(c.width - c.height) <= 4);
    if (!pick) return { slug: f.slug, note: cands.length ? 'no clearly-labelled logo' : 'none found' };
    const { bytes, info } = await fetchPicture({}, pick.url);
    const ext = EXT[info.format];
    if (!ext) return { slug: f.slug, note: 'format' };
    const src = `images/logos/${f.slug}.${ext}`;
    writeFileSync(src, bytes);
    map[f.slug] = { src, site };
    return { slug: f.slug, ok: true };
  } catch (e) { return { slug: f.slug, note: String(e.message || e).slice(0, 70) }; }
}
const todo = firms.filter((f) => f.type !== 'logo' && f.website && !map[f.slug] && !rejects.has(f.slug)).slice(0, limit);
let i = 0; const res = [];
await Promise.all(Array.from({ length: 6 }, async () => { while (i < todo.length) { res.push(await one(todo[i++])); process.stdout.write('.'); writeFileSync(OUT, JSON.stringify(map, null, 1) + '\n'); } }));
console.log(`\nfound ${res.filter((r) => r.ok).length} of ${todo.length}`);
const why = {}; for (const r of res.filter((x) => !x.ok)) why[r.note] = (why[r.note] || 0) + 1;
console.log(why);
