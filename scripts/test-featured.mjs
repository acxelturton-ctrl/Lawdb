// Who is marked Featured, and the "Firms to explore" strip on the home page. Only Blottman Legal Services and Barbarian Law have a commission
// arrangement with LawDB, so only they carry the Featured badge, tick and line; the strip also carries strong firms that have a booking link.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const KEEP = ['barbarian-law', 'blottman-legal-services'];
const DROPPED = ['daniel-brown-law-llp', 'nelligan-law', 'amlea-avocats', 'gagan-nahal-criminal-lawyer'];

const originals = JSON.parse(readFileSync('firms_data.json', 'utf8'));
const featured = originals.filter((f) => f.featured).map((f) => f.slug).sort();
ok(JSON.stringify(featured) === JSON.stringify(KEEP), 'only Barbarian Law and Blottman Legal Services are Featured in the firm data');
const batchFeatured = readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x)).flatMap((x) => JSON.parse(readFileSync(`data/${x}`, 'utf8'))).filter((f) => f.featured);
ok(batchFeatured.length === 0, 'no firm from the added batches is Featured');

// the profile pages
for (const slug of KEEP) {
  const t = readFileSync(`firms/${slug}.html`, 'utf8');
  ok(t.includes('Featured on LawDB') && t.includes('li-tick" title="Verified LawDB Featured firm"'), `${slug}: the page still says Featured`);
}
for (const slug of [...DROPPED, 'gupta-law-firm']) {
  const t = readFileSync(`firms/${slug}.html`, 'utf8');
  ok(!t.includes('Featured on LawDB') && !t.includes('Verified LawDB Featured firm') && t.includes('Basic listing &middot; <a href="/list-your-firm">Own this firm? Get featured</a>'), `${slug}: the page is a basic listing (no tick, no Featured line)`);
}

// the firm lists baked into the static pages (the fallback when the database cannot be read)
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('.') || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.html') ? [`${dir}/${e.name}`] : []));
let stale = 0;
for (const p of walk('.')) {
  const t = readFileSync(p, 'utf8');
  if (!t.includes('"featured": true')) continue;
  for (const m of t.matchAll(/"name": "([^"]+)", "city": "[^"]+", "featured": true/g)) if (!['Barbarian Law', 'Blottman Legal Services'].includes(m[1])) stale++;
}
ok(stale === 0, 'no static page lists any firm other than Barbarian Law and Blottman Legal Services as Featured');

// the one-time database change
const mig = readFileSync('migrations/0030_unfeature_partners.sql', 'utf8');
const named = [...(mig.match(/slug IN \(([^)]*)\)/) || [, ''])[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
ok(JSON.stringify(named) === JSON.stringify([...DROPPED].sort()) && /featured = 1/.test(mig) && !/barbarian|blottman/.test(mig), 'the migration switches off exactly the four firms and never touches Barbarian or Blottman');

// the home page strip
const home = readFileSync('index.html', 'utf8');
const strip = home.slice(home.indexOf('<div class="lw-track"'), home.indexOf('</section>', home.indexOf('<div class="lw-track"')));
const cards = strip.match(/<article class="lc">[\s\S]*?<\/article>/g) || [];
const slugOf = (c) => (c.match(/<h3><a href="\/firms\/([^"]+)">/) || [])[1];
const badged = cards.filter((c) => c.includes('lc-feat">Featured')).map(slugOf).sort();
ok(JSON.stringify(badged) === JSON.stringify(KEEP), 'on the home page strip only Barbarian Law and Blottman Legal Services carry the Featured badge');
for (const slug of [...DROPPED, 'gupta-law-firm']) ok(cards.some((c) => slugOf(c) === slug) && !cards.find((c) => slugOf(c) === slug).includes('lc-feat'), `${slug} is still on the strip, without a badge`);
const slugs = cards.map(slugOf);
ok(new Set(slugs).size === slugs.length && slugs.every(Boolean), 'no firm is on the strip twice');
const added = JSON.parse(readFileSync('data/home-firms.json', 'utf8')).firms;
const booking = JSON.parse(readFileSync('data/firm-booking.json', 'utf8'));
ok(added.length >= 10 && added.every((s) => booking[s] && slugs.includes(s)), `${added.length} strong firms with a booking link are on the strip as well as the first seven`);
ok(slugs.slice(0, 7).join() === 'daniel-brown-law-llp,nelligan-law,gupta-law-firm,amlea-avocats,gagan-nahal-criminal-lawyer,blottman-legal-services,barbarian-law', 'the seven firms that were on the strip first are still first, in the same order');
ok(cards.every((c) => /<img src="images\/logos\/[^"]+"/.test(c) || c.includes('lc-logo mono')) && added.every((s) => cards.find((c) => slugOf(c) === s) && existsSync(`images/logos/${(cards.find((c) => slugOf(c) === s).match(/images\/logos\/([^"]+)"/) || [])[1]}`)), 'every added card shows the firm\'s own logo, and the file exists');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nfeatured firms and home strip checks passed');
