// Every firm page must be reachable by an ordinary link, not only through the sitemap: Google finds (and trusts) a page much more readily when
// another page links to it. The city hub pages list every firm in the city, A to Z; this fails if a firm is missing from its hub, or if a firm
// is in a city that has no hub page (so nothing would link to it).
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const firms = JSON.parse(readFileSync('firms_data.json', 'utf8'));
const released = new Set(JSON.parse(readFileSync('data/release.json', 'utf8')).released);
for (const f of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x)).sort()) {
  if (released.has(Number(f.match(/\d+/)[0]))) firms.push(...JSON.parse(readFileSync(`data/${f}`, 'utf8')));
}

const PROV = { ON: 'ontario', QC: 'quebec', BC: 'british-columbia', AB: 'alberta', MB: 'manitoba' };
const hubOf = new Map(); // 'ON|Toronto' -> page text
for (const dir of Object.values(PROV)) {
  if (!existsSync(dir)) continue;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${d.name}/index.html`;
    if (!d.isDirectory() || !existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const m = html.match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (m) hubOf.set(`${Object.keys(PROV).find((k) => PROV[k] === dir)}|${m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&')}`, html);
  }
}

const noHub = firms.filter((f) => !hubOf.has(`${f.province}|${f.city}`));
ok(noHub.length === 0, `every firm is in a city that has a hub page${noHub.length ? ` (missing: ${[...new Set(noHub.map((f) => `${f.city}, ${f.province}`))].slice(0, 5).join('; ')})` : ''}`);

const unlinked = firms.filter((f) => hubOf.has(`${f.province}|${f.city}`) && !hubOf.get(`${f.province}|${f.city}`).includes(`href="/firms/${f.slug}"`));
ok(unlinked.length === 0, `every firm page is linked from its city hub (${firms.length - noHub.length} checked${unlinked.length ? `; missing: ${unlinked.slice(0, 5).map((f) => f.slug).join(', ')}` : ''})`);

for (const [key, html] of hubOf) {
  const m = html.match(/<h3>All (\d+) law firms in [^<]+<\/h3><ul class="seo-all">([\s\S]*?)<\/ul>/);
  const n = m ? (m[2].match(/<li><a href="\/firms\//g) || []).length : -1;
  if (!m || Number(m[1]) !== n) { ok(false, `${key}: the A to Z list matches its heading`); break; }
}
ok(true, 'each hub\'s A to Z list matches its heading');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
