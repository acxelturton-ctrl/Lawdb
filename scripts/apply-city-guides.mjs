// Writes the sourced local facts in data/city-guides.json into the city hub and the city practice-area pages
// (manitoba/winnipeg/index.html, manitoba/winnipeg/criminal-defence-lawyers.html ...), between <!--city-guide--> markers, so it can be re-run.
// A practice page also gets "firms closest to the courthouse", worked out from the firms' map positions.
//   node scripts/apply-city-guides.mjs          rewrites the pages
//   node scripts/apply-city-guides.mjs --check  fails if a page is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const GUIDES = JSON.parse(readFileSync('data/city-guides.json', 'utf8'));

function loadFirms() {
  const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
  const released = new Set(JSON.parse(readFileSync('data/release.json', 'utf8')).released);
  for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
    if (released.has(Number(file.match(/\d+/)[0]))) all.push(...JSON.parse(readFileSync(`data/${file}`, 'utf8')));
  }
  return all;
}
const firms = loadFirms();

const CASE_KEY = { 'business-lawyers': 'business', 'criminal-defence-lawyers': 'criminal', 'employment-lawyers': 'employment', 'family-lawyers': 'family', 'immigration-lawyers': 'immigration', 'litigation-lawyers': 'litigation', 'real-estate-lawyers': 'realestate', 'wills-estate-lawyers': 'wills' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const km = (a, b) => {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const items = (list) => `<ul>${list.map((i) => `<li>${esc(i.text)} <span class="seo-src">Source: ${i.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>`).join(', ')}</span></li>`).join('')}</ul>`;

// "6 of the 7 firms on this page are within 1.5 km of the courthouse" with the closest few, linked
function nearBlock(g, label, list) {
  const c = g.courthouse;
  if (!c || list.length < 3) return '';
  const withDist = list.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng)).map((f) => ({ f, d: km(c, f) })).sort((a, b) => a.d - b.d);
  const near = withDist.filter((x) => x.d <= 1.5);
  if (!near.length) return '';
  const top = near.slice(0, 4).map((x) => `<a href="/firms/${x.f.slug}">${esc(x.f.name)}</a> (${x.d.toFixed(1)} km)`).join(', ');
  const lead = near.length === list.length ? `All ${list.length} ${esc(label)} firms listed` : `${near.length} of the ${list.length} ${esc(label)} firms listed`;
  return `<h3>Firms close to the courthouse</h3><p>${lead} in ${esc(g.city)} have an office within 1.5 km of the ${esc(c.name)}, ${esc(c.address)}, measured in a straight line from each firm's position on the LawDB map. Closest: ${top}.</p>`;
}

function guideHtml(g, page, def, pageHtml) {
  const isHub = page === 'index';
  const H = isHub ? ['h3', 'h4'] : ['h2', 'h3'];
  let body = def.groups.map((gr) => `<${H[1]}>${esc(gr.heading)}</${H[1]}>${items(gr.items)}`).join('');
  if (def.near) {
    // the firms in this page's own table, so the numbers here match the numbers above them
    const table = (pageHtml.match(/<table[\s\S]*?<\/table>/) || [''])[0];
    const onPage = new Set([...table.matchAll(/href="\/firms\/([a-z0-9-]+)"/g)].map((m) => m[1]));
    const list = firms.filter((f) => onPage.has(f.slug));
    body += nearBlock(g, def.near, list);
  }
  const note = `<p class="seo-note">Every point comes from the official page linked beside it (last checked ${esc(g.checked)}); courts and agencies change their details, so confirm with them before you go. This is general information, not legal advice.</p>`;
  const cls = isHub ? 'seo-local seo-local-hub' : 'seo-local';
  return `<!--city-guide--><${H[0]}${isHub ? '' : ' class="seo-h"'}>${esc(def.title)}</${H[0]}><div class="${cls}">${body}${note}</div><!--/city-guide-->`;
}

let stale = 0, written = 0;
for (const [key, g] of Object.entries(GUIDES)) {
  if (key.startsWith('_')) continue;
  for (const [page, def] of Object.entries(g.pages)) {
    const file = `${key}/${page === 'index' ? 'index' : page}.html`;
    if (!existsSync(file)) { console.error('missing page:', file); stale++; continue; }
    const old = readFileSync(file, 'utf8');
    const block = guideHtml(g, page, def, old);
    let html;
    if (old.includes('<!--city-guide-->')) html = old.replace(/<!--city-guide-->[\s\S]*?<!--\/city-guide-->/, () => block);
    else {
      const anchor = page === 'index' ? '<h3>Frequently asked questions</h3>' : '<h2 class="seo-h">Frequently asked questions</h2>';
      if (old.split(anchor).length !== 2) { console.error('anchor not found exactly once in', file, '->', anchor); stale++; continue; }
      html = old.replace(anchor, () => `${block}\n    ${anchor}`);
    }
    if (html !== old) { if (CHECK) { stale++; console.error('out of date:', file); } else { writeFileSync(file, html); written++; } }
  }
}
if (CHECK) { if (stale) process.exit(1); console.log('city guides are up to date'); }
else { if (stale) process.exit(1); console.log(`city guides written to ${written} pages`); }
