// The "Lawyers in your city" directory on the home page: one column per province, its busiest cities with their firm counts, each linking to the city's page.
// Cities come from the firms (firms_data.json plus the released batches) and only those that have a page of their own are listed. The counts shown are the
// ones in the files; on the live site they are replaced by the current totals (data-live="city:PROV|City"), so a new firm shows up without a release.
//   node scripts/apply-home-cities.mjs          rewrites the block in index.html
//   node scripts/apply-home-cities.mjs --check  fails if the block is out of date (npm run check runs this)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const PER_PROVINCE = 8;
const PROVINCES = [['ON', 'ontario', 'Ontario'], ['AB', 'alberta', 'Alberta'], ['BC', 'british-columbia', 'British Columbia'], ['QC', 'quebec', 'Quebec'], ['MB', 'manitoba', 'Manitoba']];

function loadFirms() {
  const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
  const released = new Set(JSON.parse(readFileSync('data/release.json', 'utf8')).released);
  for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
    if (released.has(Number(file.match(/\d+/)[0]))) all.push(...JSON.parse(readFileSync(`data/${file}`, 'utf8')));
  }
  return all;
}
const slugOf = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function build(firms) {
  const cols = PROVINCES.map(([code, dir, name]) => {
    const counts = new Map();
    for (const f of firms) if (f.province === code && f.city) counts.set(f.city, (counts.get(f.city) || 0) + 1);
    const cities = [...counts].filter(([city]) => existsSync(`${dir}/${slugOf(city)}/index.html`))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PER_PROVINCE);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return { code, dir, name, total, cities };
  }).filter((c) => c.cities.length).sort((a, b) => b.total - a.total);
  const html = cols.map((c) => `<div class="cd-col"><h3><a href="${c.dir}/">${esc(c.name)}</a></h3><ul>${c.cities.map(([city, n]) =>
    `<li><a href="${c.dir}/${slugOf(city)}/">${esc(city)}<span data-live="city:${c.code}|${esc(city)}">${n}</span></a></li>`).join('')}</ul><a class="cd-all" href="${c.dir}/">All ${esc(c.name)} cities &rarr;</a></div>`).join('');
  return `<div class="cd-grid">${html}</div>`;
}

const FILE = 'index.html';
const page = readFileSync(FILE, 'utf8');
const re = /<!--home-dir-->[\s\S]*?<!--\/home-dir-->/;
if (!re.test(page)) { console.error(`${FILE}: the <!--home-dir--> markers are missing`); process.exit(1); }
const next = page.replace(re, () => `<!--home-dir-->${build(loadFirms())}<!--/home-dir-->`);
if (next === page) { console.log('home city directory: up to date'); process.exit(0); }
if (CHECK) { console.error('home city directory: index.html is out of date, run: node scripts/apply-home-cities.mjs'); process.exit(1); }
writeFileSync(FILE, next);
console.log('home city directory: updated');
