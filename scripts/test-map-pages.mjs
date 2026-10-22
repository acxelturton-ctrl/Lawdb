// The map pages: the Find page's results view and every city and province page share lawdb-map.js / lawdb-map.css. The script builds the
// heading block, the search pill with the filters beside it, the map card (zoom, locate, "Search this area") and the list around the markup the pages
// already have, so these checks keep the pieces that have to agree in step: the ids the script reads, the pages that load the two files (all on the
// same ?v= so a change reaches visitors), the heading on every city and province page and the colours of the map itself.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PALETTE_HEX, parseColor } from './palette.mjs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const js = readFileSync('lawdb-map.js', 'utf8');
const css = readFileSync('lawdb-map.css', 'utf8');

// every element the script looks up by id is made by the script (or is one of the page's own ids it moves into the card)
const PAGE_IDS = new Set(['map', 'mapLoading', 'provinceNote', 'listBody', 'results']);
const made = new Set([...js.matchAll(/\bid="(gm\w+)"|\.id = '(gm\w+)'/g)].map((m) => m[1] || m[2]));
const used = new Set([...js.matchAll(/\$\('(\w+)'\)/g)].map((m) => m[1]));
const missing = [...used].filter((id) => !made.has(id) && !PAGE_IDS.has(id));
ok(missing.length === 0, `every id the script reads is built by it${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
ok(['gmTop', 'gmQ', 'gmFilter', 'gmChips', 'gmZin', 'gmZout', 'gmLoc', 'gmArea', 'gmPanel', 'gmSort', 'gmSortName'].every((id) => made.has(id)), 'the search pill, filter button, chips, zoom, locate, Search this area, list and sort are all built');
ok(/function buildHead\(/.test(js) && /className = 'gm-eyebrow'/.test(js) && /Trusted legal help, <em>near you\.<\/em>/.test(js), 'the heading block has an eyebrow and the Find page\'s own h1');
ok(!/NavigationControl|ScaleControl/.test(js), 'the library\'s own zoom group and scale bar are not used (the round zoom buttons are)');

// the classes the script writes are styled
const classes = [...new Set([...js.matchAll(/class(?:Name)?="?'?\s*=?\s*'?(gm-[\w-]+)/g)].map((m) => m[1]))];
const unstyled = classes.filter((c) => !css.includes(`.${c}`));
ok(unstyled.length === 0, `every gm- class the script writes is styled${unstyled.length ? ` (not styled: ${unstyled.join(', ')})` : ''}`);

// the pages that load the two files, all on the same version numbers
const pages = [];
const walk = (dir) => {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.claude', '.wrangler'].includes(d.name)) continue;
    const p = `${dir}/${d.name}`.replace(/^\.\//, '');
    if (d.isDirectory()) walk(p); else if (d.name.endsWith('.html')) pages.push(p);
  }
};
walk('.');
const withMap = pages.filter((p) => readFileSync(p, 'utf8').includes('lawdb-map.js'));
const vs = new Set(), vc = new Set();
for (const p of withMap) {
  const h = readFileSync(p, 'utf8');
  vs.add((h.match(/lawdb-map\.js\?v=(\d+)/) || [])[1]); vc.add((h.match(/lawdb-map\.css\?v=(\d+)/) || [])[1]);
}
ok(withMap.length > 60, `${withMap.length} pages load the map script`);
ok(vs.size === 1 && !vs.has(undefined) && vc.size === 1 && !vc.has(undefined), `all of them use the same version of the script (v=${[...vs]}) and of the style sheet (v=${[...vc]})`);

// a city or province page keeps its own h1 (the search engines' heading) and the script only dresses it
const noHero = [], odd = [];
for (const p of withMap.filter((x) => x !== 'find-lawyers.html')) {
  const h = readFileSync(p, 'utf8');
  const hero = (h.match(/<div class="city-hero"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
  if (!hero) { noHero.push(p); continue; }
  if (!/<h1[^>]*>Find a Lawyer in [^<]+<\/h1>/.test(hero) || (h.match(/<h1[\s>]/g) || []).length !== 1) odd.push(p);
}
ok(noHero.length === 0 && odd.length === 0, `every city and province page has one h1, "Find a Lawyer in …", in its .city-hero${noHero.length + odd.length ? ` (${[...noHero, ...odd].slice(0, 3).join(', ')})` : ''}`);

// the map's own colours (the basemap theme and the pins) are palette colours
const theme = (js.match(/var P = \{([\s\S]*?)\};/) || [])[1] || '';
const lit = [...theme.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g)].map((m) => m[0]);
const off = lit.filter((c) => { const v = parseColor(c); return !v || !PALETTE_HEX.has('#' + [v.r, v.g, v.b].map((n) => n.toString(16).padStart(2, '0')).join('')); });
ok(lit.length >= 12 && off.length === 0, `the basemap theme uses only palette colours (${lit.length} checked${off.length ? `, off: ${off.join(', ')}` : ''})`);
ok(/'circle-color': '#c9a050'/.test(js) && /'circle-stroke-color': '#ffffff'/.test(js), 'clusters are gold with a white ring');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
