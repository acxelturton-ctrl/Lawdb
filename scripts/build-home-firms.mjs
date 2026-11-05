// The firm cards on the home page: the best-rated firms that have a cover photo and their own logo, listed in data/home-firms.json
// ({ "firms": [slug, ...] }, in the order they are shown). The cards go between <!--more-firms--> and <!--/more-firms--> in the page.
//   node scripts/build-home-firms.mjs                     writes the cards into index.html
//   node scripts/build-home-firms.mjs --file=concept-a.html    the same, for another page (a concept preview)
//   node scripts/build-home-firms.mjs --check             fails if the page or the daily pool is out of date, or a listed firm does not qualify
//   node scripts/build-home-firms.mjs --pool              writes src/render/home-pool.generated.js: every firm that qualifies (images checked), the pool the
//                                                         Worker draws each day's cards from (src/routes/home-firms.js). Run it after adding firms or pictures.
//   node scripts/build-home-firms.mjs --suggest           prints the best spread of firms that qualify (nothing is written): a Google rating of
//                                                         4.8 or more from at least 50 reviews, a cover photo, its own logo, a practice area; ranked
//                                                         by rating weighted by number of reviews; at most 2 per city, 3 per practice area and 4 per province
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { PROVINCES } from '../src/render/firm-page.js';
import { homeFirmCard } from '../src/render/home-cards.js';

const CHECK = process.argv.includes('--check');
const SUGGEST = process.argv.includes('--suggest');
const POOL = process.argv.includes('--pool');
const FILE = (process.argv.find((a) => a.startsWith('--file=')) || '--file=index.html').split('=')[1];
export const MIN_RATING = 4.8, MIN_REVIEWS = 50, SHOWN = 12;

const firms = new Map();
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) firms.set(f.slug, f);
for (const file of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x)).sort()) for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.set(f.slug, f);

const qualifies = (f) => !!f && !f.featured && f.type === 'logo' && !!f.src && existsSync(f.src) && !!f.heroImage && existsSync(f.heroImage)
  && f.rating >= MIN_RATING && f.count >= MIN_REVIEWS && (f.tags || []).length > 0;
const score = (f) => (f.count * f.rating + 50 * 4.5) / (f.count + 50);

// The pool the Worker draws each day's cards from: every firm that qualifies (a rating of 4.8+ from 50+ reviews, a cover photo and its own logo that
// really exist in the site's files, a practice area, not Featured). The Worker also checks, each day, that a firm is still live and not Featured and that its
// description is a real one, so a firm that has changed since is dropped on its own.
const poolSlugs = [...firms.values()].filter(qualifies).map((f) => f.slug).sort();
const poolModule = `// The firms the home page can show in its daily rotation (see scripts/build-home-firms.mjs --pool and src/routes/home-firms.js). Generated: do not edit.
export const HOME_POOL = ${JSON.stringify(poolSlugs)};
`;
const POOL_FILE = 'src/render/home-pool.generated.js';
if (POOL) { writeFileSync(POOL_FILE, poolModule); console.log(`${POOL_FILE}: ${poolSlugs.length} firms in the daily pool`); process.exit(0); }
if (CHECK && (!existsSync(POOL_FILE) || readFileSync(POOL_FILE, 'utf8') !== poolModule)) { console.error(`${POOL_FILE} is out of date: run node scripts/build-home-firms.mjs --pool`); process.exit(1); }

if (SUGGEST) {
  const pool = [...firms.values()].filter(qualifies).sort((a, b) => score(b) - score(a) || b.count - a.count);
  const city = {}, kind = {}, prov = {}, out = [];
  for (const f of pool) {
    const c = `${f.city}|${f.province}`, k = (f.tags || [])[0] || '', p = f.province;
    if ((city[c] || 0) >= 2 || (kind[k] || 0) >= 3 || (prov[p] || 0) >= 4) continue;
    city[c] = (city[c] || 0) + 1; kind[k] = (kind[k] || 0) + 1; prov[p] = (prov[p] || 0) + 1; out.push(f);
    if (out.length >= SHOWN) break;
  }
  console.log(`${pool.length} firms qualify; the best spread of ${SHOWN}:`);
  for (const f of out) console.log(`  "${f.slug}",  // ${f.rating} from ${f.count}, ${f.city} ${f.province}, ${(f.tags || []).slice(0, 2).join(' / ')}`);
  process.exit(0);
}

const list = JSON.parse(readFileSync('data/home-firms.json', 'utf8')).firms;
const seen = new Set();
for (const slug of list) {
  const f = firms.get(slug);
  if (!qualifies(f)) throw new Error(`${slug}: does not qualify (needs a rating of ${MIN_RATING}+ from ${MIN_REVIEWS}+ reviews, a cover photo, its own logo, a practice area, not Featured)`);
  if (seen.has(slug)) throw new Error(`${slug}: listed twice`);
  seen.add(slug);
}

const html = readFileSync(FILE, 'utf8');
const block = '<!--more-firms-->' + list.map((s) => homeFirmCard(firms.get(s))).join('') + '<!--/more-firms-->';
if (!html.includes('<!--more-firms-->') || !html.includes('<!--/more-firms-->')) throw new Error(`${FILE}: the <!--more-firms--> markers were not found`);
const next = html.replace(/<!--more-firms-->[\s\S]*<!--\/more-firms-->/, () => block);
if (CHECK) {
  if (next !== html) { console.error(`${FILE} is out of date: run node scripts/build-home-firms.mjs`); process.exit(1); }
  console.log(`${FILE}: home page firms up to date (${list.length} firms with a cover photo and a logo)`);
} else {
  writeFileSync(FILE, next);
  console.log(`${FILE}: ${list.length} firms written`);
}
