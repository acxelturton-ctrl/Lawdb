// The ten national case-type guides (/family-lawyers ...) and the picture cards on /find-lawyers (scripts/build-case-pages.mjs): every guide is
// complete and consistent, links down to every province and city page that exists for it, is in the sitemap, and carries no figures (fees,
// deadlines and amounts change and differ by province, so these pages never state them). That the files match the data is checked by
// build-case-pages.mjs --check.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const data = JSON.parse(readFileSync('data/case-types.json', 'utf8'));
const entries = Object.entries(data.types);
const sitemap = readFileSync('sitemap.xml', 'utf8');
const find = readFileSync('find-lawyers.html', 'utf8');
const PROV = ['ontario', 'quebec', 'british-columbia', 'alberta', 'manitoba'];
const indexable = (h) => !/<meta[^>]+name="robots"[^>]+noindex/i.test(h);

ok(entries.length === 10, `${entries.length} case types`);
// the case ids on /find-lawyers (what the search understands) and in the data are the same set
const searchIds = [...find.matchAll(/\{id:'(\w+)', say:/g)].map((m) => m[1]).sort();
ok(JSON.stringify(searchIds) === JSON.stringify(entries.map(([k]) => k).sort()), `/find-lawyers and the data know the same case types (${searchIds.join(', ')})`);
ok(new Set(entries.map(([, t]) => t.slug)).size === entries.length && entries.every(([, t]) => /^[a-z]+(-[a-z]+)*-lawyers$/.test(t.slug)), 'slugs are unique, lower case, hyphenated and end in "-lawyers"');

const prose = [];
for (const [id, t] of entries) {
  const file = `${t.slug}.html`;
  const html = existsSync(file) ? readFileSync(file, 'utf8') : '';
  ok(!!html, `${id}: ${file} exists`);
  if (!html) continue;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(title.length > 0 && title.length <= 62, `${id}: title fits a search result (${title.length} characters)`);
  ok(desc.length >= 100 && desc.length <= 165, `${id}: description is ${desc.length} characters`);
  ok(html.includes(`<link rel="canonical" href="https://lawdb.ca/${t.slug}">`), `${id}: canonical is the clean address`);
  ok((html.match(/<h1[^>]*>/g) || []).length === 1, `${id}: exactly one h1`);
  ok(indexable(html), `${id}: not noindex`);
  ok(sitemap.includes(`<loc>https://lawdb.ca/${t.slug}</loc>`), `${id}: in the sitemap`);
  ok(existsSync(`images/cases/${t.image}`) && new RegExp(`<img src="/images/cases/${t.image.replace('.', '\\.')}" alt="[^"]*" width="640" height="400"`).test(html), `${id}: has its picture, with a size`);
  ok(t.faqs.length >= 3 && (html.match(/<summary>/g) || []).length === t.faqs.length, `${id}: ${t.faqs.length} questions shown`);
  let lds = [];
  try { lds = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map((m) => JSON.parse(m[1])); } catch { /* checked below */ }
  const types = lds.map((o) => o['@type']).sort().join(',');
  const faq = lds.find((o) => o['@type'] === 'FAQPage');
  ok(types === 'BreadcrumbList,FAQPage,WebPage' && faq && faq.mainEntity.length === t.faqs.length, `${id}: structured data parses (${types})`);
  // links down the chain: every province page and city page that exists for this case type
  const missing = [];
  for (const dir of PROV) {
    if (existsSync(`${dir}/${t.slug}.html`) && indexable(readFileSync(`${dir}/${t.slug}.html`, 'utf8')) && !html.includes(`href="/${dir}/${t.slug}"`)) missing.push(`/${dir}/${t.slug}`);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const f = `${dir}/${d.name}/${t.slug}.html`;
      if (d.isDirectory() && existsSync(f) && indexable(readFileSync(f, 'utf8')) && !html.includes(`href="/${dir}/${d.name}/${t.slug}"`)) missing.push(`/${dir}/${d.name}/${t.slug}`);
    }
  }
  ok(missing.length === 0, `${id}: links to every province and city page for it${missing.length ? ` (missing: ${missing.slice(0, 4).join(', ')})` : ''}`);
  ok(entries.filter(([k]) => k !== id).every(([, o]) => html.includes(`href="/${o.slug}"`)), `${id}: links to the other nine guides`);
  ok(find.includes(`<a class="case-card" href="/${t.slug}">`), `${id}: has a card on /find-lawyers`);
  prose.push(...[t.lede, t.differ, t.card, t.description, ...t.when, ...t.does, ...t.ask, ...t.faqs.flatMap((f) => [f.q, f.a])].map((s) => ({ id, s })));
}

const withDigit = prose.filter((x) => /\d/.test(x.s));
ok(withDigit.length === 0, `no figures in the guides${withDigit.length ? `: ${withDigit.slice(0, 2).map((x) => `${x.id}: "${x.s.slice(0, 50)}"`).join(' | ')}` : ''}`);
const seen = new Map(), dup = [];
for (const { id, s } of prose) { if (seen.has(s) && seen.get(s) !== id) dup.push(s.slice(0, 50)); seen.set(s, id); }
ok(dup.length === 0, `no sentence is repeated on two guides${dup.length ? `: ${dup.slice(0, 2).join(' | ')}` : ''}`);

// /find-lawyers: the pick-a-case-type wizard is gone, replaced by the cards (and the deep links still work)
ok(!find.includes('id="stepCase"') && !find.includes('id="stepLocation"') && !find.includes('or pick a case type below'), '/find-lawyers no longer has the step 1 / step 2 wizard');
ok((find.match(/<a class="case-card"/g) || []).length === entries.length, `/find-lawyers has ${entries.length} case cards`);
ok(find.includes("function setWizard(show)") && !find.includes('provinceRow') && !find.includes('caseGrid.'), '/find-lawyers has no leftover code for the removed steps');

// the home page: the "Or pick a case type" list links every guide, in the old picker's order, and the hero keeps what the rest of the site relies on
const home = readFileSync('index.html', 'utf8');
const homeList = (home.match(/<!--home-cases-->([\s\S]*?)<!--\/home-cases-->/) || [])[1] || '';
const order = ['traffic', 'criminal', 'family', 'injury', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation'];
ok(JSON.stringify([...homeList.matchAll(/<li><a href="\/([a-z-]+)">/g)].map((m) => m[1])) === JSON.stringify(order.map((k) => data.types[k].slug)), 'the home page lists all ten case types, each linking to its guide');
ok(/id="cases"/.test(home) && /id="cities"/.test(home), 'the home page has #cases and #cities (the footer link "Browse by Case Type", the hero filter icon and the city list land on them)');
ok(entries.every(([, t]) => { const icon = (homeList.match(new RegExp(`href="/${t.slug}">.*?#i-(\\w+)`)) || [])[1]; return icon === t.icon && home.includes(`<symbol id="i-${t.icon}"`); }), 'every home list icon exists in the page\'s sprite');
ok((home.match(/<h1[\s>]/g) || []).length === 1 && home.includes('<em>your</em>'), 'the home page has one h1');
ok(!/popular searches/i.test(home), 'the home page has no "Popular searches" row');
ok(/<img class="h5-photo" src="images\/home-courthouse\.webp" alt="" width="\d+" height="\d+"/.test(home) && existsSync('images/home-courthouse.webp'), 'the hero picture has a size and exists');
ok(/data-live="firms">[\d,]+</.test(home) && /data-live="cities">\d+</.test(home) && /class="h5-stats-in h3-stats"/.test(home), 'the home page shows the live firm and city totals in the stats band (site.js counts them up)');
ok(home.includes("LawdbSuggest(document.getElementById('heroInput'),document.getElementById('heroSuggest')") && /<form id="heroForm"[^>]*action="\/find-lawyers"/.test(home), 'the hero search box is still wired to the shared search');
ok(home.indexOf('id="homeNews"') < home.indexOf('id="cases"') && home.indexOf('class="h5-stats"') < home.indexOf('id="homeNews"'), 'the home page order is hero, numbers, news, case types');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
