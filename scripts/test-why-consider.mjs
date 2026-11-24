// "Things to consider" on a lawyer's page (src/lib/why-consider.js, src/render/firm-page.js):
//   node --no-warnings scripts/test-why-consider.mjs
// Each fact appears once and only when we have it (nothing the page already says, no firm rating, no team size, no empty or thin section), it is never an opinion,
// and a lawyer has been "in practice" for so many years, never "called to the bar" on the page.
import { readFileSync } from 'node:fs';
import { considerLawyer } from '../src/lib/why-consider.js';
import { lawyersOf, lawyerHasPage, inPractice, cleanLawyers, cleanPhone } from '../src/lib/lawyers.js';
import { renderFirmPage } from '../src/render/firm-page.js';
import { checkOwnerText } from '../src/lib/content-rules.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the rules, on made-up data
const lawyer = { name: 'Ana Lee', slug: 'ana-lee', title: 'Senior Partner', callYear: 2008, languages: ['English', 'French'], education: ['J.D., University of Alberta'], achievements: ['Lexpert Rising Star, 2023'] };
const c = considerLawyer(lawyer, { thisYear: 2026 });
ok(c.facts.join(' | ') === '18 years in practice, since 2008. | Education: J.D., University of Alberta. | Works in English and French.' && c.achievements.join() === 'Lexpert Rising Star, 2023', 'a lawyer\'s background: years in practice, education, languages, and the awards the firm listed');
ok(!/called to the bar|years ago|lawyers? listed|reviews?|rated|Google|\bat Firm\b|Partner at/i.test([...c.facts, ...c.achievements].join(' ')), 'nothing the page already says: no "called to the bar", no firm, no team size, no rating, no role');
ok(considerLawyer({ ...lawyer, callYear: 2025 }, { thisYear: 2026 }).facts[0] === 'In practice since 2025.' && considerLawyer({ ...lawyer, callYear: 2026 }, { thisYear: 2026 }).facts[0] === 'In practice since 2026.', 'a lawyer in practice for less than two years: "In practice since 2025", not "1 year"');
const bare = considerLawyer({ name: 'Bo Chan', slug: 'bo-chan', title: 'Associate' });
ok(bare.facts.length === 0 && bare.achievements.length === 0, 'a lawyer we know nothing more about gets nothing (no filler)');
const partial = considerLawyer({ name: 'Cy Diaz', slug: 'cy-diaz', title: 'Associate', languages: ['French'] });
ok(partial.facts.join() === 'Works in French.', 'a fact we do not have is left out, the others stay (no education line when there is no education)');
ok(inPractice(1949) === null && inPractice(2040) === null && inPractice('x') === null && inPractice(2000, 2026).years === 26, 'the years in practice come from a sensible year called');
ok(cleanPhone('(403) 555-0100') === '+14035550100' && cleanPhone('1-403-555-0100') === '+14035550100' && cleanPhone('+10351717773') === '' && cleanPhone('555-0100') === '' && cleanPhone('123-456-7890') === '', 'a direct number must be a real North American number');

// ---- every lawyer in the data
const stored = JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8'));
const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
for (const f of (await import('node:fs')).readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x))) all.push(...JSON.parse(readFileSync(`data/${f}`, 'utf8')));
const EVAL = /\b(?:best|top|leading|premier|elite|expert|experts|expertise|specialist|specialists|specialize[sd]?|specializing|award[- ]winning|trusted|proven|aggressive|renowned|prestigious|exceptional|outstanding|skilled|experienced|highly|finest|foremost|recommended|reputable|successful|winning|great|excellent)\b/i;
let sections = 0, lines = 0, flagged = [], thin = [];
for (const f0 of all) {
  const f = { ...f0, featured: true, lawyers: (stored[f0.slug] || []).map((l) => ({ ...l, featured: true })) }; // as if every lawyer were Featured: every page that could exist
  for (const l of lawyersOf(f).filter(lawyerHasPage)) {
    const r = considerLawyer(l);
    const n = r.facts.length + r.achievements.length;
    if (n) sections++;
    lines += n;
    if (n > 5) thin.push(`${f.slug}/${l.slug}: ${n} lines`);
    for (const t of [...r.facts, ...r.achievements]) {
      let claim = false;
      try { checkOwnerText('consider', t.split(l.name).join(' ')); } catch { claim = true; }
      if (claim || EVAL.test(t)) flagged.push(`${f.slug}/${l.slug}: ${t}`);
      if (/^Education: /.test(t) && !/^Education: (?:LL\.B\.|LL\.M\.|J\.D\.|B\.C\.L\.), \p{Lu}/u.test(t)) flagged.push(`${f.slug}/${l.slug}: ${t}`);
    }
  }
}
ok(sections > 150 && lines > 250, `${sections} lawyer pages have a section, ${lines} lines in all, made from the real data`);
ok(flagged.length === 0, `no line is an opinion or a restricted claim, and every school reads whole${flagged.length ? ` (${flagged.slice(0, 3).join(' | ')})` : ''}`);
ok(thin.length === 0, 'no section runs long');

// ---- the pages
const PILOT = 'mincher-koeman-law-chambers-calgary';
const pilot = all.find((x) => x.slug === PILOT);
const copy = JSON.parse(readFileSync('data/firm-copy.json', 'utf8'));
const details = JSON.parse(readFileSync('data/firm-details.json', 'utf8'));
const firm = (extra = {}) => ({ ...pilot, featured: true, about: copy[PILOT], lawyers: stored[PILOT].map((l) => ({ ...l, featured: true })), details: details[PILOT] || pilot.details, ...extra });
const render = (view = null, extra = {}) => renderFirmPage({ firm: firm(extra), hours: null, images: [], posts: [], nearby: [], locations: [], origin: 'https://lawdb.ca', view });
const lw = lawyersOf(firm());
const withPage = lw.find((l) => lawyerHasPage(l) && considerLawyer(l).facts.length >= 2);
const one = render({ tab: 'lawyer', lawyer: withPage.slug }), tab = render({ tab: 'lawyers' }), overview = render();
const body = one.slice(one.indexOf('<h1 class="pf-h1">'));
ok(new RegExp(`<section class="pf-why" aria-label="Things to consider about ${withPage.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"><h2>Things to consider about`).test(one) && /<li>[^<]+<\/li>/.test(one), 'a lawyer\'s page has the "Things to consider" list');
ok(!/class="lp-facts"|<dl class="lp-facts"/.test(one) && !/Called to the bar|called to the bar/.test(one + tab), 'there is no second list of the same facts, and the pages never say "called to the bar"');
ok(!/class="pf-lede"/.test(body) && (body.match(new RegExp(`${withPage.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} at `, 'g')) || []).length === 1, 'the role and the firm are said once, in the heading, not again in a lead sentence');
ok(!/lawyers? listed|One of \d+ lawyers|Google reviews|out of 5/.test(body), 'no team size and no firm rating on the lawyer page');
ok(!/class="pf-why"/.test(tab) && !/class="pf-why"/.test(overview) && !/lw-compare/.test(tab), 'the Lawyers page and the Overview have no "things to consider" list and no second table of the same facts');
ok(/years in practice|In practice since/.test(tab) && /class="lw-person"/.test(tab), 'the Lawyers page cards say years in practice');
const paid = [{ name: 'Ana Lee', slug: 'ana-lee', title: 'Senior Partner', callYear: 2008, languages: ['English'], confirmed: true, featured: true, achievements: ['Lexpert Rising Star, 2023'], phone: '+14035550100' }, { name: 'Bo Chan', slug: 'bo-chan', title: 'Associate', callYear: 2015, languages: ['French'] }];
const paidPage = (featured, view, lawyers = paid) => renderFirmPage({ firm: { ...pilot, about: copy[PILOT], lawyers, featured }, view });
const featured = paidPage(true, { tab: 'lawyer', lawyer: 'ana-lee' });
ok(featured.includes('<h3>Awards and achievements</h3>') && featured.includes('Lexpert Rising Star, 2023') && featured.includes('Call (403) 555-0100') && featured.includes('18 years in practice, since 2008.'), 'a Featured lawyer at a Featured firm has a page with the awards and a Call button');
ok(paidPage(false, { tab: 'lawyer', lawyer: 'ana-lee' }) === null && paidPage(true, { tab: 'lawyer', lawyer: 'bo-chan' }) === null, 'a lawyer at a firm that is not Featured, or one who has not paid, has no page of their own');
const basicTab = paidPage(true, { tab: 'lawyers' });
const cards = basicTab.slice(basicTab.indexOf('<ul class="lw-grid"'), basicTab.indexOf('</ul>', basicTab.indexOf('<ul class="lw-grid"')));
const boCard = cards.split('<li class="lw-person">').find((c) => c.includes('Bo Chan'));
ok(boCard.includes('Associate') && boCard.includes('11 years in practice') && !/French|View profile|<a /.test(boCard.replace(/<b>[^<]*<\/b>/, '').replace(/<a class="lc-me"[^>]*>[^<]*<\/a>/, '')), 'a lawyer who has not paid is a card with name, role and years in practice, and no link, language or phone');
const claimBox = (basicTab.match(/<section class="lc-box"[\s\S]*?<\/section>/) || [''])[0];
const claimText = claimBox.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
ok(/id="claim-lawyer"/.test(claimBox) && claimText === 'Are you a lawyer at ' + pilot.name + '? Claim your listing' && /<a class="pf-btn pf-primary" href="\/for-firms#lawyers" data-claim-open/.test(claimBox), 'under the lawyers there is one heading and one button and no other words (the same sentences on every firm\'s page would be repeated text for search engines)');
ok(!/<form|lc-example|lc-steps|lc-perks|lc-teaser|data-claim-lawyer|Is this you/.test(basicTab), 'no form, no perks, no steps, no example card, no line under the heading and no link on each card in the page itself');
ok(/data-firm="[^"]+"/.test(claimBox) && /data-featured="1"/.test(claimBox) && /data-featured="0"/.test(paidPage(false, { tab: 'lawyers' })) && /data-firm-price="199"/.test(claimBox) && /data-lawyer-price="99"/.test(claimBox) && claimBox.includes('[&quot;ana-lee&quot;,&quot;Ana Lee&quot;]') && claimBox.includes('/lawyer-claim.js'), 'the button carries what the form needs (the firm, its lawyers, whether it is Featured and the two prices) and the form is built by /lawyer-claim.js when it is pressed');
const claimJs = readFileSync('lawyer-claim.js', 'utf8');
ok(claimJs.includes('is not Featured yet') && claimJs.includes('Tell your firm') && claimJs.includes('Which lawyer are you?') && claimJs.includes('Claim your free listing') && !/innerHTML/.test(claimJs), 'the script writes the form, and what the firm\'s state means for the lawyer, as plain text');
ok(!/class="pf-why"/.test(paidPage(true, { tab: 'lawyer', lawyer: 'ana-lee' }).replace(/<section class="pf-why"[\s\S]*?<\/section>/, '')), 'one "things to consider" section per lawyer page');

// pictures: a confirmed picture shows on a Basic listing, a picture only found on a website does not
const hosted = '/img/lawyer/' + 'a'.repeat(24);
const picFirm = { ...pilot, about: copy[PILOT], featured: false, lawyers: [{ name: 'Ana Lee', slug: 'ana-lee', title: 'Partner', callYear: 2008, photo: 'https://firm.example/ana.jpg' }, { name: 'Bo Chan', slug: 'bo-chan', title: 'Associate', photo: 'https://firm.example/bo.jpg' }], lawyerPhotos: { 'ana-lee': { status: 'ok', photo: hosted } } };
const picTab = renderFirmPage({ firm: picFirm, view: { tab: 'lawyers' } });
ok(picTab.includes(`src="${hosted}"`) && !picTab.includes('firm.example/bo.jpg') && !picTab.includes('firm.example/ana.jpg'), 'on a Basic firm\'s Lawyers page a lawyer whose picture the admin accepted shows it, and a lawyer with only a picture found on a website does not');

console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
