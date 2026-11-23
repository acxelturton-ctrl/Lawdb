// "By the kind of matter" on the city practice pages (scripts/lib/matters.mjs, put on the pages by scripts/practice-pages-core.mjs):
//   node --no-warnings scripts/test-matters.mjs
// A firm is in a row only because its own profile mentions the matter, the words are facts and never an opinion, and the pages carry the table.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadFirms, TYPES, ranked, PROV, BY_SLUG } from './practice-pages-core.mjs';
import { matterRows, matterFacts, matterSentences, mentions, MATTERS, MIN_ROWS, MAX_ROWS, PER_ROW } from './lib/matters.mjs';
import { checkOwnerText } from '../src/lib/content-rules.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the rules, on made-up firms
const mk = (n, about, extra = {}) => ({ slug: `f${n}`, name: `Firm ${n}`, city: 'Calgary', province: 'AB', rating: 4.5, count: 10 + n, about, ...extra });
const crim = MATTERS.criminal;
const re = (label) => crim.find((m) => m[0] === label)[1];
ok(mentions(['The firm defends impaired driving and drug charges.'], re('Impaired driving and roadside sanctions')), 'a sentence that mentions the matter puts the firm in the row');
ok(!mentions(['The firm does not handle impaired driving, and refers drug cases elsewhere.'], re('Impaired driving and roadside sanctions')) && !mentions(['It does not take drug cases.'], re('Drug offences')), 'a sentence that says the firm does not do it, or sends it elsewhere, does not');
ok(!mentions(['It defends sexual assault charges.'], re('Assault and other violent charges')) && mentions(['It defends sexual assault charges.'], re('Sexual offences')), 'sexual assault is a sexual offence, not an "assault" row');
ok(!mentions(['It defends drug-impaired driving charges.'], re('Drug offences')), 'drug-impaired driving is not a drug offence row');
const five = [
  mk(1, 'It defends impaired driving, assault and drug charges.'), mk(2, 'It defends impaired driving, assault and drug charges.'), mk(3, 'It defends impaired driving, assault and drug charges.'),
  mk(4, 'It defends impaired driving, assault and drug charges.'), mk(5, 'It defends impaired driving, assault and drug charges.'), mk(6, 'It defends impaired driving, assault and drug charges.'),
];
const rows = matterRows('criminal', five);
ok(rows.length === 3 && rows.every((r) => r.firms.length === PER_ROW && r.total === 6), `a table has a row for each kind of matter some firm mentions (at least ${MIN_ROWS}) and shows up to ${PER_ROW} firms of the ${'6'} that mention it`);
ok(new Set(rows.flatMap((r) => r.firms.map((x) => x.firm.slug))).size === 6, 'a firm already shown in an earlier row is passed over, so all six firms are seen across the table, not the same three');
ok(rows.every((r) => r.firms.every((x, i, a) => i === 0 || a[i - 1].firm.rating >= 0 && five.indexOf(a[i - 1].firm) < five.indexOf(x.firm))), 'inside a row the firms keep the order of the table of firms');
ok(matterRows('criminal', five.slice(0, 2).map((f) => ({ ...f, about: 'It defends impaired driving.' }))).length === 0, `a page whose firms mention fewer than ${MIN_ROWS} kinds of matter gets no table`);
ok(matterRows('nonsense', five).length === 0, 'a practice area with no list of matters gets no table');
const facts = matterFacts({ ...mk(1, ''), details: { founded: 2006, languages: ['English', 'French'] } }, { stored: { f1: [{ name: 'Ana Lee', slug: 'ana-lee', callYear: 2004 }, { name: 'Bo Chan', slug: 'bo-chan' }, { name: 'Cy Doe', slug: 'cy-doe' }] } });
ok(facts.join(' | ') === '4.5 from 11 Google reviews | Founded in 2006 | 3 lawyers listed | Works in English and French', 'the facts column holds the rating, when the firm was founded, the lawyers listed and the languages');
ok(matterFacts({ ...mk(1, ''), rating: 0, count: 0 })[0] === 'No Google rating yet', 'a firm with no rating says so');

// ---- every table, from the real data
const firms = loadFirms();
const ctx = { copy: JSON.parse(readFileSync('data/firm-copy.json', 'utf8')), details: JSON.parse(readFileSync('data/firm-details.json', 'utf8')), stored: JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8')) };
const EVAL = /\b(?:best|top|leading|premier|elite|expert|experts|expertise|specialist|specialists|specialize[sd]?|specializing|award[- ]winning|trusted|proven|aggressive|renowned|prestigious|exceptional|outstanding|skilled|experienced|highly|finest|foremost|recommended|reputable|successful|winning|great|excellent)\b/i;
let tables = 0, entries = 0, wrongFirm = [], notMentioned = [], tooMany = [], flagged = [], dup = [];
const asList = (key, code, city) => ranked(firms.filter((f) => f.province === code && f.city === city && (f.caseTypes || []).includes(key)));
const cities = new Set(firms.map((f) => `${f.province}|${f.city}`));
for (const [key] of TYPES) {
  for (const c of cities) {
    const [code, city] = c.split('|');
    const list = asList(key, code, city);
    if (!list.length) continue;
    const r = matterRows(key, list, ctx);
    if (!r.length) continue;
    tables++;
    if (r.length < MIN_ROWS || r.length > MAX_ROWS) tooMany.push(`${city} ${key}: ${r.length} rows`);
    const labels = new Set();
    for (const row of r) {
      if (labels.has(row.label)) dup.push(`${city} ${key}: ${row.label}`);
      labels.add(row.label);
      if (row.firms.length > PER_ROW || row.firms.length > row.total) tooMany.push(`${city} ${key} ${row.label}`);
      const re = MATTERS[key].find((m) => m[0] === row.label)[1];
      for (const x of row.firms) {
        entries++;
        if (!list.includes(x.firm)) wrongFirm.push(`${city} ${key}: ${x.firm.slug}`);
        if (!mentions(matterSentences(x.firm, ctx), re)) notMentioned.push(`${city} ${key} ${row.label}: ${x.firm.slug}`);
        const text = [row.label, ...matterFacts(x.firm, ctx), ...x.also].join('. ').split(x.firm.name).join(' ');
        let claim = false;
        try { checkOwnerText('matter', text); } catch { claim = true; }
        if (claim || EVAL.test(text)) flagged.push(`${city} ${key}: ${text}`);
      }
    }
  }
}
ok(tables > 100 && entries > 1000, `${tables} tables and ${entries} firm entries made from the real data`);
ok(wrongFirm.length === 0, `every firm in a row is one of the page's firms${wrongFirm.length ? ` (${wrongFirm.slice(0, 3).join(' | ')})` : ''}`);
ok(notMentioned.length === 0, `every firm in a row has a profile that mentions that kind of matter${notMentioned.length ? ` (${notMentioned.slice(0, 3).join(' | ')})` : ''}`);
ok(tooMany.length === 0 && dup.length === 0, `no table has too few or too many rows, no row too many firms, no row twice${tooMany.concat(dup).length ? ` (${tooMany.concat(dup).slice(0, 3).join(' | ')})` : ''}`);
ok(flagged.length === 0, `no word in any table is an opinion, a comparison or a restricted claim${flagged.length ? ` (${flagged.slice(0, 3).join(' | ')})` : ''}`);

// ---- the pages
let pages = 0, withBlock = 0, problems = [], mismatch = [];
for (const [dirName, code] of Object.entries(PROV)) {
  if (!existsSync(dirName)) continue;
  for (const d of readdirSync(dirName, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(`${dirName}/${d.name}/index.html`)) continue;
    const hm = readFileSync(`${dirName}/${d.name}/index.html`, 'utf8').match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (!hm) continue;
    const city = hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    for (const f of readdirSync(`${dirName}/${d.name}`)) {
      const type = BY_SLUG.get(f.replace(/\.html$/, ''));
      if (!type || !f.endsWith('.html')) continue;
      pages++;
      const file = `${dirName}/${d.name}/${f}`;
      const html = readFileSync(file, 'utf8');
      const m = html.match(/<!--matters-->([\s\S]*?)<!--\/matters-->/);
      const rows = matterRows(type[0], asList(type[0], code, city), ctx);
      if (!!m !== rows.length > 0) mismatch.push(`${file}: ${m ? 'has a table the data does not make' : 'lacks the table the data makes'}`);
      if (!m) continue;
      withBlock++;
      const block = m[1];
      const tbodies = (block.match(/<tbody>/g) || []).length;
      if (tbodies !== rows.length) problems.push(`${file}: ${tbodies} rows on the page, ${rows.length} in the data`);
      if ((html.match(/<table class="seo-table"/g) || []).length !== 1) problems.push(`${file}: the city page script expects exactly one table.seo-table`);
      if (/seo-table/.test(block)) problems.push(`${file}: the matter table must not use the firm table's class (city-pages.js reads it)`);
      if (!(html.indexOf('class="seo-table"') < html.indexOf('<!--matters-->'))) problems.push(`${file}: the table comes after the table of firms`);
      if (!/not a recommendation or a ranking/.test(block) || !/Check any lawyer with the /.test(block)) problems.push(`${file}: the note is missing`);
      for (const t of block.matchAll(/href="tel:\+1(\d{10})"/g)) if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(t[1])) problems.push(`${file}: bad phone ${t[1]}`);
      for (const l of block.matchAll(/href="\/firms\/([a-z0-9-]+)"/g)) if (!firms.some((x) => x.slug === l[1])) problems.push(`${file}: unknown firm ${l[1]}`);
    }
  }
}
ok(withBlock > 100 && mismatch.length === 0, `${withBlock} of ${pages} city practice pages carry the table, exactly the ones the data makes one for (refresh-practice-pages keeps them current)${mismatch.length ? ` (${mismatch.slice(0, 3).join(' | ')})` : ''}`);
ok(problems.length === 0, `every table on a page is placed and worded as it should be${problems.length ? ` (${problems.slice(0, 3).join(' | ')})` : ''}`);

console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
