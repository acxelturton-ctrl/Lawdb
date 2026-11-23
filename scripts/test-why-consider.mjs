// "Why people consider ..." (src/lib/why-consider.js) and the compare table of a firm's lawyers, on the firm, Lawyers and lawyer pages:
//   node --no-warnings scripts/test-why-consider.mjs
// Every reason is a fact from the page, never an opinion: no superlatives, no comparison, no restricted claim, for every firm and lawyer in the data.
import { readFileSync, readdirSync } from 'node:fs';
import { whyFirm, whyLawyer, compareLawyers, MIN_REASONS } from '../src/lib/why-consider.js';
import { lawyersOf, lawyerHasPage } from '../src/lib/lawyers.js';
import { renderFirmPage } from '../src/render/firm-page.js';
import { checkOwnerText } from '../src/lib/content-rules.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the rules, on made-up data
const firm = { name: 'Example Law', city: 'Calgary', province: 'AB', tags: ['Criminal Defence', 'Family Law'], rating: 4.8, count: 120 };
const lawyer = { name: 'Ana Lee', slug: 'ana-lee', title: 'Partner', callYear: 2008, languages: ['English', 'French'], education: ['J.D., University of Alberta'] };
const r = whyLawyer(lawyer, firm, 'Alberta', { team: 5, thisYear: 2026 });
ok(r.includes('Partner at Example Law, in Calgary, Alberta.') && r.includes('Called to the bar in 2008, 18 years ago.') && r.includes('Works in English and French.') && r.includes('Education: J.D., University of Alberta.'), 'a lawyer\'s reasons are made of the facts: role, year called, languages, education');
ok(r.includes('The firm focuses on criminal defence and family law.') && r.includes('One of 5 lawyers listed at Example Law.') && r.includes('Example Law is rated 4.8 out of 5 from 120 Google reviews.'), 'and of the firm: what it focuses on, the team and its Google rating');
ok(whyLawyer({ name: 'Bo Chan', slug: 'bo-chan' }, { name: 'X', city: 'Y', tags: [] }, 'Alberta').length === 0, 'a lawyer with almost nothing to say gets no list (a list needs at least ' + MIN_REASONS + ' reasons)');
ok(!whyLawyer({ ...lawyer, callYear: 2025 }, firm, 'Alberta', { thisYear: 2026 }).join(' ').includes('years ago'), 'the year called is not turned into "years ago" for someone called last year');
const wf = whyFirm({ ...firm, details: { founded: 1999, languages: ['English', 'Punjabi'], serving: ['Calgary', 'Airdrie'] } }, [], 'Alberta');
ok(wf.includes('Founded in 1999.') && wf.includes('Works in English and Punjabi.') && wf.includes('Serves Calgary and Airdrie.') && wf.includes('Rated 4.8 out of 5 from 120 Google reviews.'), 'a firm\'s reasons: when it was founded, languages, places served, rating');
ok(whyFirm(firm, [], 'Alberta').length === 0, 'a firm with only the facts the top of the page already shows (focus, rating, place) gets no list, so nothing is said twice');
ok(whyFirm({ ...firm, tags: ['General Practice'], details: { founded: 1990 } }, [], 'Alberta').includes('The firm has a general practice.'), 'a general practice says so');
const cmp = compareLawyers([lawyer, { name: 'Cy Doe', slug: 'cy-doe', title: 'Associate', callYear: 2019 }, { name: 'Di Poe', slug: 'di-poe' }]);
ok(cmp && cmp.columns.map((c) => c.key).join() === 'role,called,languages,education' && cmp.rows.length === 3, 'the compare table has a column for each kind of fact a lawyer has, and a row for every lawyer');
ok(compareLawyers([{ name: 'A B', slug: 'a-b' }, { name: 'C D', slug: 'c-d' }]) === null && compareLawyers([lawyer]) === null, 'no table for bare names or a single lawyer');

// ---- every firm and lawyer in the data
const stored = JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8'));
const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
for (const f of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x))) all.push(...JSON.parse(readFileSync(`data/${f}`, 'utf8')));
const details = JSON.parse(readFileSync('data/firm-details.json', 'utf8'));
const EVAL = /\b(?:best|top|leading|premier|elite|expert|experts|expertise|specialist|specialists|specialize[sd]?|specializing|award[- ]winning|trusted|proven|aggressive|renowned|prestigious|exceptional|outstanding|skilled|experienced|highly|finest|foremost|recommended|reputable|successful|winning|great|excellent)\b/i;
let lists = 0, bullets = 0, flagged = [];
const PROV = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island' };
for (const f0 of all) {
  const f = { ...f0, lawyers: stored[f0.slug], details: details[f0.slug] || f0.details };
  const prov = PROV[f.province] || f.province;
  const lw = lawyersOf(f);
  const sets = [whyFirm(f, lw, prov), ...lw.filter(lawyerHasPage).map((l) => whyLawyer(l, f, prov, { team: lw.length }))];
  for (const set of sets) {
    if (set.length) lists++;
    for (const b of set) {
      bullets++;
      // the firm's and the lawyers' own names are not ours to judge (a firm may be called "Top Law")
      const text = [f.name, ...lw.map((x) => x.name)].reduce((t, n) => t.split(n).join(' '), b);
      let claim = false;
      try { checkOwnerText('reason', text); } catch { claim = true; }
      if (claim || EVAL.test(text)) flagged.push(`${f.slug}: ${b}`);
    }
  }
}
ok(lists > 400 && bullets > 1500, `${lists} lists and ${bullets} reasons made from the real data`);
ok(flagged.length === 0, `no reason is an opinion, a comparison or a restricted claim${flagged.length ? ` (${flagged.slice(0, 3).join(' | ')})` : ''}`);

// ---- the pages
const PILOT = 'mincher-koeman-law-chambers-calgary';
const pilot = all.find((x) => x.slug === PILOT);
const copy = JSON.parse(readFileSync('data/firm-copy.json', 'utf8'));
const withLawyers = { ...pilot, about: copy[PILOT], lawyers: stored[PILOT], details: details[PILOT] || pilot.details };
const render = (view = null) => renderFirmPage({ firm: withLawyers, hours: null, images: [], posts: [], nearby: [], locations: [], origin: 'https://lawdb.ca', view });
const lw = lawyersOf(withLawyers);
const page = lw.find((l) => lawyerHasPage(l));
const tab = render({ tab: 'lawyers' }), one = render({ tab: 'lawyer', lawyer: page.slug }), overview = render();
ok(/<table class="lw-compare"><caption>Compare the lawyers at /.test(tab) && (tab.match(/<tr><th scope="row"/g) || []).length === lw.length && /<td data-label="/.test(tab), `the Lawyers page has the compare table with a row for each of the ${lw.length} lawyers, and each cell knows its label for a phone`);
ok(tab.indexOf('class="lw-compare"') < tab.indexOf('class="lw-grid"'), 'the table comes before the cards');
ok(/<section class="pf-why" aria-label="Why people consider [^"]+"><h2>Why people consider [^<]+<\/h2><ul><li>/.test(one) && /not a recommendation or a ranking/.test(one), 'a lawyer\'s page has the "Why people consider" list and the note that it is not a recommendation');
ok(one.includes('Request a consultation') && !one.includes('>Message ') && one.indexOf('class="pf-why"') < one.indexOf('class="lp-facts"'), 'the lawyer page says Request a consultation (not Message) and the list comes before the facts');
ok(!/class="pf-why"/.test(tab) && (!/class="pf-why"/.test(overview) || /Why people consider [^<]+<\/h2><ul><li>/.test(overview)), 'the Lawyers page has no list; the Overview has one only when the firm has facts to put in it');

console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
