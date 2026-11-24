// The three-part layout of every firm's description (scripts/lib/description.mjs, scripts/build-firm-descriptions.mjs):
//   node --no-warnings scripts/test-firm-descriptions.mjs
// 1. who the firm is, what it handles and where  2. facts about it  3. what to do next. Only facts, never a claim a law society restricts.
import { readFileSync } from 'node:fs';
import { loadRepoFirms } from './lib/site-firms.mjs';
import { buildDescription, practicePhrase, plainName, plainAddress, callToAction, phoneText, withoutTemplateText } from './lib/description.mjs';
import { aboutWords, MIN_ABOUT_WORDS } from '../src/lib/indexing.js';
import { metaFromAbout, PROVINCES } from '../src/render/firm-page.js';
import { checkOwnerText } from '../src/lib/content-rules.js';
import { withoutPublicationNames } from './lib/research.mjs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the pieces, on made-up firms
const f = { slug: 'ex-1', name: 'Example Law', city: 'Calgary', province: 'AB', caseTypes: ['injury', 'criminal'], tags: ['Personal Injury', 'Criminal Defence'], phone: '+14035550100', address: '1 Main St #2, Calgary, AB T2P 1A1' };
ok(practicePhrase(f) === 'personal injury and criminal defence law firm' && practicePhrase({ caseTypes: ['family'] }) === 'family law firm' && practicePhrase({ caseTypes: [] }) === 'law firm', 'the practice phrase reads "personal injury and criminal defence law firm", "family law firm", or just "law firm"');
ok(plainName('Real Estate Lawyers.ca LLP') === 'Real Estate Lawyers LLP' && plainAddress('2838 Garden St #1, Abbotsford') === '2838 Garden St Suite 1, Abbotsford', 'a web address in a name and a "#1" in an address are written so the content rules accept them');
ok(phoneText('+14035550100') === '(403) 555-0100' && phoneText('+10351717773') === '' && phoneText('') === '', 'a phone number is shown only if it is a real one');
const cta = callToAction(f);
ok(/If you or a loved one has been injured/.test(cta) && cta.includes('Example Law') && /consultation/i.test(cta) && !/\d{3}/.test(cta), 'the last part says what to do next, for the firm\'s main practice area, and points at the consultation request; the phone number is not repeated (it is on the page already)');
ok(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => callToAction({ ...f, slug: 'firm-' + i }))).size === 3, 'it has three wordings, chosen by the firm, so one sentence is not on every page');
const fresh = buildDescription({ firm: { ...f, caseTypes: ['litigation'], tags: ['Civil Litigation'], slug: 'ex-2' }, provName: 'Alberta' });
ok(fresh.split('\n\n').length === 2 && /^Example Law is a Calgary(?:, Alberta)? litigation law firm\./.test(fresh) && !/office is at|\(403\)|Clients rate|public business information/.test(fresh), 'a firm with no written text gets who and what, then what to do next: no address, no phone number, no rating (the page shows them) and no "built from public business information"');
const old = 'Example Law is a law firm in Calgary, Alberta that practises civil litigation.\n\nThe firm was founded by Ann Lee.\n\nClients rate the firm 4.9 out of 5 from 71 public Google reviews. The office is at 1 Main St #2, Calgary, AB T2P 1A1, and you can call (403) 555-0100 or visit the firm\'s website to ask about your matter. This listing is built from public business information; the firm can claim it on LawDB to add its own description, logo and hours.';
const cleaned = buildDescription({ firm: { ...f, caseTypes: ['litigation'], slug: 'ex-6' }, provName: 'Alberta', base: old });
ok(cleaned.includes('The firm was founded by Ann Lee.') && !/Clients rate|office is at|ask about your matter|built from public business information|555-0100/.test(cleaned) && withoutTemplateText(old) === 'Example Law is a law firm in Calgary, Alberta that practises civil litigation.\n\nThe firm was founded by Ann Lee.', 'the old generated paragraph (the rating, the office and phone, "built from public business information") is taken out of any text, and what the firm wrote stays');
const withText = buildDescription({ firm: { ...f, caseTypes: ['criminal'], slug: 'ex-3' }, provName: 'Alberta', base: 'Example Law is a Calgary criminal defence law firm with two lawyers.\n\nThe firm defends impaired driving, bail, drug and assault charges for clients in Calgary and southern Alberta. Lawyers Ann Lee and Bo Chan practise from Suite 4 at 1 Main Street.' });
const parts = withText.split('\n\n');
ok(parts.length === 3 && parts[0].startsWith('Example Law is a Calgary criminal defence law firm with two lawyers. The firm defends impaired driving') && parts[1].startsWith('Lawyers Ann Lee and Bo Chan') && /If you or someone close to you has been charged/.test(parts[2]), 'a firm with written text keeps its sentences: who and what first, the lawyers and the office next, then what to do');
ok(!/,\s*serving|matters involving/.test(buildDescription({ firm: { ...f, caseTypes: ['criminal'], slug: 'ex-4' }, provName: 'Alberta', base: 'Example Law is a Calgary firm handling impaired driving, bail and drug charges.' })), 'a matters sentence is not added when the opening already lists them');
const top = buildDescription({ firm: { ...f, name: 'Top Law Firm', slug: 'ex-5', caseTypes: ['family'] }, provName: 'Alberta' });
ok(!/Top Law Firm/.test(top) && /^This Calgary family law firm/.test(top) && (() => { try { checkOwnerText('about', top); return true; } catch { return false; } })(), 'a firm whose name the content rules read as a claim is written as "the firm"');

// ---- every firm
const base = JSON.parse(readFileSync('data/firm-copy-base.json', 'utf8'));
const copy = JSON.parse(readFileSync('data/firm-copy.json', 'utf8'));
const firms = loadRepoFirms();
const EVAL = /\b(?:best|top[- ]rated|leading|premier|elite|expert|experts|expertise|specialist|specialists|specialize[sd]?|award[- ]winning|trusted|proven|aggressive|renowned|prestigious|exceptional|outstanding|skilled|highly|finest|foremost|dedicated|committed|passionate|personalized|personalised|strong advocacy|deserve|guarantee[sd]?|results|win|winning|successful)\b/i;
const problems = { template: [], thin: [], missing: [], shape: [], first: [], city: [], phone: [], claim: [], url: [], long: [], cta: [], stale: [] };
for (const f0 of firms) {
  const t = copy[f0.slug];
  if (!t) { problems.missing.push(f0.slug); continue; }
  const ps = t.split('\n\n');
  if (ps.length < 2 || ps.length > 4) problems.shape.push(`${f0.slug}: ${ps.length} paragraphs`);
  if (base[f0.slug] && !t.startsWith(base[f0.slug].split(/\n\n/)[0].split(/(?<=[.!?])\s+(?=[A-Z])/)[0])) problems.first.push(f0.slug);
  if (!metaFromAbout(t)) problems.first.push(`${f0.slug}: first sentence`);
  if (!ps[0].includes(f0.city) && !ps[0].includes(f0.city.replace(/-/g, ' '))) problems.city.push(f0.slug);
  const last = ps[ps.length - 1], ph = phoneText(f0.phone);
  if (!/consultation/i.test(last) || !/\b(?:If you|you can contact|can explain)/.test(last)) problems.cta.push(f0.slug);
  if (/\(\d{3}\) \d{3}-\d{4}/.test(last)) problems.phone.push(f0.slug); // the phone number is not repeated in the text
  if (/Clients rate the firm|public Google reviews|to ask about your matter|built from public business information/.test(t) || /The office is at [^\n]*? to ask about your matter/.test(t)) problems.template.push(f0.slug);
  if (aboutWords(t) < MIN_ABOUT_WORDS) problems.thin.push(`${f0.slug}: ${aboutWords(t)} words`);
  try { checkOwnerText('about', withoutPublicationNames(t)); } catch { problems.claim.push(f0.slug); }
  const mine = t.slice(t.indexOf(last)); // the sentences this layout adds are held to the word list; the firm's own researched sentences were checked when they were written
  if (EVAL.test(mine.replace(plainName(f0.name), ''))) problems.claim.push(`${f0.slug}: ${mine.slice(0, 80)}`);
  if (/https?:|www\.|\.(?:ca|com)\b/i.test(t)) problems.url.push(f0.slug);
  if (t.length > 2000) problems.long.push(f0.slug);
  if (buildDescription({ firm: f0, base: base[f0.slug] || '', details: undefined, provName: PROVINCES[f0.province] }) === undefined) problems.stale.push(f0.slug);
}
const show = (k) => (problems[k].length ? ` (${problems[k].slice(0, 3).join(' | ')})` : '');
ok(Object.keys(copy).length === firms.length && problems.missing.length === 0, `every one of the ${firms.length} firms has a description`);
ok(problems.shape.length === 0, `each is two to four paragraphs${show('shape')}`);
ok(problems.first.length === 0, `the first sentence is the firm's own where it has written text, and always fits the search description${show('first')}`);
ok(problems.city.length === 0, `the first paragraph names the city${show('city')}`);
ok(problems.cta.length === 0 && problems.phone.length === 0, `the last paragraph says what to do next, and does not repeat the phone number${show('cta')}${show('phone')}`);
ok(problems.template.length === 0, `no description has the old generated paragraph (the rating, "The office is at ...", "built from public business information")${show('template')}`);
ok(problems.thin.length === 0, `every description is at least ${MIN_ABOUT_WORDS} words, so no page falls out of the sitemap as thin${show('thin')}`);
ok(problems.claim.length === 0, `nothing in it is a claim a law society restricts, and the added sentences have no "dedicated", "committed", "strong advocacy" or promise of a result${show('claim')}`);
ok(problems.url.length === 0 && problems.long.length === 0, `no web address, and none over 2,000 characters${show('url')}`);

console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
