// Re-reads every source page in data/city-guides/*.json and checks that each "proof" excerpt really is on it. It needs the network, so it is run by hand
// (and before a guide is merged), not in `npm run check`.
//   node scripts/verify-city-guides.mjs                 all cities
//   node scripts/verify-city-guides.mjs alberta         one province file, or a city key such as manitoba/winnipeg
// A proof is a few excerpts joined by " | ", and an excerpt may skip words with " ... ". Spacing, punctuation and capitals are ignored when matching.
import { spawnSync } from 'node:child_process';
import { loadGuides } from './city-guides-data.mjs';

const filter = process.argv[2];
const guides = Object.entries(loadGuides()).filter(([k, g]) => !filter || k.startsWith(filter) || (g.province || '').toLowerCase() === filter.toLowerCase() || k === filter);

const compact = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-' };
const textOf = (html) => html
  .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : entities[e.toLowerCase()] ?? ' '));

const cache = new Map();
function page(url) {
  if (!cache.has(url)) {
    const r = spawnSync('curl', ['-sL', '--max-time', '45', '-A', 'Mozilla/5.0 (compatible; LawDB guide check)', url], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    cache.set(url, r.status === 0 && r.stdout ? compact(textOf(r.stdout)) : null);
  }
  return cache.get(url);
}

let items = 0, bad = 0, unreachable = new Set();
for (const [key, g] of guides) {
  for (const [pg, def] of Object.entries(g.pages)) {
    for (const gr of def.groups) for (const it of gr.items) {
      items++;
      const texts = it.sources.map((s) => { const t = page(s.url); if (t === null) unreachable.add(s.url); return t; }).filter(Boolean);
      for (const seg of String(it.proof).split(' | ')) for (const part of seg.split(/\s*\.\.\.\s*/).filter((x) => x.trim())) {
        const c = compact(part);
        if (c.length < 12) { bad++; console.log(`SHORT  ${key}/${pg}: excerpt too short to prove anything: "${part}"`); continue; }
        if (!texts.some((t) => t.includes(c))) { bad++; console.log(`MISS   ${key}/${pg}: not found on its source page: "${part.slice(0, 110)}"  (${it.text.slice(0, 50)}...)`); }
      }
    }
  }
}
for (const u of unreachable) console.log(`UNREACHABLE  ${u}`);
console.log(`\n${items} facts checked, ${bad} excerpt problem(s), ${unreachable.size} unreachable page(s)`);
process.exit(bad || unreachable.size ? 1 : 0);
