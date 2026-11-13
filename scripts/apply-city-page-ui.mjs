// Wires the city pages' upgrade (city-pages.css and city-pages.js: firm cards that can be searched and sorted, the side rail, the count-up and fade-in motion)
// into the pages that use it:
//   - every city case-type page (<province>/<city>/<practice>-lawyers.html): the stylesheet, the script, and on <body> the page's city, province and case
//     type (data-city, data-prov, data-type), which is how the script knows which live list to ask for;
//   - every city hub (<province>/<city>/index.html) and province hub (<province>/index.html): the stylesheet and the script (numbers and fade-ins only).
// On the case-type pages it also (a) swaps the top bar's two buttons for the sign-in page's single outlined "Sign in" button, and (b) points the page at its own
// background photo, images/city-bg/<province>-<city>-<practice>.webp (for example ontario-toronto-business.webp), when that file exists; a page without one gets the
// drawn skyline instead, so no photo is ever shown on two pages (scripts/test-city-pages.mjs fails if two pages share one).
// The two files are linked with a short hash of their contents (?v=...), so a change to either one reaches visitors at once; this script re-links every page.
//   node scripts/apply-city-page-ui.mjs          rewrites the pages
//   node scripts/apply-city-page-ui.mjs --check  fails if a page is out of date (npm run check runs this)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROV, BY_SLUG, esc } from './practice-pages-core.mjs';

const CHECK = process.argv.includes('--check');
const hash = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8);
const CSS = `<link rel="stylesheet" href="../../city-pages.css?v=${hash('city-pages.css')}">`;
const JS = `<script src="../../city-pages.js?v=${hash('city-pages.js')}" defer></script>`;
const NAV = '<nav class="desktop-nav" aria-label="Primary"><a href="/find-lawyers">Find Your Lawyer</a><a href="/news">LawDB News</a><a href="/for-firms">For Law Firms</a><span class="nav-sep" aria-hidden="true"></span><a class="nav-signin" href="/account/">Sign in</a></nav>';
const CSS_P = CSS.replace('../../', '../'); // province hubs sit one folder up
const JS_P = JS.replace('../../', '../');

let stale = 0, pages = 0;
function apply(file, { css, js, body }) {
  const old = readFileSync(file, 'utf8');
  let html = old;
  const sheet = /<link rel="stylesheet" href="(?:\.\.\/)+site\.css[^"]*">/, script = /<script src="(?:\.\.\/)+site\.js[^"]*" defer><\/script>/;
  if (!sheet.test(html) || !script.test(html)) { console.error(`${file}: site.css or site.js link not found`); stale++; return; }
  html = html.replace(/\n?<link rel="stylesheet" href="(?:\.\.\/)+city-pages\.css[^"]*">/, '').replace(/\n?<script src="(?:\.\.\/)+city-pages\.js[^"]*" defer><\/script>/, '');
  html = html.replace(sheet, (m) => `${m}\n${css}`).replace(script, (m) => `${m}\n${js}`);
  if (body) {
    const m = html.match(/<body class="([^"]*)"[^>]*>/);
    if (!m) { console.error(`${file}: <body class> not found`); stale++; return; }
    const classes = m[1].split(/\s+/).filter((c) => c && c !== 'pg-city');
    html = html.replace(m[0], `<body class="${[...classes, 'pg-city'].join(' ')}" data-city="${esc(body.city)}" data-prov="${body.code}" data-type="${body.type}"${body.bg ? ` data-bg="${body.bg}"` : ''}>`);
    html = html.replace(/<nav class="desktop-nav"[^>]*>[\s\S]*?<\/nav>/, () => NAV);
  }
  pages++;
  if (html === old) return;
  if (CHECK) { stale++; console.error('out of date:', file); } else writeFileSync(file, html);
}

for (const [dirName, code] of Object.entries(PROV)) {
  if (!existsSync(`${dirName}/index.html`)) continue;
  apply(`${dirName}/index.html`, { css: CSS_P, js: JS_P });
  for (const d of readdirSync(dirName, { withFileTypes: true })) {
    const dir = `${dirName}/${d.name}`;
    if (!d.isDirectory() || !existsSync(`${dir}/index.html`)) continue;
    const hub = readFileSync(`${dir}/index.html`, 'utf8');
    const hm = hub.match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (!hm) continue;
    const city = hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    apply(`${dir}/index.html`, { css: CSS, js: JS });
    for (const f of readdirSync(dir)) {
      const type = BY_SLUG.get(f.replace(/\.html$/, ''));
      if (!type || !f.endsWith('.html')) continue;
      const photo = `images/city-bg/${dirName}-${d.name}-${type[2].replace(/-lawyers$/, '')}.webp`;
      apply(`${dir}/${f}`, { css: CSS, js: JS, body: { city, code, type: type[0], bg: existsSync(photo) ? `/${photo}?v=${hash(photo)}` : '' } });
    }
  }
}
if (CHECK) { if (stale) process.exit(1); console.log(`city page upgrade is wired in (${pages} pages)`); }
else console.log(`city page upgrade wired into ${pages} pages`);
