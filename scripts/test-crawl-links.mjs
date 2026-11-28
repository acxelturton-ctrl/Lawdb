// Every firm page must be reachable by an ordinary link, not only through the sitemap: Google finds (and trusts) a page much more readily when
// another page links to it. The city hub pages list every firm in the city, A to Z; this fails if a firm is missing from its hub, or if a firm
// is in a city that has no hub page (so nothing would link to it).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadSiteFirms } from './lib/site-firms.mjs';
import { firmPath } from '../src/lib/firm-handle.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const firms = loadSiteFirms();

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

// Saskatchewan, Nova Scotia, New Brunswick, Newfoundland and Labrador and Prince Edward Island were added with their firms only (November 2026): their province and city hub pages
// need their own written text (law society, legal aid, what the courts there are called) and are still to be made. Until then those firms are reached from the Find page,
// the firm sitemap and each other's pages; the day a province gets its hub pages, take it out of this list and this test covers it like the rest.
const NO_HUBS_YET = new Set(['SK', 'NS', 'NB', 'NL', 'PE']);
const noHub = firms.filter((f) => !hubOf.has(`${f.province}|${f.city}`) && !NO_HUBS_YET.has(f.province));
ok(noHub.length === 0, `every firm is in a city that has a hub page${noHub.length ? ` (missing: ${[...new Set(noHub.map((f) => `${f.city}, ${f.province}`))].slice(0, 5).join('; ')})` : ''}`);

const unlinked = firms.filter((f) => hubOf.has(`${f.province}|${f.city}`) && !hubOf.get(`${f.province}|${f.city}`).includes(`href="${firmPath(f)}"`));
ok(unlinked.length === 0, `every firm page is linked from its city hub (${firms.length - noHub.length} checked${unlinked.length ? `; missing: ${unlinked.slice(0, 5).map((f) => f.slug).join(', ')}` : ''})`);

for (const [key, html] of hubOf) {
  const m = html.match(/<h3>All (\d+) law firms in [^<]+<\/h3><ul class="seo-all">([\s\S]*?)<\/ul>/);
  const n = m ? (m[2].match(/<li><a href="\/(?!firms\/)[a-z0-9]/g) || []).length : -1;
  if (!m || Number(m[1]) !== n) { ok(false, `${key}: the A to Z list matches its heading`); break; }
}
ok(true, 'each hub\'s A to Z list matches its heading');

// /find-lawyers builds its buttons and firm list in the browser, so it has to link to every city hub in plain HTML too, be in the sitemap,
// and not share its title with the home page (both would then compete for the same search)
const findPage = readFileSync('find-lawyers.html', 'utf8');
const hubHrefs = [];
for (const dir of Object.values(PROV)) {
  for (const d of readdirSync(dir, { withFileTypes: true })) if (d.isDirectory() && existsSync(`${dir}/${d.name}/index.html`)) hubHrefs.push(`/${dir}/${d.name}/`);
}
const notOnFind = hubHrefs.filter((h) => !findPage.includes(`href="${h}"`));
ok(notOnFind.length === 0, `/find-lawyers links to all ${hubHrefs.length} city hubs${notOnFind.length ? ` (missing: ${notOnFind.slice(0, 5).join(', ')})` : ''}`);
ok(readFileSync('sitemap.xml', 'utf8').includes('<loc>https://lawdb.ca/find-lawyers</loc>'), '/find-lawyers is in the sitemap');
const titleOf = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1];
ok(titleOf(findPage) && titleOf(findPage) !== titleOf(readFileSync('index.html', 'utf8')), '/find-lawyers has its own title, different from the home page');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
