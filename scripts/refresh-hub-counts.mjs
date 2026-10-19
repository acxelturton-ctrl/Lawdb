// Refreshes the counts and lists baked into the province and city hub pages (<province>/index.html, <province>/<city>/index.html):
// number of firms, average rating, review total, "rated 4.5+", practice-area counts, city counts, the top-rated firms, the
// "most firms" sentences, and the matching meta descriptions and FAQ answers. The words around them are left as they are.
// Firms come from firms_data.json plus the released data/firms-batch-N.json files, so run this after adding firms.
//   node scripts/refresh-hub-counts.mjs          rewrites the pages
//   node scripts/refresh-hub-counts.mjs --check  fails if a page is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const FIRMS_FILE = process.env.HUB_FIRMS_FILE; // test hook: a JSON array of firms to use instead of the repository's
const firms = FIRMS_FILE ? JSON.parse(readFileSync(FIRMS_FILE, 'utf8')) : loadFirms();

function loadFirms() {
  const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
  const released = new Set(JSON.parse(readFileSync('data/release.json', 'utf8')).released);
  for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
    if (released.has(Number(file.match(/\d+/)[0]))) all.push(...JSON.parse(readFileSync(`data/${file}`, 'utf8')));
  }
  return all;
}

const PROV = { ontario: 'ON', quebec: 'QC', 'british-columbia': 'BC', alberta: 'AB', manitoba: 'MB' };
const TYPES = [
  // key, chip label, page slug, name used in sentences
  ['realestate', 'Real Estate', 'real-estate-lawyers', 'real estate'],
  ['wills', 'Wills & Estates', 'wills-estate-lawyers', 'wills and estates'],
  ['litigation', 'Litigation', 'litigation-lawyers', 'litigation'],
  ['business', 'Business', 'business-lawyers', 'business'],
  ['family', 'Family', 'family-lawyers', 'family law'],
  ['injury', 'Personal Injury', 'personal-injury-lawyers', 'personal injury'],
  ['employment', 'Employment', 'employment-lawyers', 'employment'],
  ['immigration', 'Immigration', 'immigration-lawyers', 'immigration'],
  ['criminal', 'Criminal Defence', 'criminal-defence-lawyers', 'criminal defence'],
  ['traffic', 'Traffic Tickets', 'traffic-ticket-lawyers', 'traffic ticket'],
];
const OFF_LABEL = { realestate: 'Real Estate', wills: 'Wills & Estates', litigation: 'Litigation', business: 'Business', family: 'Family', injury: 'Personal Injury', employment: 'Employment', immigration: 'Immigration', criminal: 'Criminal Defence', traffic: 'Traffic Tickets' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const fmt = (n) => n.toLocaleString('en-CA');
const stats = (list) => {
  const rated = list.filter((f) => f.rating > 0);
  return {
    n: list.length,
    avg: rated.length ? (rated.reduce((a, f) => a + f.rating, 0) / rated.length).toFixed(1) : '0.0',
    reviews: list.reduce((a, f) => a + (f.count || 0), 0),
    high: list.filter((f) => f.rating >= 4.5).length,
    featured: list.filter((f) => f.featured).length,
  };
};
const ranked = (list) => [...list].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.rating - a.rating || b.count - a.count || a.name.localeCompare(b.name));
const typeCounts = (list) => TYPES.map(([k, label, page, sent]) => ({ k, label, page, sent, n: list.filter((f) => (f.caseTypes || []).includes(k)).length })).filter((t) => t.n > 0);
const byCount = (arr) => [...arr].sort((a, b) => b.n - a.n);

function row(f) {
  const stars = '★'.repeat(Math.max(1, Math.ceil(f.rating - 0.5)));
  const tags = (f.tags || []).filter(Boolean).slice(0, 3);
  const meta = `${stars} ${f.rating.toFixed(1)} from ${f.count} Google reviews${tags.length ? ' &middot; ' + esc(tags.join(', ')) : ''}${f.address ? ' &middot; ' + esc(f.address) : ''}`;
  return `<a class="frow" href="/firms/${f.slug}"><span class="rname">${esc(f.name)}${f.featured ? '<span class="seo-feat">Featured</span>' : ''}</span><span class="rmeta">${meta}</span></a>`;
}

// the street that several firms share ("Several firms are located on Carling Ave.")
const streetOf = (a) => String(a || '').split(',')[0].replace(/\s+(?:#|Suite|Ste|Unit|Floor|Fl)\b.*$/i, '').replace(/^\d+[A-Za-z-]*\s+/, '').replace(/\s+\d+(st|nd|rd|th) Floor.*$/i, '').trim();
function sharedStreets(list) {
  const m = new Map();
  for (const f of list) { const s = streetOf(f.address); if (s.length > 3) m.set(s, (m.get(s) || 0) + 1); }
  return [...m].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([s]) => s);
}

const cityHref = new Map(); // 'ON|Toronto' -> 'ontario/toronto/'
let stale = 0;
const save = (file, html, old) => { if (html !== old) { if (CHECK) { stale++; console.error('out of date:', file); } else writeFileSync(file, html); } };
const plural = (n, a, b) => (n === 1 ? a : b);

function chips(items) { return `<div class="seo-chips">${items.join('')}</div>`; }

function updateCommon(html, repl) {
  for (const [re, to] of repl) html = html.replace(re, to);
  return html;
}

// ---------------------------------------------------------------- city pages
function cityPage(file, province) {
  let html = readFileSync(file, 'utf8');
  const hm = html.match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
  if (!hm) return;
  const city = hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  const provName = hm[2];
  const dir = file.replace(/\/index\.html$/, '');
  cityHref.set(`${province}|${city}`, dir + '/');
  const list = firms.filter((f) => f.province === province && f.city === city);
  if (!list.length) return;
  const s = stats(list);
  const top = ranked(list);
  const best = [...list].sort((a, b) => b.rating - a.rating || b.count - a.count)[0];
  const tcs = byCount(typeCounts(list));
  const area = tcs.slice(0, 4).map((t) => `${t.sent} (${t.n})`).join(', ');

  const lede = html.match(/<p class="seo-lede">([\s\S]*?)<\/p>/);
  if (!lede) return;
  // keep the local sentences after the facts (court and market notes), drop the old street sentence and rebuild it
  let tail = lede[1].replace(/^.*?\(\d[\d.]* stars from \d+ reviews\)\.\s*/s, '').replace(/^\d+ firms? (?:is a Featured partner and is|are Featured partners and are) listed first\.\s*/, '').replace(/\s*Several firms are located on .*$/s, '').trim();
  const streets = sharedStreets(list);
  const newLede = `LawDB lists ${s.n} law firms in ${esc(city)}, ${provName}, with an average Google rating of ${s.avg} across ${fmt(s.reviews)} reviews. ${area ? `The practice areas with the most firms are ${area}. ` : ''}The highest-rated is ${esc(best.name)} (${best.rating.toFixed(1)} stars from ${best.count} reviews). ${s.featured ? `${s.featured} ${plural(s.featured, 'firm is a Featured partner and is', 'firms are Featured partners and are')} listed first. ` : ''}${tail}${tail ? ' ' : ''}${streets.length ? `Several firms are located on ${streets.join(' and ')}. ` : ''}`;
  html = html.replace(lede[0], () => `<p class="seo-lede">${newLede}</p>`);

  html = html.replace(/<div class="seo-stats">[\s\S]*?<\/div><\/div>/, () => `<div class="seo-stats"><div><b>${s.n}</b><span>firms listed</span></div><div><b>${s.avg}</b><span>average rating</span></div><div><b>${fmt(s.reviews)}</b><span>Google reviews</span></div><div><b>${s.high}</b><span>rated 4.5+</span></div></div>`);

  // practice-area chips: a link where the city has a page for that practice area, plain text where it does not
  const base = '/' + dir;
  html = html.replace(/(<h3>Browse by practice area<\/h3>\s*)<div class="seo-chips">[\s\S]*?<\/div>/, (_, h3) => h3 + chips(tcs.map((t) => (existsSync(`${dir}/${t.page}.html`)
    ? `<a class="seo-chip" href="${base}/${t.page}">${t.label} lawyers <span>${t.n}</span></a>`
    : `<span class="seo-chip off">${OFF_LABEL[t.k]} <span>${t.n}</span></span>`))));

  html = html.replace(/(<div class="flist">)[\s\S]*?(<\/div>)/, (_, a, b) => a + top.slice(0, 20).map(row).join('') + b);

  const fa = s.featured ? `LawDB lists ${s.n} law firms in ${esc(city)}, ${s.featured} of which ${plural(s.featured, 'is a Featured partner', 'are Featured partners')}.` : `LawDB lists ${s.n} law firms in ${esc(city)}.`;
  const faRe = new RegExp(`LawDB lists \\d+ law firms in ${esc(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:, \\d+ of which (?:is a Featured partner|are Featured partners))?\\.`, 'g');
  html = html.replace(faRe, () => fa);

  html = html.replace(new RegExp(`(Compare )\\d+( law firms in ${esc(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'), `$1${s.n}$2`);
  save(file, html, readFileSync(file, 'utf8'));
}

// ------------------------------------------------------------ province pages
function provincePage(file, province) {
  let html = readFileSync(file, 'utf8');
  const hm = html.match(/<h2>Law firms in ([^<]+)<\/h2>\s*<p class="seo-lede">/);
  if (!hm) return;
  const provName = hm[1];
  const dir = file.replace(/\/index\.html$/, '');
  const list = firms.filter((f) => f.province === province);
  const s = stats(list);
  const cityCounts = byCount([...new Set(list.map((f) => f.city))].map((c) => ({ c, n: list.filter((f) => f.city === c).length })).map((x) => ({ ...x, name: x.c })));
  const cities = cityCounts.length;

  const lede = html.match(/<p class="seo-lede">([\s\S]*?)<\/p>/);
  const tail = lede[1].replace(/^.*?The cities with the most firms are [^.]*\.\s*/s, '');
  const topCities = cityCounts.slice(0, 4).map((x) => esc(x.c)).join(', ');
  html = html.replace(lede[0], () => `<p class="seo-lede">LawDB lists ${s.n} law firms across ${cities} ${plural(cities, 'city', 'cities')} in ${provName}, with an average Google rating of ${s.avg} across ${fmt(s.reviews)} reviews. The ${plural(cities, 'city with the most firms is', 'cities with the most firms are')} ${topCities}. ${tail}</p>`);
  html = html.replace(/<div class="seo-stats">[\s\S]*?<\/div><\/div>/, () => `<div class="seo-stats"><div><b>${s.n}</b><span>firms listed</span></div><div><b>${s.avg}</b><span>average rating</span></div><div><b>${fmt(s.reviews)}</b><span>Google reviews</span></div><div><b>${s.high}</b><span>rated 4.5+</span></div></div>`);

  // city chips keep their links; counts and order follow the firms
  const cityLinks = new Map([...html.match(/<h3>Browse by city<\/h3>[\s\S]*?<\/div>/)[0].matchAll(/<a class="seo-chip" href="([^"]+)">(.*?) <span>/g)].map((m) => [m[2].replace(/&amp;/g, '&').replace(/&#x27;/g, "'"), m[1]]));
  html = html.replace(/(<h3>Browse by city<\/h3>\s*)<div class="seo-chips">[\s\S]*?<\/div>/, (_, h3) => h3 + chips(cityCounts.filter((x) => cityLinks.has(x.c)).map((x) => `<a class="seo-chip" href="${cityLinks.get(x.c)}">${esc(x.c)} <span>${x.n}</span></a>`)));

  const tcs = byCount(typeCounts(list));
  html = html.replace(/(<h3>Browse by practice area<\/h3>\s*)<div class="seo-chips">[\s\S]*?<\/div>/, (_, h3) => h3 + chips(tcs.map((t) => (existsSync(`${dir}/${t.page}.html`) ? `<a class="seo-chip" href="/${dir}/${t.page}">${t.label} lawyers <span>${t.n}</span></a>` : `<span class="seo-chip off">${OFF_LABEL[t.k]} <span>${t.n}</span></span>`))));

  html = html.replace(/(<div class="flist">)[\s\S]*?(<\/div>)/, (_, a, b) => a + ranked(list).slice(0, 20).map(row).join('') + b);

  const re = new RegExp(`LawDB lists \\d+ law firms across \\d+ cit(?:y|ies) in ${provName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
  html = html.replace(re, `LawDB lists ${s.n} law firms across ${cities} ${plural(cities, 'city', 'cities')} in ${provName}`);
  html = html.replace(new RegExp(`(Browse )\\d+( law firms in ${provName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'), `$1${s.n}$2`);
  html = html.replace(/(\| )\d+( Lawyers by City)/g, `$1${s.n}$2`);
  save(file, html, readFileSync(file, 'utf8'));
}

for (const [dirName, code] of Object.entries(PROV)) {
  if (!existsSync(`${dirName}/index.html`)) continue;
  provincePage(`${dirName}/index.html`, code);
  for (const d of readdirSync(dirName, { withFileTypes: true })) if (d.isDirectory() && existsSync(`${dirName}/${d.name}/index.html`)) cityPage(`${dirName}/${d.name}/index.html`, code);
}
// the home page's "Browse by city" strip: the twelve cities with the most firms
{
  const home = readFileSync('index.html', 'utf8');
  const counts = new Map();
  for (const f of firms) counts.set(`${f.province}|${f.city}`, (counts.get(`${f.province}|${f.city}`) || 0) + 1);
  const top = [...counts].filter(([k]) => cityHref.has(k)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  const chipsHtml = top.map(([k, n]) => `<a class="cc" href="${cityHref.get(k)}">${esc(k.split('|')[1])}<span data-live="city:${esc(k)}">${n}</span></a>`).join('');
  save('index.html', home.replace(/(<div class="cs-chips">)[\s\S]*?(<\/div>)/, (_, a, b) => a + chipsHtml + b), home);
}
if (CHECK) { if (stale) process.exit(1); console.log('hub page counts are up to date'); } else console.log('hub page counts refreshed');
