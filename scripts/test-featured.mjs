// Who is marked Featured, and the firm strip on the home page. Only Blottman Legal Services and Barbarian Law have a commission arrangement with
// LawDB, so only they carry the Featured badge, tick and line. The strip lists the best-rated firms that have a cover photo and their own logo.
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

// the home page: the firm strip lists the best-rated firms that have a cover photo and their own logo (data/home-firms.json, in order)
const home = readFileSync('index.html', 'utf8');
const strip = home.slice(home.indexOf('<!--more-firms-->'), home.indexOf('<!--/more-firms-->'));
const cards = strip.match(/<article class="lc">[\s\S]*?<\/article>/g) || [];
const slugOf = (c) => (c.match(/<h3><a href="\/firms\/([^"]+)">/) || [])[1];
const slugs = cards.map(slugOf);
const added = JSON.parse(readFileSync('data/home-firms.json', 'utf8')).firms;
ok(JSON.stringify(slugs) === JSON.stringify(added) && added.length === 12, `the home page strip lists the ${added.length} firms in data/home-firms.json, in order`);
ok(new Set(slugs).size === slugs.length, 'no firm is on the strip twice');
const badged = cards.filter((c) => c.includes('lc-feat">Featured')).map(slugOf);
ok(badged.every((s) => KEEP.includes(s)), 'a Featured badge on the strip can only belong to one of the two partner firms');
const pathOf = (c, re) => (c.match(re) || [])[1];
ok(cards.every((c) => { const cover = pathOf(c, /class="lc-media"[^>]*><img src="([^"]+)"/); const logo = pathOf(c, /<span class="lc-logo"><img src="([^"]+)"/); return !!cover && existsSync(cover) && !!logo && existsSync(logo); }), 'every card on the strip shows a cover photo and the firm\'s own logo, and both files exist');
const everyFirm = new Map();
for (const f of originals) everyFirm.set(f.slug, f);
for (const x of readdirSync('data').filter((y) => /^firms-batch-\d+\.json$/.test(y))) for (const f of JSON.parse(readFileSync(`data/${x}`, 'utf8'))) everyFirm.set(f.slug, f);
ok(added.every((s) => { const f = everyFirm.get(s); return !!f && f.rating >= 4.8 && f.count >= 50 && !f.featured; }), 'every firm on the strip is rated 4.8 or more from 50 or more Google reviews, and is not Featured');

// What the site SAYS Featured gives must be what the site DOES. Every pitch page lists only real benefits, and none still promises
// something that is gone (a Featured showcase on the home page) or that every firm already has (a cover image, a full description).
const read = (p) => readFileSync(p, 'utf8');
const has = (p, re) => re.test(read(p));
ok(has('lawdb-map.js', /f\.featured \? 0 : 10/) && has('suggest.js', /\(b\.featured\?1:0\)-\(a\.featured\?1:0\)/) && has('find-lawyers.html', /Featured Partners for this case type/), 'Featured firms really are ranked first in results and in the search box, with a Featured Partners strip on the Find page');
ok(has('src/routes/firm-page.js', /ORDER BY featured DESC/) && has('src/routes/story-page.js', /ORDER BY featured DESC/), 'Featured firms really are listed first among nearby firms');
ok(has('src/lib/leads.js', /export async function isFeatured/) && has('src/routes/account.js', /Exporting enquiries is a Featured benefit/), 'the enquiries dashboard and export really are Featured-only');
ok(has('src/lib/stories.js', /f\.featured = 1/) && has('src/lib/home-feed.js', /f\.featured \? 25 : 0/), 'Featured stories really get a page search engines can find, and a boost in the home page news strip');

const PITCH = ['for-firms.html', 'list-your-firm.html', 'how-it-works.html', 'book-a-call.html', 'admin/ui.js', 'src/lib/email.js'];
const GONE = [/Featured (?:Partners )?showcase/i, /auto-sliding/i, /slides automatically/i, /homepage showcase/i, /Featured adds a cover image/i, /Expanded profile/i, /blog cards from your website/i, /priority placement at the top of results/i, /Cover image, full description, practice-area tags/i];
for (const p of PITCH) ok(!GONE.some((re) => re.test(read(p))), `${p}: no untrue or out-of-date claim about what Featured gives`);
const GIVES = [/above Basic firms/i, /Featured Partner/i, /live search box/i, /gold pin|gold highlighted/i, /Enquiries dashboard/i, /LawDB (?:story )?page/i, /nearby firms/i];
for (const p of ['for-firms.html', 'list-your-firm.html']) ok(GIVES.every((re) => re.test(read(p))), `${p}: lists everything Featured really gives`);
ok(has('admin/ui.js', /FEATURED_PERKS/) && has('src/lib/email.js', /FEATURED_GETS/), "the owner's plan card and the Featured email carry the same list");

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nfeatured firms and home strip checks passed');
