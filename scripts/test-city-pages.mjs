// The city pages' upgrade (city-pages.css / city-pages.js, wired in by apply-city-page-ui.mjs) and the firms that listed themselves.
//   - a firm that exists only in the database (data/owner-firms.json) is on the baked pages: the table, the structured data, the hub's A to Z list;
//   - a firm with no Google rating is never shown as "0.0 stars";
//   - every city practice page carries its own city, province and case type for the script, and the two files are linked with their current hash;
//   - the script keeps to the rules it promises: motion off for reduced-motion, no style attributes in markup it writes, the live list from /api/firms.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSiteFirms, loadOwnerFirms, loadRepoFirms } from './lib/site-firms.mjs';
import { PROV, BY_SLUG } from './practice-pages-core.mjs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const owner = loadOwnerFirms();
const repo = new Set(loadRepoFirms().map((f) => f.slug));
ok(owner.length > 0 && owner.every((f) => !repo.has(f.slug)), 'the owner firms file holds only firms that are not in the repository data');
ok(loadSiteFirms().length === repo.size + owner.length, 'the shared loader counts every firm once');

const slugOf = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const TYPE_PAGE = Object.fromEntries([...BY_SLUG].map(([slug, t]) => [t[0], slug]));
let tables = 0, missingRow = 0, zero = 0;
for (const f of owner) {
  const dir = `${Object.entries(PROV).find(([, c]) => c === f.province)[0]}/${slugOf(f.city)}`;
  const hub = readFileSync(`${dir}/index.html`, 'utf8');
  if (!hub.includes(`href="/firms/${f.slug}"`)) missingRow++;
  for (const key of f.caseTypes || []) {
    const file = `${dir}/${TYPE_PAGE[key]}.html`;
    if (!existsSync(file)) continue; // a city page for that practice area exists only from four firms up
    tables++;
    const html = readFileSync(file, 'utf8');
    if (!html.includes(`<a href="/firms/${f.slug}">`) || !html.includes(`https://lawdb.ca/firms/${f.slug}`)) missingRow++;
    if (f.rating === 0 && /0\.0 stars|\(0\.0 stars/.test(html)) zero++;
  }
}
ok(missingRow === 0, `every owner firm is on its city hub and on each case-type page that exists for it (${tables} pages)`);
ok(zero === 0, 'no unrated firm is described as "0.0 stars"');

// wiring
const hash = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8);
const cssV = hash('city-pages.css'), jsV = hash('city-pages.js');
let pages = 0, wrong = [];
for (const [dirName, code] of Object.entries(PROV)) {
  for (const d of readdirSync(dirName, { withFileTypes: true })) {
    const dir = `${dirName}/${d.name}`;
    if (!d.isDirectory() || !existsSync(`${dir}/index.html`)) continue;
    const hm = readFileSync(`${dir}/index.html`, 'utf8').match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (!hm) continue;
    const city = hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    for (const f of readdirSync(dir)) {
      const t = BY_SLUG.get(f.replace(/\.html$/, ''));
      if (!t || !f.endsWith('.html')) continue;
      pages++;
      const html = readFileSync(`${dir}/${f}`, 'utf8');
      const attrs = html.match(/<body class="[^"]*\bpg-city\b[^"]*" data-city="([^"]*)" data-prov="([A-Z]{2})" data-type="([a-z]+)">/);
      const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
      if (!attrs || unesc(attrs[1]) !== city || attrs[2] !== code || attrs[3] !== t[0]) wrong.push(`${dir}/${f}: body attributes`);
      if (!html.includes(`href="../../city-pages.css?v=${cssV}"`) || !html.includes(`src="../../city-pages.js?v=${jsV}"`)) wrong.push(`${dir}/${f}: links`);
    }
  }
}
ok(pages > 100 && wrong.length === 0, `all ${pages} city practice pages know their city, province and case type and link the current files${wrong.length ? ': ' + wrong.slice(0, 3).join('; ') : ''}`);

// the script's promises
const js = readFileSync('city-pages.js', 'utf8'), css = readFileSync('city-pages.css', 'utf8');
ok(js.includes('prefers-reduced-motion') && css.includes('prefers-reduced-motion'), 'motion is switched off for visitors who ask for less of it (script and stylesheet)');
ok(!/style="/.test(js), 'the script writes no style attributes (widths and delays go through the style object)');
ok(js.includes("'/api/firms?province='") && js.includes('.catch('), 'the live list comes from /api/firms and a failed request leaves the baked list in place');
ok(/\.seo-tablewrap/.test(js) && js.includes('tableWrap.hidden'), 'the baked table stays in the page (hidden, and shown by the Table view)');
ok(js.includes('v.length <= 24'), 'a list of 24 firms or fewer is shown whole, so no firm hides behind a button');
ok([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].every((m) => ['#1b242d', '#142434', '#2b3a4c', '#c9a050', '#e2bd6a', '#e6d4a4', '#f4ecd8', '#f5f3ec', '#edeae1', '#e3dfd3', '#ffffff', '#fff', '#586170', '#8a919b', '#b4bac4'].includes(m[0].toLowerCase())), 'the stylesheet uses palette colours only');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('city page checks passed');
