// Refreshes the firm-dependent parts of the city practice-area pages (<province>/<city>/<practice>-lawyers.html): the title and descriptions,
// the opening paragraph and its four numbers, the table of firms, the firm snapshots, the answers that quote a count, the structured data
// and the other-practice-areas chips. The hand-written words around them are left as they are. The pages were first built from the original
// 370 firms and never rebuilt, so by October 2026 most of them listed only a fraction of the firms the directory now has.
// Firms come from firms_data.json plus the released data/firms-batch-N.json files, like the city pages (refresh-hub-counts.mjs).
//   node scripts/refresh-practice-pages.mjs          rewrites the pages
//   node scripts/refresh-practice-pages.mjs --check  fails if a page is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { PROV, BY_SLUG, loadFirms, refreshHtml } from './practice-pages-core.mjs';

const CHECK = process.argv.includes('--check');
const TODAY = process.env.REFRESH_DATE || new Date().toISOString().slice(0, 10); // only used in dateModified when a page changes
const FIRMS_FILE = process.env.HUB_FIRMS_FILE; // test hook, as in refresh-hub-counts.mjs
const firms = FIRMS_FILE ? JSON.parse(readFileSync(FIRMS_FILE, 'utf8')) : loadFirms();

let stale = 0, changed = 0, pages = 0;
function refreshPage(file, ctx) {
  const old = readFileSync(file, 'utf8');
  let html = refreshHtml(old, { ...ctx, file }, firms, existsSync);
  if (html === null) return;
  pages++;
  const stripDate = (h) => h.replace(/"dateModified": "[^"]*"/, '"dateModified": ""');
  if (stripDate(html) !== stripDate(old)) {
    if (CHECK) { stale++; console.error('out of date:', file); return; }
    html = html.replace(/"dateModified": "[^"]*"/, `"dateModified": "${TODAY}"`);
    writeFileSync(file, html);
    changed++;
  }
}

for (const [dirName, code] of Object.entries(PROV)) {
  if (!existsSync(dirName)) continue;
  for (const d of readdirSync(dirName, { withFileTypes: true })) {
    const dir = `${dirName}/${d.name}`;
    if (!d.isDirectory() || !existsSync(`${dir}/index.html`)) continue;
    const hm = readFileSync(`${dir}/index.html`, 'utf8').match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (!hm) continue;
    const city = hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    for (const f of readdirSync(dir)) {
      const type = BY_SLUG.get(f.replace(/\.html$/, ''));
      if (type && f.endsWith('.html')) refreshPage(`${dir}/${f}`, { city, provName: hm[2], code, dir, type });
    }
  }
}
if (CHECK) { if (stale) process.exit(1); console.log(`practice pages are up to date (${pages} checked)`); }
else console.log(`${pages} practice pages checked, ${changed} refreshed`);
