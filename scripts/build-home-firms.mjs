// The firm cards on the home page: the best-rated firms that have a cover photo and their own logo, listed in data/home-firms.json
// ({ "firms": [slug, ...] }, in the order they are shown). The cards go between <!--more-firms--> and <!--/more-firms--> in the page.
//   node scripts/build-home-firms.mjs                     writes the cards into index.html
//   node scripts/build-home-firms.mjs --file=concept-a.html    the same, for another page (a concept preview)
//   node scripts/build-home-firms.mjs --check             fails if the page is out of date or a listed firm does not qualify
//   node scripts/build-home-firms.mjs --suggest           prints the best spread of firms that qualify (nothing is written): a Google rating of
//                                                         4.8 or more from at least 50 reviews, a cover photo, its own logo, a practice area; ranked
//                                                         by rating weighted by number of reviews; at most 2 per city, 3 per practice area and 4 per province
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { PROVINCES } from '../src/render/firm-page.js';

const CHECK = process.argv.includes('--check');
const SUGGEST = process.argv.includes('--suggest');
const FILE = (process.argv.find((a) => a.startsWith('--file=')) || '--file=index.html').split('=')[1];
const MIN_RATING = 4.8, MIN_REVIEWS = 50, SHOWN = 12;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const firms = new Map();
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) firms.set(f.slug, f);
for (const file of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x)).sort()) for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.set(f.slug, f);

const qualifies = (f) => !!f && !f.featured && f.type === 'logo' && !!f.src && existsSync(f.src) && !!f.heroImage && existsSync(f.heroImage)
  && f.rating >= MIN_RATING && f.count >= MIN_REVIEWS && (f.tags || []).length > 0;
const score = (f) => (f.count * f.rating + 50 * 4.5) / (f.count + 50);

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

const phone = (p) => { const m = String(p || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(p || ''); };
const card = (f) => {
  const href = '/firms/' + esc(f.slug);
  const tel = f.phone ? '<a class="lc-call" href="tel:' + esc(f.phone) + '">Call now</a>' : '';
  return '<article class="lc">' +
    '<a class="lc-media" href="' + href + '" tabindex="-1" aria-hidden="true"><img src="' + esc(f.heroImage) + '" alt="" loading="lazy"><span class="lc-logo"><img src="' + esc(f.src) + '" alt="' + esc(f.name) + ' logo" loading="lazy"></span></a>' +
    '<div class="lc-body">' +
    '<span class="lc-cat">' + esc((f.tags || [])[0]) + '</span>' +
    '<h3><a href="' + href + '">' + esc(f.name) + '</a></h3>' +
    '<p class="lc-rate"><b>&#9733; ' + Number(f.rating).toFixed(1) + '</b> from ' + Number(f.count).toLocaleString('en-CA') + ' Google reviews</p>' +
    '<p class="lc-serves">' + esc(f.city) + ', ' + esc(PROVINCES[f.province] || f.province) + '</p>' +
    (f.phone ? '<p class="lc-phone">' + esc(phone(f.phone)) + '</p>' : '') +
    '<div class="lc-btns"><a class="lc-view" href="' + href + '">See profile</a>' + tel + '</div>' +
    '</div></article>';
};

const html = readFileSync(FILE, 'utf8');
const block = '<!--more-firms-->' + list.map((s) => card(firms.get(s))).join('') + '<!--/more-firms-->';
if (!html.includes('<!--more-firms-->') || !html.includes('<!--/more-firms-->')) throw new Error(`${FILE}: the <!--more-firms--> markers were not found`);
const next = html.replace(/<!--more-firms-->[\s\S]*<!--\/more-firms-->/, () => block);
if (CHECK) {
  if (next !== html) { console.error(`${FILE} is out of date: run node scripts/build-home-firms.mjs`); process.exit(1); }
  console.log(`${FILE}: home page firms up to date (${list.length} firms with a cover photo and a logo)`);
} else {
  writeFileSync(FILE, next);
  console.log(`${FILE}: ${list.length} firms written`);
}
