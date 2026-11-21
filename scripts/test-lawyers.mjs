// The Lawyers page of a firm (/firms/<slug>/lawyers) and the page of a lawyer who has enough to say (/firms/<slug>/lawyers/<lawyer>):
//   node --no-warnings scripts/test-lawyers.mjs
// Checks the clean-up rules (src/lib/lawyers.js), the pages (src/render/firm-page.js), the sitemap (src/routes/firm-sitemap.js) and the stored data
// (data/firm-lawyers.json): no thin or empty pages, no billing rates or testimonial text as a title, nothing shown without being checked, a unique title,
// description and canonical for every page, valid breadcrumb and person markup, and every address in the sitemap.
import { readFileSync, readdirSync } from 'node:fs';
import { renderFirmPage } from '../src/render/firm-page.js';
import { cleanLawyers, cleanTitle, lawyersOf, lawyerHasPage, lawyerSlug, MIN_FIRM_LAWYERS } from '../src/lib/lawyers.js';
import { firmSitemap } from '../src/routes/firm-sitemap.js';
import { firmPage } from '../src/routes/firm-page.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the clean-up rules ----
const T = (raw, want) => { const got = cleanTitle(raw); const text = got.drop ? '(dropped)' : got.junk ? '(junk)' : got.title; ok(text === want, `title ${JSON.stringify(raw)} -> ${JSON.stringify(want)}${text === want ? '' : ' (got ' + JSON.stringify(text) + ')'}`); };
T('Associate, $325.00/hr', 'Associate');
T('Senior Associate, $450.00/hr', 'Senior Associate');
T('Founding Partner, B.A., Ll.B.', 'Founding Partner');
T('Associate - B.S.B.A., Ll.B.', 'Associate');
T('K.C, Criminal Lawyer', 'Criminal Lawyer');
T('Barrister & Solicitor, and Notary', 'Barrister & Solicitor');
T('Counsel at Mickelson, Whysall & Moore Law Group', 'Counsel');
T('Wills and Estates, Real Estate and Corporate Lawyer: Edmonton', 'Wills and Estates, Real Estate and Corporate Lawyer');
T('Sr. Family Lawyer', 'Senior Family Lawyer');
T('(Lawyer, Mediator, Collaborative Practitioner)', 'Lawyer, Mediator, Collaborative Practitioner');
T('Avocat, associé', 'Avocat, associé');
T('Partner', 'Partner');
T('Retired Partner', '(dropped)');
T('Lawyer (Retired)', '(dropped)');
T('Non-Lawyer Partner/Paralegal', '(dropped)');
T('Partner, Notary', '(dropped)');
T('Steve and Dave are great. Highly recommended lawyer group.', '(junk)');
T('Our TDS construction lawyer really steps in to help guide us.', '(junk)');
T('Congratulations to our newly appointed lawyer', '(junk)');
T('Chief of Snacks', '');
T('Lawyer Spotlight', '');
T('Future Lawyer Canada', '');
T('Customized will drafted by a lawyer', '');
T('Jagsharan Mahal, an esteemed lawyer at', '');
T('Director of HR', '');
T('Founder & CEO', '');
T('Senior Immigration Lawyer, Compliance Officer', 'Senior Immigration Lawyer');
T('Associate, In Loving Memory', '(dropped)');
T('Partner (Not in active practice)', '(dropped)');
T('Lawyer (No longer practices in Ontario)', '(dropped)');
T('Associate, currently on leave', '(dropped)');
T('Former Partner', '(dropped)');
T('Avocate \u00e0 la retraite', '(dropped)');
T('Avocate s\u00c3\u00a9nior', 'Avocate s\u00e9nior');
T('Real Estate Attorney\u200b', 'Real Estate Attorney');


const base = { name: 'Jane Q. Doe', title: 'Partner', callYear: 2005, languages: ['English', 'French'], linkedin: 'https://www.linkedin.com/in/jane-doe-123/?trk=x', site: 'https://firm.example/jane', photo: 'https://firm.example/jane.jpg' };
const one = (over) => cleanLawyers([{ ...base, ...over }])[0];
ok(one({}).slug === 'jane-q-doe' && one({}).linkedin === 'https://www.linkedin.com/in/jane-doe-123/', 'a good entry keeps its facts; the LinkedIn address loses its tracking part');
ok(!('photo' in one({})) && one({ photoConfirmed: true }).photo === base.photo, 'a picture is kept only once it is confirmed');
ok(!one({ name: 'Jane <b>Doe' }) && !one({ name: 'jane@firm.example' }) && !one({ name: 'Jane Doe 2' }) && !one({ name: 'Jack Maendel CEO Ecopoxy' }) && !one({ name: 'Latest' }), 'names with markup, an address, a figure, a job abbreviation or a single word are dropped');
ok(one({ name: 'Sara J. Premi B. Comm' }).name === 'Sara J. Premi' && one({ name: 'Erica L. Bush B' }).name === 'Erica L. Bush', 'degrees printed after a name are removed');
ok(cleanLawyers([base, { ...base }, { ...base, name: 'Jane  Q.  Doe' }]).length === 1, 'the same person twice is one entry');
ok(!one({ linkedin: 'https://evil.example/in/x' }).linkedin && !one({ linkedin: 'javascript:alert(1)' }).linkedin && !one({ site: 'http://firm.example/x' }).site, 'a LinkedIn address must be linkedin.com/in or /pub, and the lawyer\'s page https');
ok(!('callYear' in one({ callYear: 1899 })) && !('callYear' in one({ callYear: 2999 })) && !('title' in one({ title: 'Best Lawyer in Canada' })), 'an impossible year and a title with an advertising claim are left out');
ok(cleanLawyers([{ ...base, title: 'Retired Partner' }]).length === 0, 'a retired lawyer is not listed');
ok(one({ name: 'Erin Levitsky', title: 'Erin Levitsky / Associate' }).title === 'Associate' && one({ name: 'Elizabeth Long', title: 'Elizabeth Long \\ Partner' }).title === 'Partner', 'a title that repeats the lawyer\'s own name keeps only the role');
ok(one({ education: ['LL.B, University of Windsor 1985 \u200b B'] }).education[0] === 'LL.B, University of Windsor 1985', 'invisible characters and a stray letter at the end of a school are removed');
ok(cleanLawyers([{ name: 'Andrea Mannell', title: 'Congratulations to our newly appointed lawyer' }]).length === 0 && cleanLawyers([{ ...base, name: 'Andrea Mannell', title: 'Congratulations to our newly appointed lawyer' }]).length === 1, 'a sentence as a title means a news line was read: the person stays only with other facts on record');
ok(cleanLawyers(Array.from({ length: 300 }, (_, i) => ({ ...base, name: `Person ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}son` }))).length <= 120, 'no more than 120 lawyers per firm');
ok(lawyerSlug('Renée O’Brien-Smith') === 'renee-o-brien-smith', 'slugs are plain lower case');

const two = [{ name: 'Ann Lee', title: 'Partner' }, { name: 'Bo Chan', title: 'Associate', callYear: 2015, languages: ['French'] }];
ok(lawyersOf({ lawyers: two }).length === 2 && lawyersOf({ lawyers: [two[0]] }).length === 0 && lawyersOf({ lawyers: two, lawyersOff: true }).length === 0 && lawyersOf({}).length === 0 && MIN_FIRM_LAWYERS === 2, 'a firm needs two lawyers to show any; lawyersOff hides them all');
ok(!lawyerHasPage(cleanLawyers(two)[0]) && lawyerHasPage(cleanLawyers(two)[1]) && !lawyerHasPage({ name: 'X Y', callYear: 2000, languages: ['French'] }) && !lawyerHasPage({ name: 'X Y', title: 'Partner', callYear: 2000 }), 'a lawyer has a page only with a title and two more facts');

// ---- the stored data ----
const stored = JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8'));
let people = 0, dirty = 0;
for (const list of Object.values(stored)) { people += list.length; const c = cleanLawyers(list.map((l) => ({ ...l, photoConfirmed: true }))); if (JSON.stringify(cleanLawyers(c.map((l) => ({ ...l, photoConfirmed: true })))) !== JSON.stringify(c)) dirty++; }
ok(people > 1500 && dirty === 0, `${people} stored lawyers: cleaning twice gives the same result`);
const sql = readFileSync('db/lawyers-updates.sql', 'utf8');
ok(!/\$\d|\/hr|[Rr]etired|"photoConfirmed":true/.test(sql), 'the update file has no billing rate, no "retired" and no confirmed picture');

// ---- the pages ----
const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
for (const f of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x))) all.push(...JSON.parse(readFileSync(`data/${f}`, 'utf8')));
const copy = JSON.parse(readFileSync('data/firm-copy.json', 'utf8'));
const PILOT = 'mincher-koeman-law-chambers-calgary';
const pilot = all.find((x) => x.slug === PILOT);
const withLawyers = { ...pilot, about: copy[PILOT], lawyers: stored[PILOT] };
const render = (firm, view = null) => renderFirmPage({ firm, hours: null, images: [], posts: [], nearby: all.filter((x) => x.city === pilot.city && x.slug !== firm.slug).slice(0, 3), locations: [], origin: 'https://lawdb.ca', view });
const parts = (html) => ({
  title: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '',
  desc: ((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  canon: (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '',
  h1: (html.match(/<h1[ >]/g) || []).length,
  robots: (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || '',
  ld: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }),
});
const lw = lawyersOf(withLawyers);
const pageWorthy = lw.find((l) => lawyerHasPage(l));
ok(lw.length >= 4 && !!pageWorthy, `pilot ${PILOT}: ${lw.length} lawyers, ${lw.filter(lawyerHasPage).length} with a page of their own`);
const views = { overview: render(withLawyers), lawyers: render(withLawyers, { tab: 'lawyers' }), lawyer: render(withLawyers, { tab: 'lawyer', lawyer: pageWorthy.slug }) };
const p = Object.fromEntries(Object.entries(views).map(([k, h]) => [k, parts(h)]));
const root = `https://lawdb.ca/firms/${PILOT}`;
ok(p.overview.canon === root && p.lawyers.canon === `${root}/lawyers` && p.lawyer.canon === `${root}/lawyers/${pageWorthy.slug}`, 'every page is its own canonical');
ok(new Set(Object.values(p).map((x) => x.title)).size === 3 && new Set(Object.values(p).map((x) => x.desc)).size === 3, 'titles and descriptions are all different');
ok(p.lawyers.title === `${pilot.name} – Lawyers in ${pilot.city} | LawDB` && p.lawyer.title === `${pageWorthy.name} – ${pageWorthy.title} at ${pilot.name} | LawDB`, `titles: "${p.lawyers.title}" and "${p.lawyer.title}"`);
ok(Object.values(p).every((x) => x.h1 === 1 && x.title.length <= 100 && x.desc.length >= 60 && x.desc.length <= 160), 'one h1 per page; titles and descriptions of a sensible length');
ok(Object.values(p).every((x) => x.ld.length >= 2 && x.ld.every(Boolean)), 'the markup on every page is valid JSON');
const ldOf = (x, type) => x.ld.find((j) => j && j['@type'] === type);
ok(!!ldOf(p.overview, 'LegalService') && !!ldOf(p.lawyers, 'LegalService') && !ldOf(p.lawyer, 'LegalService') && ldOf(p.lawyer, 'Person')?.name === pageWorthy.name, 'LegalService on the firm pages, a Person on the lawyer page');
ok((ldOf(p.lawyers, 'LegalService').employee || []).length === lw.length && ldOf(p.lawyers, 'LegalService').employee.every((e) => e['@type'] === 'Person' && e.name), 'the Lawyers page names every lawyer in its markup');
ok(ldOf(p.lawyer, 'Person').worksFor?.name === pilot.name && (!pageWorthy.linkedin || ldOf(p.lawyer, 'Person').sameAs.includes(pageWorthy.linkedin)), 'the lawyer markup says where they work and links their LinkedIn when known');
const crumbs = (x) => (ldOf(x, 'BreadcrumbList')?.itemListElement || []);
ok(crumbs(p.overview).length === 5 && crumbs(p.lawyers).length === 6 && crumbs(p.lawyer).length === 7 && crumbs(p.lawyer).every((c, i) => c.position === i + 1 && c.name) && crumbs(p.lawyer).at(-1).name === pageWorthy.name && crumbs(p.lawyers).at(-1).name === 'Lawyers', 'breadcrumbs: Home > Country > Province > City > Firm > Lawyers > Lawyer');
ok(crumbs(p.lawyer).slice(0, -1).every((c) => /^https:\/\/lawdb\.ca\//.test(c.item)), 'every breadcrumb but the last links to a page');
const tabs = (h) => (h.match(/<nav class="pf-tabs"[\s\S]*?<\/nav>/) || [''])[0];
ok(Object.values(views).every((h) => /<a href="\/firms\/[^"]+">Overview<\/a>|<a href="\/firms\/[^"]+" aria-current="page">Overview<\/a>/.test(tabs(h)) && /href="\/firms\/[^"]+\/lawyers"/.test(tabs(h))), 'the tab bar is made of plain links on every page');
ok(/aria-current="page">Overview/.test(tabs(views.overview)) && /aria-current="page">Lawyers/.test(tabs(views.lawyers)) && /aria-current="page">Lawyers/.test(tabs(views.lawyer)), 'the open tab is marked');
ok(views.overview.includes(`href="/firms/${PILOT}/lawyers"`) && views.lawyer.includes(`href="/firms/${PILOT}/lawyers"`) && views.lawyer.includes(`href="/firms/${PILOT}"`), 'the Overview links to the Lawyers page; a lawyer page links back to the firm and to all lawyers');
ok(lw.every((l) => views.lawyers.includes(l.name)) && lw.filter(lawyerHasPage).every((l) => views.lawyers.includes(`href="/firms/${PILOT}/lawyers/${l.slug}"`)) && lw.filter((l) => !lawyerHasPage(l)).every((l) => !views.lawyers.includes(`/lawyers/${l.slug}"`)), 'the Lawyers page lists everyone and links only the lawyers who have a page');
ok(!/(?:href|src)="\.\.\//.test(views.lawyers) && !/(?:href|src)="\.\.\//.test(views.lawyer), 'no relative "../" links on the nested pages');
ok(!/<img[^>]+class="[^"]*lw-av[^"]*"[^>]*src=/.test(views.lawyers) && !views.lawyers.includes('firm.example') && !/<img[^>]*(?:photo|headshot)/i.test(views.lawyer), 'no lawyer picture on any page until pictures are confirmed');
const confirmed = render({ ...withLawyers, lawyers: stored[PILOT].map((l) => ({ ...l, photoConfirmed: true })) }, { tab: 'lawyers' });
ok(/<img[^>]+src="https:\/\//.test(confirmed.slice(confirmed.indexOf('lw-grid'))), 'a confirmed picture is shown');
ok(!/\$\s?\d[\d,.]*\s*(\/|per)\s*h/i.test(views.lawyers + views.lawyer), 'no billing rate on a lawyer page');

// pages that must not exist
ok(render(withLawyers, { tab: 'lawyer', lawyer: 'nobody-here' }) === null, 'a lawyer who is not listed has no page');
const nopage = lw.find((l) => !lawyerHasPage(l));
ok(!nopage || render(withLawyers, { tab: 'lawyer', lawyer: nopage.slug }) === null, 'a lawyer with nothing but a name has no page of their own');
const one1 = { ...withLawyers, lawyers: [stored[PILOT][0]] };
ok(render(one1, { tab: 'lawyers' }) === null && !tabs(render(one1)) && !render(one1).includes('/lawyers'), 'a firm with one lawyer has no Lawyers page, no tab bar and no link to one');
const off = { ...withLawyers, lawyersOff: true };
ok(render(off, { tab: 'lawyers' }) === null && !tabs(render(off)), 'a firm that switched its lawyers off has none');
ok(render({ ...pilot, about: copy[PILOT] }, { tab: 'lawyers' }) === null && !tabs(render({ ...pilot, about: copy[PILOT] })), 'a firm with no lawyers on record has no Lawyers page');

// every firm that has lawyers: every page it would have is complete and no two pages share a title or an address
{
  const titles = new Map(), canons = new Set();
  let pages = 0, flaws = [];
  for (const slug of Object.keys(stored)) {
    const firm = all.find((x) => x.slug === slug);
    if (!firm) { flaws.push(`${slug}: not a firm`); continue; }
    const f = { ...firm, about: copy[slug] || firm.about || '', lawyers: stored[slug] };
    const list = lawyersOf(f);
    if (!list.length) continue;
    const todo = [{ tab: 'lawyers' }, ...list.filter(lawyerHasPage).map((l) => ({ tab: 'lawyer', lawyer: l.slug }))];
    for (const view of todo) {
      const html = render(f, view);
      pages++;
      if (html === null) { flaws.push(`${slug} ${JSON.stringify(view)}: no page`); continue; }
      const x = parts(html);
      if (x.h1 !== 1) flaws.push(`${slug} ${view.lawyer || 'lawyers'}: ${x.h1} h1`);
      if (x.desc.length < 60 || x.desc.length > 160) flaws.push(`${slug} ${view.lawyer || 'lawyers'}: description ${x.desc.length} characters`);
      if (/\$\s?\d|\bretired\b/i.test(x.title + x.desc)) flaws.push(`${slug} ${view.lawyer || 'lawyers'}: figure or "retired" in title or description`);
      if (!x.canon.endsWith(view.lawyer ? `/lawyers/${view.lawyer}` : '/lawyers')) flaws.push(`${slug}: canonical ${x.canon}`);
      if (canons.has(x.canon)) flaws.push(`${x.canon}: twice`);
      canons.add(x.canon);
      if (titles.has(x.title)) flaws.push(`title twice: ${x.title}`);
      titles.set(x.title, x.canon);
      if (x.ld.some((j) => !j) || /(?:href|src)="\.\.\//.test(html)) flaws.push(`${slug} ${view.lawyer || 'lawyers'}: bad markup or relative link`);
    }
  }
  ok(pages > 500 && flaws.length === 0, `all ${pages} Lawyers and lawyer pages of the real data: one h1, a description that fits, a canonical of its own, a title of its own, valid markup${flaws.length ? ' - ' + flaws.slice(0, 5).join('; ') : ''}`);
}

// ---- the sitemap ----
const row = (slug, lawyers, extra = {}) => ({ slug, updatedAt: '2026-05-01 10:00:00', about: copy[PILOT], lawyers: lawyers ? JSON.stringify(lawyers) : null, lawyersOff: null, ...extra });
const rows = [row('a-firm', stored[PILOT]), row('b-firm', [stored[PILOT][0]]), row('c-firm', null), row('d-firm', stored[PILOT], { lawyersOff: 1 }), row('e-firm', stored[PILOT], { about: 'Short.' })];
const res = await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env: { SITE_ORIGIN: 'https://lawdb.ca', DB: { prepare: () => ({ all: async () => ({ results: rows }) }) } } });
const xml = await res.text();
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.includes('https://lawdb.ca/firms/a-firm') && locs.includes('https://lawdb.ca/firms/a-firm/lawyers'), 'the sitemap lists a firm and its Lawyers page');
ok(lw.filter(lawyerHasPage).every((l) => locs.includes(`https://lawdb.ca/firms/a-firm/lawyers/${l.slug}`)) && locs.filter((u) => u.startsWith('https://lawdb.ca/firms/a-firm/lawyers/')).length === lw.filter(lawyerHasPage).length, 'and a page for each lawyer who has one, no more');
ok(!locs.some((u) => /b-firm\/|c-firm\/|d-firm\/|e-firm/.test(u)) && locs.includes('https://lawdb.ca/firms/b-firm') && locs.includes('https://lawdb.ca/firms/d-firm'), 'no Lawyers page in the sitemap for a firm with one lawyer, none, switched off, or held back');
ok(new Set(locs).size === locs.length, 'no address twice');

// ---- the address ----
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) }, DB: {}, PUBLIC_CACHE_TTL: '0' };
const slash = await firmPage({ request: new Request('https://lawdb.ca/firms/a-firm/lawyers/'), env });
const slash2 = await firmPage({ request: new Request('https://lawdb.ca/firms/a-firm/lawyers/ann-lee/?x=1'), env });
ok(slash.status === 301 && slash.headers.get('location') === '/firms/a-firm/lawyers' && slash2.status === 301 && slash2.headers.get('location') === '/firms/a-firm/lawyers/ann-lee?x=1', 'a trailing slash on the new pages goes to the one address (301)');

console.log(bad ? `\n${bad} check(s) failed` : '\nall lawyer checks passed');
process.exit(bad ? 1 : 0);
