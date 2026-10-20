// The extra cards in the home page's "Firms to explore" strip: strong firms that have an online booking link (data/firm-booking.json), listed in
// data/home-firms.json ({ "firms": [slug, ...] }, in the order they are shown). They sit after the hand-written cards (the firms that were there
// first), between <!--more-firms--> and <!--/more-firms--> in index.html, in the same card markup.
//   node scripts/build-home-firms.mjs             writes the cards into index.html
//   node scripts/build-home-firms.mjs --check     fails if index.html is out of date or a listed firm does not qualify
//   node scripts/build-home-firms.mjs --suggest   prints the firms that qualify best (nothing is written): a Google rating of 4.8 or more from at least
//                                                 100 reviews, an own logo, at least one practice area and a working booking link, ranked by rating weighted by number of reviews,
//                                                 at most 2 per city, 3 per kind of practice and 10 per province, so the strip is not all one city
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { PROVINCES } from '../src/render/firm-page.js';

const CHECK = process.argv.includes('--check');
const SUGGEST = process.argv.includes('--suggest');
const MIN_RATING = 4.8, MIN_REVIEWS = 100;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const firms = new Map();
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) firms.set(f.slug, f);
for (const file of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x)).sort()) for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.set(f.slug, f);
const booking = JSON.parse(readFileSync('data/firm-booking.json', 'utf8'));
let html = readFileSync('index.html', 'utf8');

const track = html.slice(html.indexOf('<div class="lw-track"'), html.indexOf('</section>', html.indexOf('<div class="lw-track"')));
const handWritten = new Set([...track.replace(/<!--more-firms-->[\s\S]*<!--\/more-firms-->/, '').matchAll(/<h3><a href="\/firms\/([^"]+)">/g)].map((m) => m[1]));

const qualifies = (f) => f && booking[f.slug] && f.type === 'logo' && f.src && existsSync(f.src) && f.rating >= MIN_RATING && f.count >= MIN_REVIEWS && (f.tags || []).length > 0 && !f.featured && !handWritten.has(f.slug);
const score = (f) => (f.count * f.rating + 50 * 4.5) / (f.count + 50);

if (SUGGEST) {
  const pool = [...firms.values()].filter(qualifies).sort((a, b) => score(b) - score(a) || b.count - a.count);
  const city = {}, kind = {}, prov = {}, out = [];
  for (const f of pool) {
    const c = `${f.city}|${f.province}`, k = (f.tags || [])[0] || '', p = f.province;
    if ((city[c] || 0) >= 2 || (kind[k] || 0) >= 3 || (prov[p] || 0) >= 10) continue;
    city[c] = (city[c] || 0) + 1; kind[k] = (kind[k] || 0) + 1; prov[p] = (prov[p] || 0) + 1; out.push(f);
    if (out.length >= 20) break;
  }
  console.log(`${pool.length} firms qualify; the best spread of 20:`);
  for (const f of out) console.log(`  "${f.slug}",  // ${f.rating} from ${f.count}, ${f.city} ${f.province}, ${(f.tags || []).slice(0, 2).join(' / ')}`);
  process.exit(0);
}

const list = JSON.parse(readFileSync('data/home-firms.json', 'utf8')).firms;
const seen = new Set();
for (const slug of list) {
  const f = firms.get(slug);
  if (!qualifies(f)) throw new Error(`${slug}: does not qualify (needs a rating of ${MIN_RATING}+ from ${MIN_REVIEWS}+ reviews, an own logo, a practice area, a booking link, not Featured, not already on the strip by hand)`);
  if (seen.has(slug)) throw new Error(`${slug}: listed twice`);
  seen.add(slug);
}

const phone = (p) => { const m = String(p || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(p || ''); };
const card = (f) =>
  '<article class="lc"><div class="lc-cover brand"><img src="' + esc(f.src) + '" alt="' + esc(f.name) + ' logo" loading="lazy"></div><div class="lc-body">' +
  '<h3><a href="/firms/' + esc(f.slug) + '">' + esc(f.name) + '</a></h3>' +
  '<span class="lc-rate"><b>&#9733; ' + Number(f.rating).toFixed(1) + '</b> <i>from ' + f.count + ' Google reviews</i></span>' +
  '<div class="lc-serves">Serving ' + esc(f.city) + ', ' + esc(PROVINCES[f.province] || f.province) + '</div>' +
  '<div class="lc-addr">' + esc(f.address) + '</div>' +
  (f.phone ? '<div class="lc-phone">' + esc(phone(f.phone)) + '</div>' : '') +
  '<div class="lc-tags">' + (f.tags || []).slice(0, 2).map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' +
  '<div class="lc-btns">' + (f.phone ? '<a class="lc-call" href="tel:' + esc(f.phone) + '">Call</a>' : '') + '<a class="lc-view" href="/firms/' + esc(f.slug) + '">View profile</a></div></div></article>';

const block = '<!--more-firms-->' + list.map((s) => card(firms.get(s))).join('') + '<!--/more-firms-->';
let next;
if (html.includes('<!--more-firms-->')) next = html.replace(/<!--more-firms-->[\s\S]*<!--\/more-firms-->/, () => block);
else {
  const tail = '</article></div></div>\n</section>';
  const at = html.indexOf(tail, html.indexOf('<div class="lw-track"'));
  if (at < 0) throw new Error('index.html: the end of the Firms to explore strip was not found');
  next = html.slice(0, at + '</article>'.length) + block + html.slice(at + '</article>'.length);
}
if (CHECK) {
  if (next !== html) { console.error('index.html is out of date: run node scripts/build-home-firms.mjs'); process.exit(1); }
  console.log(`home page strip up to date: ${handWritten.size} hand-written cards + ${list.length} firms with a booking link`);
} else { writeFileSync('index.html', next); console.log(`home page strip written: ${handWritten.size} hand-written cards + ${list.length} firms with a booking link`); }
