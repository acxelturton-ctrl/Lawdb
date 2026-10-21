// Builds the city practice-area pages that do not exist yet (<province>/<city>/<practice>-lawyers.html) for cities that have enough firms in that
// practice area (MIN_FIRMS, default 4). A new page is a copy of an existing city page of the same practice: from the same province when there is one,
// so it says exactly what the existing pages say (the regulator, the limitation sentence, the related guides); from another province otherwise, with
// the province's own regulator, legal aid and limitation sentence swapped in and any sentence that is only true of the first province left out.
// refresh-practice-pages.mjs then fills in the numbers, the table and the snapshots, and apply-city-guides.mjs adds the sourced local guide.
//   node scripts/build-city-practice-pages.mjs              writes the missing pages
//   node scripts/build-city-practice-pages.mjs --check      fails if a page that should exist does not
//   node scripts/build-city-practice-pages.mjs --validate   rebuilds every EXISTING city page from another city's page and reports what differs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { PROV, TYPES, esc, loadFirms, refreshHtml } from './practice-pages-core.mjs';

const MODE = process.argv.includes('--check') ? 'check' : process.argv.includes('--validate') ? 'validate' : 'write';
const MIN_FIRMS = Number(process.env.MIN_FIRMS || 4);
const firms = loadFirms();
const TODAY = process.env.REFRESH_DATE || new Date().toISOString().slice(0, 10);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apos = (s) => s.replace(/'/g, '&#x27;');

// What differs from one province to the next on these pages. Each phrase is the one the existing pages use.
const PROVINCE = {
  ON: { name: 'Ontario', dir: 'ontario', regulator: 'Law Society of Ontario', legalAid: 'Legal Aid Ontario', limitation: "Ontario's Limitations Act, 2002 sets a basic two-year limitation period for most civil claims, with important exceptions." },
  AB: { name: 'Alberta', dir: 'alberta', regulator: 'Law Society of Alberta', legalAid: 'Legal Aid Alberta', limitation: "Alberta's Limitations Act sets a basic two-year limitation period for most claims, with exceptions." },
  BC: { name: 'British Columbia', dir: 'british-columbia', regulator: 'Law Society of British Columbia', legalAid: 'Legal Aid BC', limitation: "British Columbia's Limitation Act sets a basic two-year limitation period for most claims, with exceptions." },
  MB: { name: 'Manitoba', dir: 'manitoba', regulator: 'Law Society of Manitoba', legalAid: 'Legal Aid Manitoba', limitation: "Manitoba's Limitation of Actions Act sets a basic two-year limitation period for most claims, with exceptions." },
  QC: { name: 'Quebec', dir: 'quebec', regulator: 'Barreau du Québec', legalAid: 'the Commission des services juridiques (legal aid)', limitation: "Quebec's Civil Code sets a general three-year prescription period for most personal claims, with exceptions." },
};
const PREFERRED_SOURCE = ['ON', 'AB', 'MB', 'BC', 'QC'];

// ---- the cities and their existing pages
const cities = [];
for (const [dirName, code] of Object.entries(PROV)) {
  for (const d of readdirSync(dirName, { withFileTypes: true })) {
    const dir = `${dirName}/${d.name}`;
    if (!d.isDirectory() || !existsSync(`${dir}/index.html`)) continue;
    const hub = readFileSync(`${dir}/index.html`, 'utf8');
    const hm = hub.match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (!hm) continue;
    const lede = hub.match(/<p class="seo-lede">([\s\S]*?)<\/p>/);
    const tail = lede ? lede[1].replace(/^[\s\S]*?\(\d[\d.]* stars from [\d,]+ reviews\)\.\s*/, '').replace(/^\d+ firms? (?:is a Featured partner and is|are Featured partners and are) listed first\.\s*/, '').replace(/\s*Several firms are located on .*$/s, '').trim() : '';
    const nearby = (hub.match(/<h3>Nearby cities<\/h3><div class="seo-chips">([\s\S]*?)<\/div>/) || [])[1] || '';
    const related = (hub.match(/<h2 class="seo-h">Related guides<\/h2>\s*(<ul class="seo-ul">[\s\S]*?<\/ul>)/) || [])[1] || '';
    cities.push({ dirName, citySlug: d.name, dir, city: hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&'), code, tail, nearby, related });
  }
}
const isStandard = (h) => h.includes('Firm snapshots') && h.includes('seo-stats') && /<div class="seo-text"><p>LawDB lists /.test(h);
const existingPages = (slug) => cities.filter((c) => existsSync(`${c.dir}/${slug}.html`) && isStandard(readFileSync(`${c.dir}/${slug}.html`, 'utf8')));

export function cloneFor(target, tpl, slug, pageExists) {
  const T = PROVINCE[tpl.code], P = PROVINCE[target.code];
  const cross = tpl.code !== target.code;
  let html = readFileSync(`${tpl.dir}/${slug}.html`, 'utf8');
  html = html.replace(/<!--city-guide-->[\s\S]*?<!--\/city-guide-->\s*/g, ''); // the sourced guide is applied afterwards, from its own data
  const cut = html.indexOf('<footer'); // the site footer is the same on every page and is never touched
  let foot = cut >= 0 ? html.slice(cut) : '';
  html = cut >= 0 ? html.slice(0, cut) : html;
  // nearby cities and related guides belong to the city: take them from the target city's own page, linking each nearby city's page for this practice where it exists
  html = html.replace(/<h2 class="seo-h">Nearby cities<\/h2><div class="seo-chips">[\s\S]*?<\/div>\s*/, '');
  html = html.replace(/<h2 class="seo-h">Related guides<\/h2>\s*<ul class="seo-ul">[\s\S]*?<\/ul>\s*/, '');
  const chips = target.nearby.replace(/href="\.\.\/\.\.\/([a-z-]+\/[a-z0-9-]+)\/"/g, (m, d) => (pageExists(`${d}/${slug}.html`) ? `href="/${d}/${slug}"` : m));
  const block = `${chips ? `<h2 class="seo-h">Nearby cities</h2><div class="seo-chips">${chips}</div>\n  ` : ''}`;
  const rel = target.related ? `\n  <h2 class="seo-h">Related guides</h2>${target.related}` : '';
  html = html.replace(/(<div class="seo-chips" style="margin-top:14px"><a class="seo-chip" href="[^"]*">All law firms in [^<]*<\/a><\/div>)/, (m) => `${block}${m}${rel}`);

  // addresses and names: city first (longest forms first), then the province
  const swaps = [];
  swaps.push([`${tpl.dirName}/${tpl.citySlug}/`, `${target.dirName}/${target.citySlug}/`]);
  swaps.push([`../../${tpl.dirName}/`, `../../${target.dirName}/`]);
  const names = [[apos(tpl.city), apos(target.city)], [tpl.city, target.city]];
  for (const [a, b] of names) {
    swaps.push([`${a}, ${T.name}`, `${b}, ${P.name}`], [`${a}, ${tpl.code}`, `${b}, ${target.code}`]);
  }
  for (const [a, b] of swaps) html = html.split(a).join(b);
  for (const [a, b] of names) html = html.split(a).join(esc(b) === b ? b : esc(b));
  if (cross) {
    // regulator, legal aid and the limitation sentence first (they contain the first province's name), then the name itself
    html = html.split(T.regulator).join(P.regulator).split(T.legalAid).join(P.legalAid);
    const lim = new RegExp(`${reEsc(apos(T.name))}(?:&#x27;|')s [^<]*?exceptions\\.`, 'g');
    html = html.replace(lim, () => apos(P.limitation));
    html = html.split(`${T.name}'s`).join(`${P.name}'s`).split(apos(`${T.name}'s`)).join(apos(`${P.name}'s`));
    html = html.replace(new RegExp(`\\b${reEsc(T.name)}\\b`, 'g'), P.name);
    // anything else in "what to know" belongs to the first province: keep the limitation sentence, the legal-aid sentence and the federal immigration sentence only
    html = html.replace(/(<h2 class="seo-h">[^<]*: what to know<\/h2>\s*<div class="seo-text">)([\s\S]*?)(<\/div>)/, (m, a, body, b) => {
      const ps = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => x[1]);
      const keep = ps.filter((p) => /limitation|prescription|If cost is a concern|Immigration applications are decided/.test(p) && !/accident benefits|ICBC|land transfer|transfer tax|French|Employment Standards|Civil disputes in/.test(p));
      return keep.length ? `${a}${keep.map((p) => `<p>${p}</p>`).join('')}${b}` : '';
    });
  }
  // the opening paragraph's local tail comes from the target city's own page
  html = html.replace(/(<div class="seo-text"><p>LawDB lists [\s\S]*?\(\d[\d.]* stars from [\d,]+ reviews\)\.)[\s\S]*?(<\/p><\/div>)/, (_, a, b) => `${a} ${target.tail}${b}`.replace(/\. <\/p>/, '.</p>').replace(/ <\/p>/, '</p>'));
  return html + foot;
}

function pickTemplate(target, slug) {
  const cands = existingPages(slug).filter((c) => !(c.dir === target.dir));
  if (!cands.length) return null;
  const same = cands.filter((c) => c.code === target.code);
  const pool = same.length ? same : cands.filter((c) => c.code === PREFERRED_SOURCE.find((p) => cands.some((x) => x.code === p)));
  // the biggest page of that kind is the most complete template
  return pool.sort((a, b) => b.dir.length - a.dir.length || a.dir.localeCompare(b.dir))[0];
}

// the pages this run will create, so that links to them can be written before they exist
const planned = new Set();
for (const t of cities) for (const [key, , slug] of TYPES) {
  const n = firms.filter((f) => f.province === t.code && f.city === t.city && (f.caseTypes || []).includes(key)).length;
  if (!existsSync(`${t.dir}/${slug}.html`) && n >= MIN_FIRMS && existingPages(slug).length) planned.add(`${t.dir}/${slug}.html`);
}
const willExist = (p) => existsSync(p) || planned.has(p);

let wrote = 0, missing = 0, compared = 0, diffs = 0;
const kinds = new Map();
for (const target of cities) {
  for (const type of TYPES) {
    const [key, , slug] = type;
    const file = `${target.dir}/${slug}.html`;
    const n = firms.filter((f) => f.province === target.code && f.city === target.city && (f.caseTypes || []).includes(key)).length;
    const exists = existsSync(file);
    if (MODE === 'validate') {
      if (!exists || !isStandard(readFileSync(file, 'utf8'))) continue;
      const tpl = pickTemplate(target, slug);
      if (!tpl) continue;
      const built = refreshHtml(cloneFor(target, tpl, slug, willExist), { ...target, provName: PROVINCE[target.code].name, type, file }, firms, willExist);
      if (built === null) continue;
      const real = refreshHtml(readFileSync(file, 'utf8').replace(/<!--city-guide-->[\s\S]*?<!--\/city-guide-->\s*/g, ''), { ...target, provName: PROVINCE[target.code].name, type, file }, firms, willExist);
      compared++;
      const norm = (h) => h.replace(/"dateModified": "[^"]*"/, '').split(/(?<=>)\s*(?=<)/).filter((l) => l.trim());
      const a = norm(built), b = norm(real), sa = new Set(a), sb = new Set(b);
      const only = [...a.filter((l) => !sb.has(l)).map((l) => `BUILT[${tpl.code}->${target.code}] ` + l), ...b.filter((l) => !sa.has(l)).map((l) => `REAL [${tpl.code}->${target.code}] ` + l)];
      if (only.length) { diffs++; for (const l of only) kinds.set(l.slice(0, 190), (kinds.get(l.slice(0, 190)) || 0) + 1); }
      continue;
    }
    if (exists || n < MIN_FIRMS) continue;
    const tpl = pickTemplate(target, slug);
    if (!tpl) { console.error(`no template page for ${file}`); missing++; continue; }
    if (MODE === 'check') { console.error('page should exist:', file, `(${n} firms)`); missing++; continue; }
    const html = refreshHtml(cloneFor(target, tpl, slug, willExist), { ...target, provName: PROVINCE[target.code].name, type, file }, firms, willExist);
    writeFileSync(file, html.replace(/"dateModified": "[^"]*"/, `"dateModified": "${TODAY}"`));
    wrote++;
  }
}
if (MODE === 'validate') {
  console.log(`${compared} existing city pages rebuilt from another city's page; ${diffs} differ`);
  for (const [l, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(String(n).padStart(3), l);
} else if (MODE === 'check') {
  if (missing) process.exit(1);
  console.log('every city practice page that should exist does');
} else { console.log(`${wrote} city practice pages written${missing ? `, ${missing} without a template` : ''}`); if (missing) process.exit(1); }
