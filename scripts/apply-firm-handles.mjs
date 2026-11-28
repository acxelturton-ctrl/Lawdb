// The addresses of firm pages in the pages saved in the site files: /firm/<handle> (the old /firms/<slug> redirects, but a page should link straight to the address it is at).
//   node scripts/apply-firm-handles.mjs            rewrites the pages
//   node scripts/apply-firm-handles.mjs --check    fails if a page still links to /firms/<slug> for a firm that has a handle (npm run check runs this)
// Also the saved sitemap.xml (its <loc> addresses).
// Rewrites "/firms/<slug>", "/firms/<slug>/lawyers", "/firms/<slug>/articles" and the same with https://lawdb.ca in front (canonical, og:url, structured data, the lists of firms).
// A link to a lawyer's own page (/firms/<slug>/lawyers/<lawyer>) is left alone and reported: those pages are /lawyer/<name> now, and only the Worker knows who has one.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadHandles } from './lib/firm-handles.mjs';

const CHECK = process.argv.includes('--check');
const SKIP = new Set(['node_modules', '.wrangler', '.git', 'migrations', 'data', 'docs', 'db']);
const handles = loadHandles();

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) yield* walk(p); else if (name.endsWith('.html') || (dir === '.' && name === 'sitemap.xml')) yield p;
  }
}

const RE = /(["'(>])((?:https:\/\/lawdb\.ca)?)\/firms\/([a-z0-9][a-z0-9-]*)((?:\/(?:lawyers|articles))?)(?=["'?#)\/<])(?!\/lawyers\/)/g;
let changed = 0, left = [];
for (const file of walk('.')) {
  const html = readFileSync(file, 'utf8');
  const out = html.replace(RE, (all, q, origin, slug, tab) => (handles[slug] ? `${q}${origin}/firm/${handles[slug]}${tab}` : all));
  if (/\/firms\/[a-z0-9-]+\/lawyers\/[a-z0-9]/.test(out)) left.push(file);
  if (out === html) continue;
  changed++;
  if (CHECK) { console.error(`${file} still links to /firms/<slug> (run node scripts/apply-firm-handles.mjs)`); process.exit(1); }
  writeFileSync(file, out);
}
if (left.length) console.warn(`${left.length} page(s) still link to a lawyer's page at /firms/<slug>/lawyers/<lawyer>: ${left.slice(0, 3).join(', ')}`);
console.log(CHECK ? 'firm addresses: every saved page links to /firm/<handle>' : `firm addresses: ${changed} page(s) updated`);
