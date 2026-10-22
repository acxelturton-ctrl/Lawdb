// Writes the "Browse by province, city and case type" block at the bottom of /find-lawyers (find-lawyers.html), between <!--browse-links-->
// markers, so it can be re-run. The page builds its case-type buttons and firm list in the browser, so on its own it showed a crawler one
// sentence and no links to any city or case-type page. These are ordinary links (no script needed) to every province page, every city hub
// and every province case-type page that exists and is not marked noindex.
//   node scripts/refresh-find-links.mjs          rewrites the block
//   node scripts/refresh-find-links.mjs --check  fails if the block is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const FILE = 'find-lawyers.html';
const PROVINCES = [['ontario', 'Ontario'], ['quebec', 'Quebec'], ['british-columbia', 'British Columbia'], ['alberta', 'Alberta'], ['manitoba', 'Manitoba']];

const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const indexable = (html) => !/<meta[^>]+name="robots"[^>]+noindex/i.test(html);

function provinceBlock([dir, name]) {
  if (!existsSync(`${dir}/index.html`) || !indexable(readFileSync(`${dir}/index.html`, 'utf8'))) return '';
  const cities = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${d.name}/index.html`;
    if (!d.isDirectory() || !existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const m = html.match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (m && indexable(html)) cities.push({ city: unesc(m[1]), href: `/${dir}/${d.name}/` });
  }
  cities.sort((a, b) => a.city.localeCompare(b.city, 'en'));
  const cases = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('-lawyers.html')).sort()) {
    const html = readFileSync(`${dir}/${f}`, 'utf8');
    const h = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    if (h && indexable(html)) cases.push({ label: unesc(h[1].trim()), href: `/${dir}/${f.replace(/\.html$/, '')}` });
  }
  const list = (items, text) => items.map((i) => `<a href="${i.href}">${esc(text(i))}</a>`);
  return `<div class="browse-prov"><h3><a href="/${dir}/">Lawyers in ${esc(name)}</a></h3>`
    + `<p class="browse-label">Cities</p><p class="browse-cities">${list(cities, (c) => c.city).join(' ')}</p>`
    + `<p class="browse-label">Case types</p><ul class="browse-cases">${list(cases, (c) => c.label).map((a) => `<li>${a}</li>`).join('')}</ul></div>`;
}

const block = '<!--browse-links--><section class="browse" id="browse" aria-labelledby="browseH">'
  + '<h2 id="browseH">Browse Canadian lawyers by province, city and case type</h2>'
  + '<p class="browse-lede">Each city page lists every law firm LawDB has there, A to Z, with its public Google rating. Each case-type page lists the firms that take that kind of case.</p>'
  + PROVINCES.map(provinceBlock).join('')
  + '</section><!--/browse-links-->';

const old = readFileSync(FILE, 'utf8');
let html;
if (old.includes('<!--browse-links-->')) html = old.replace(/<!--browse-links-->[\s\S]*?<!--\/browse-links-->/, () => block);
else {
  const anchor = '<footer class="site-footer">';
  if (old.split(anchor).length !== 2) { console.error(`anchor not found exactly once in ${FILE}: ${anchor}`); process.exit(1); }
  html = old.replace(anchor, () => `${block}\n\n${anchor}`);
}
if (html === old) console.log(CHECK ? 'find-lawyers browse links are up to date' : 'find-lawyers browse links unchanged');
else if (CHECK) { console.error(`out of date: ${FILE}`); process.exit(1); }
else { writeFileSync(FILE, html); console.log('find-lawyers browse links written'); }
