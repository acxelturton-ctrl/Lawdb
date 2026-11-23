// The firm-dependent parts of a city practice page, rebuilt from the firm data. Used by refresh-practice-pages.mjs (existing pages) and
// build-city-practice-pages.mjs (new ones). Pure functions: they take page text and return page text.
import { readFileSync } from 'node:fs';
import { loadSiteFirms, rated } from './lib/site-firms.mjs';
import { matterRows, matterFacts, PER_ROW } from './lib/matters.mjs';

// Every firm the site lists: the repository's own plus the ones that listed themselves (data/owner-firms.json).
export const loadFirms = loadSiteFirms;

export const PROV = { ontario: 'ON', quebec: 'QC', 'british-columbia': 'BC', alberta: 'AB', manitoba: 'MB' };
export const TYPES = [
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
export const BY_SLUG = new Map(TYPES.map((t) => [t[2], t]));

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
export const fmt = (n) => n.toLocaleString('en-CA');
export const ranked = (list) => [...list].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.rating - a.rating || b.count - a.count || a.name.localeCompare(b.name));
const phone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''; };
const firmsPhrase = (sent) => (/ law$/.test(sent) ? `${sent} firms` : `${sent} law firms`); // "family law firms", "real estate law firms"
export const plural = (n, a, b) => (n === 1 ? a : b);

export function stats(list) {
  const rated = list.filter((f) => f.rating > 0);
  return {
    n: list.length,
    avg: rated.length ? (rated.reduce((a, f) => a + f.rating, 0) / rated.length).toFixed(1) : '0.0',
    reviews: list.reduce((a, f) => a + (f.count || 0), 0),
    high: list.filter((f) => f.rating >= 4.5).length,
    featured: list.filter((f) => f.featured).length,
  };
}

function snapshot(f) {
  if (!rated(f)) return `<p>${esc(f.name)} is new on LawDB and has no Google rating yet. The office is at ${esc(f.address)}.${(f.tags || []).filter(Boolean).length ? ` Listed focus areas: ${esc((f.tags || []).filter(Boolean).slice(0, 4).join(', '))}.` : ''}${f.featured ? ' It is a Featured partner.' : ''}</p>`;
  const lead = f.rating >= 4.8 ? 'is one of the highest-rated firms on this page at' : f.rating >= 4.5 ? 'has a strong rating at' : 'is rated at';
  const tags = (f.tags || []).filter(Boolean).slice(0, 4);
  return `<p>${esc(f.name)} ${lead} ${f.rating.toFixed(1)} stars, based on ${fmt(f.count)} Google reviews. The office is at ${esc(f.address)}.${tags.length ? ` Listed focus areas: ${esc(tags.join(', '))}.` : ''}${f.featured ? ' It is a Featured partner.' : ''}</p>`;
}

const row = (f) => `<tr><td><a href="/firms/${f.slug}">${esc(f.name)}</a>${f.featured ? ' <span class="seo-feat">Featured</span>' : ''}</td><td>${rated(f) ? f.rating.toFixed(1) : '&ndash;'}</td><td>${rated(f) ? fmt(f.count) : '&ndash;'}</td><td>${esc(f.address)}</td><td>${esc(phone(f.phone))}</td></tr>`;

// "By the kind of matter": rows of the kinds of matter the firms' profiles mention, each with up to PER_ROW of those firms and the facts the profile holds (scripts/lib/matters.mjs).
const REGULATOR = { ON: 'Law Society of Ontario', AB: 'Law Society of Alberta', BC: 'Law Society of British Columbia', MB: 'Law Society of Manitoba', QC: 'Barreau du Qu\u00e9bec' };
let matterData = null;
const matterCtx = () => matterData || (matterData = {
  copy: JSON.parse(readFileSync('data/firm-copy.json', 'utf8')),
  details: JSON.parse(readFileSync('data/firm-details.json', 'utf8')),
  stored: JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8')),
});
const andList = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
const MATTERS_BLOCK = /<!--matters-->[\s\S]*?<!--\/matters-->\s*/;

export function matterBlock(key, list, { city, code, sent }) {
  const ctx = matterCtx();
  const rows = matterRows(key, list, ctx);
  if (!rows.length) return '';
  const body = rows.map((r) => {
    const n = r.firms.length;
    return `<tbody>${r.firms.map(({ firm: f, also }, i) => {
      const digits = String(f.phone || '').replace(/\D/g, '').slice(-10);
      const tel = /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? ` <a class="mt-tel" href="tel:+1${digits}">${phone(f.phone)}</a>` : '';
      const head = i === 0 ? `<th scope="rowgroup" rowspan="${n}" class="mt-matter">${esc(r.label)}<span>${n === r.total ? `${r.total} ${plural(r.total, 'firm', 'firms')}` : `${n} of ${r.total} firms`}</span></th>` : '';
      return `<tr>${head}<td class="mt-firm"><a href="/firms/${f.slug}">${esc(f.name)}</a>${f.featured ? ' <span class="seo-feat">Featured</span>' : ''}${tel}</td><td class="mt-facts">${esc(matterFacts(f, ctx).join(' \u00b7 '))}${also.length ? `<em>Its profile also mentions ${esc(andList(also))}.</em>` : ''}</td></tr>`;
    }).join('')}</tbody>`;
  }).join('');
  return `<!--matters-->
  <h2 class="seo-h">Find a ${esc(sent)} lawyer in ${esc(city)} by the kind of matter</h2>
  <p class="mt-lede">Each row is a kind of matter and up to ${PER_ROW} of the firms above whose LawDB profile mentions it, in the same order as the table of firms. The last column is facts from the profile. It is not a recommendation or a ranking.</p>
  <div class="mt-wrap"><table class="mt-table"><thead><tr><th scope="col">If your matter involves</th><th scope="col">Firm and phone</th><th scope="col">What its profile shows</th></tr></thead>${body}</table></div>
  <p class="mt-note">A firm is in a row because its profile text mentions that kind of matter; a firm that is not in a row may still take such cases, so ask. This is not a claim that any lawyer is a specialist. Check any lawyer with the ${REGULATOR[code] || 'law society'} before you hire.</p>
  <!--/matters-->
  `;
}

export function refreshHtml(old, ctx, firms, pageExists) {
  const { city, provName, code, dir, type, file = '(page)' } = ctx;
  const [key, label, slug, sent] = type;
  const cityFirms = firms.filter((f) => f.province === code && f.city === city);
  const list = ranked(cityFirms.filter((f) => (f.caseTypes || []).includes(key)));
  if (!list.length) return null;
  const s = stats(list);
  const best = [...list].sort((a, b) => b.rating - a.rating || b.count - a.count)[0];
  const phrase = firmsPhrase(sent);
  let html = old.replace(MATTERS_BLOCK, '');
  const sub = (re, to, what) => { if (!re.test(html)) throw new Error(`${file}: ${what} not found`); html = html.replace(re, to); };

  // title, share title, structured-data name: "| 7 Firms |"
  html = html.replace(/\| \d+ Firms? \| LawDB\.ca/g, `| ${s.n} ${plural(s.n, 'Firm', 'Firms')} | LawDB.ca`);
  // description, share description, structured-data description (a Featured partner is mentioned only while there is one)
  const cityRe = esc(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const featClause = s.featured ? `; ${s.featured} Featured ${plural(s.featured, 'partner', 'partners')} listed first` : '';
  html = html.replace(new RegExp(`Compare \\d+ [^<">]*? in ${cityRe}, ${provName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. See Google ratings, review counts, addresses and phone numbers, and how to choose a lawyer(?:; \\d+ Featured partners? listed first)?\\.`, 'g'),
    () => `Compare ${s.n} ${phrase.replace(/ firms$/, plural(s.n, ' firm', ' firms'))} in ${esc(city)}, ${provName}. See Google ratings, review counts, addresses and phone numbers, and how to choose a lawyer${featClause}.`);

  // opening paragraph: keep the hand-written local sentences that follow the facts
  const lede = html.match(/<div class="seo-text"><p>(LawDB lists [\s\S]*?)<\/p><\/div>/);
  if (!lede) throw new Error(`${file}: opening paragraph not found`);
  const tail = lede[1].replace(/^[\s\S]*?\(\d[\d.]* stars from [\d,]+ reviews\)\.\s*/, '').replace(/^\d+ firms? (?:is a Featured partner and is|are Featured partners and are) listed first\.\s*/, '').trim();
  const feat = s.featured ? `${s.featured} ${plural(s.featured, 'firm is a Featured partner and is', 'firms are Featured partners and are')} listed first. ` : '';
  const newLede = `LawDB lists ${s.n} ${phrase.replace(/ firms$/, plural(s.n, ' firm', ' firms'))} in ${esc(city)}, ${provName}, with an average Google rating of ${s.avg} across ${fmt(s.reviews)} reviews. ${s.high} of them ${plural(s.high, 'has', 'have')} a rating of 4.5 or higher. The highest-rated is ${esc(best.name)} (${best.rating.toFixed(1)} stars from ${fmt(best.count)} reviews). ${feat}${tail}`.trim();
  html = html.replace(lede[0], () => `<div class="seo-text"><p>${newLede}</p></div>`);

  sub(/<div class="seo-stats">[\s\S]*?<\/div><\/div>/, () => `<div class="seo-stats"><div><b>${s.n}</b><span>firms listed</span></div><div><b>${s.avg}</b><span>average rating</span></div><div><b>${fmt(s.reviews)}</b><span>Google reviews</span></div><div><b>${s.high}</b><span>rated 4.5+</span></div></div>`, 'stats');
  sub(/<tbody>[\s\S]*?<\/tbody>/, () => `<tbody>${list.map(row).join('')}</tbody>`, 'table');
  const matters = matterBlock(key, list, { city, code, sent });
  if (matters) sub(/(<div class="seo-tablewrap">[\s\S]*?<\/table><\/div>)\s*/, (m, t) => `${t}\n  ${matters}`, 'table wrapper');
  sub(/(<h2 class="seo-h">Firm snapshots<\/h2>\s*<div class="seo-text">)[\s\S]*?(<\/div>)/, (_, a, b) => a + list.slice(0, 8).map(snapshot).join('') + b, 'snapshots');

  // the answer that quotes counts (in the page and in its structured data)
  html = html.replace(new RegExp(`LawDB currently lists \\d+ [^<"]*? firms? in ${cityRe}, ${provName}, out of \\d+ law firms? in the city across all practice areas\\. The average Google rating of these firms is [\\d.]+\\.`, 'g'),
    () => `LawDB currently lists ${s.n} ${sent} ${plural(s.n, 'firm', 'firms')} in ${esc(city)}, ${provName}, out of ${cityFirms.length} law ${plural(cityFirms.length, 'firm', 'firms')} in the city across all practice areas. The average Google rating of these firms is ${s.avg}.`);
  html = html.replace(new RegExp(`(How many [^<"]*? does LawDB list in ${cityRe}\\?)`, 'g'), (m) => m.replace(/How many [^<"]*? does/, `How many ${sent} ${plural(s.n, 'firm', 'firms')} does`));

  // other practice areas in the city, most firms first
  const counts = TYPES.filter((t) => t[0] !== key).map(([k, lab, sl]) => ({ k, lab, sl, n: cityFirms.filter((f) => (f.caseTypes || []).includes(k)).length })).filter((t) => t.n > 0).sort((a, b) => b.n - a.n);
  html = html.replace(new RegExp(`(<h2 class="seo-h">Other practice areas in ${cityRe}</h2><div class="seo-chips">)[\\s\\S]*?(</div>)`), (_, a, b) =>
    a + counts.map((t) => (pageExists(`${dir}/${t.sl}.html`) ? `<a class="seo-chip" href="/${dir}/${t.sl}">${t.lab} <span>${t.n}</span></a>` : `<span class="seo-chip off">${t.lab} <span>${t.n}</span></span>`)).join('') + b);

  // structured data: the firms in the list, and the date
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].find((m) => m[1].includes('"ItemList"'));
  if (ld) {
    const arr = JSON.parse(ld[1]);
    const il = arr.find((x) => x['@type'] === 'ItemList');
    if (il) il.itemListElement = list.map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: `https://lawdb.ca/firms/${f.slug}`, name: f.name }));
    html = html.replace(ld[0], () => `<script type="application/ld+json">\n${JSON.stringify(arr, null, 1)}\n</script>`);
  }

  return html;
}
