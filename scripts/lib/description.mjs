// A firm's description in three parts, the shape of a good directory description:
//   1. who the firm is, what it handles and where: "<Firm> is a <City> <practice> law firm ... The firm represents clients in matters involving ... "
//   2. facts about the firm: its lawyers, its history, awards, languages, where the office is
//   3. what to do next: "If you ... , <Firm> offers legal guidance ... Call <phone> or request a consultation on this page."
// It is built only from facts LawDB holds: the firm's own words (the researched text in data/firm-copy-base.json, written from the firm's website and checked
// against the pages it cites), its practice areas, its address and phone, and the details we read from its website. Nothing is added that a law society restricts:
// no "best", no "dedicated", no promise of a result (see src/lib/content-rules.js). The sentences of the researched text are kept as they are and only put in the
// part where they belong. Pure functions; scripts/build-firm-descriptions.mjs writes the result to data/firm-copy.json.
import { splitSentences } from './research.mjs';
import { MATTERS, mentions } from './matters.mjs';
import { checkOwnerText } from '../../src/lib/content-rules.js';

const PRACTICE = { realestate: 'real estate', wills: 'wills and estates', litigation: 'litigation', business: 'business', family: 'family law', injury: 'personal injury', employment: 'employment', immigration: 'immigration', criminal: 'criminal defence', traffic: 'traffic ticket' };
const joinAnd = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
const lower = (s) => String(s).toLowerCase();

export const phoneText = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''; };
// a firm called "Something.ca" is written without the web address, which the content rules do not allow in a description
export const plainName = (n) => String(n).replace(/\.(?:ca|com|org|net|law)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
// "a Calgary firm", "an Edmonton firm"
const a = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// the content rules read "#1" as a ranking claim: a unit in an address is written "Suite 1"
export const plainAddress = (s) => String(s).replace(/#\s?(\w+)/g, 'Suite $1');
// a firm whose name the content rules read as a claim ("Top Law Firm") is written as "the firm", as the researched text does
const nameOk = (n) => { try { checkOwnerText('about', `${n} is a law firm.`); return true; } catch { return false; } };
// The old generated paragraph ("Clients rate the firm ... The office is at ..., and you can call ... to ask about your matter. This listing is built from public business
// information; ...") is never part of a description: the rating, the office and the phone number are on the page already, and the claim line is the page's own link.
export function withoutTemplateText(text) {
  return String(text || '').split(/\n{2,}/).map((para) => para
    .replace(/Clients rate the firm [\d.]+ out of 5 from [\d,]+ public Google reviews\.\s*/g, '')
    .replace(/The office is at [^\n]*? to ask about your matter\.\s*/g, '')
    .replace(/This listing is built from public business information; the firm can claim it on LawDB to add its own description, logo and hours\.\s*/g, '')
    .trim()).filter(Boolean).join('\n\n');
}
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// "personal injury and criminal defence law firm", "family law firm"
export function practicePhrase(f) {
  const names = [...new Set((f.caseTypes || []).map((k) => PRACTICE[k]).filter(Boolean))].slice(0, 2);
  if (!names.length) return 'law firm';
  const list = joinAnd(names);
  return / law$/.test(list) ? `${list} firm` : `${list} law firm`;
}

// "If you or a loved one has been injured in an accident": the situation of someone looking for this kind of lawyer, by the firm's main practice area
const IF = {
  criminal: 'If you or someone close to you has been charged with an offence',
  family: 'If you are separating, divorcing or dealing with a parenting or support issue',
  injury: 'If you or a loved one has been injured in an accident',
  immigration: 'If you are planning to come to Canada or need help with an immigration application',
  employment: 'If you have lost a job, are in a workplace dispute or need advice on an employment contract',
  realestate: 'If you are buying, selling or refinancing a property',
  wills: 'If you need a will, a power of attorney or help with an estate',
  business: 'If you are starting, running or selling a business',
  litigation: 'If you are involved in a civil dispute',
  traffic: 'If you have received a traffic ticket or a licence suspension',
  none: 'If you need legal advice',
};

// Part 3: what to do next, in three wordings so the same sentence is not on every page
export function callToAction(f) {
  const key = (f.caseTypes || []).find((k) => IF[k]) || 'none';
  const name = nameOk(plainName(f.name)) ? plainName(f.name) : 'the firm', city = f.city;
  const v = hash(f.slug) % 3;
  const guide = [
    `${IF[key]}, ${name} offers legal guidance in ${city} to help you understand your options and decide on next steps.`,
    `${IF[key]}, you can contact ${name} in ${city} to talk through your situation and what to do next.`,
    `${IF[key]}, ${name} can explain your options and the next steps.`,
  ][v];
  // the phone number is on the page already (the Call button and the card above), so the last part points at the consultation request instead
  const reach = ['Request a consultation on this page.', 'You can send a consultation request from this page.', 'To get in touch, use the Request a consultation button on this page.'][v];
  return `${guide} ${reach}`;
}

// Which kinds of matter the text mentions (the lists in scripts/lib/matters.mjs), for the firm's own practice areas
function mattersIn(f, text) {
  const keys = (f.caseTypes || []).filter((k) => MATTERS[k]);
  const sentences = splitSentences(text);
  const found = [];
  for (const k of keys) for (const [, re, short] of MATTERS[k]) if (sentences.some((s) => mentions([s], re)) && !found.includes(short)) found.push(short);
  return found;
}

const NAMED = /\b(?:lawyers?|partners?|counsel|associates?|founder|founded by|led by|headed by|joined by|alongside|principal)\b[^.]{0,50}\b[A-Z][a-z]+ [A-Z][a-z'’-]+/;
const ADDRESS = /\b(?:suite|office is|offices? (?:is|are) (?:at|in)|located|avenue|street|\bave\b|\bst\b|floor)\b/i;

// The opening sentence of a firm with no written text: "<Firm> is a <City> <practice> law firm", 50 to 160 characters because it is also the search description
export function leadSentence({ firm: f, details = {}, provName }) {
  const city = f.city, prov = provName || f.province, phrase = practicePhrase(f), d = details || {};
  const n = plainName(f.name), est = d.founded ? ` established in ${d.founded}` : '';
  const forms = nameOk(n)
    ? [`${n} is ${a(city)} ${city} ${phrase}${est}.`, `${n} is ${a(city)} ${city}, ${prov} ${phrase}${est}.`, `${n} is ${a(phrase)} ${phrase} based in ${city}, ${prov}${est}.`, `${n} is ${a(phrase)} ${phrase} with its office in ${city}, ${prov}${est}.`]
    : [`This ${city} ${phrase}${est} serves clients in ${city}, ${prov}.`, `This ${phrase}${est} is based in ${city}, ${prov}, and serves clients in ${city} and the area around it.`];
  return forms.find((s) => s.length >= 50 && s.length <= 160) || forms[forms.length - 1];
}

export function buildDescription({ firm: f, base = '', details = {}, provName }) {
  const city = f.city, prov = provName || f.province;
  const d = details || {};
  base = withoutTemplateText(base);
  const sentences = splitSentences(base);
  const tags = [...new Set((f.tags || []).filter(Boolean).map(lower))];
  const phrase = practicePhrase(f);

  // ---- part 1
  let first = sentences[0] || '';
  if (!first) first = leadSentence({ firm: f, details: d, provName: prov });
  const rest = sentences.slice(1);
  const hits = (s) => { let n = 0; for (const k of (f.caseTypes || []).filter((x) => MATTERS[x])) for (const [, re] of MATTERS[k]) if (mentions([s], re)) n++; return n; };
  const mIndex = rest.findIndex((s) => hits(s) >= 2 && !NAMED.test(s) && !ADDRESS.test(s) && s.length <= 360);
  let matterSentence = mIndex >= 0 ? rest[mIndex] : '';
  const facts = rest.filter((_, i) => i !== mIndex);
  const where = d.serving && d.serving.length ? joinAnd(d.serving.slice(0, 3)) : `${city}, ${prov}`;
  if (!matterSentence && hits(first) < 2) {
    const found = mattersIn(f, base).slice(0, 5);
    if (found.length >= 2) matterSentence = `The firm represents clients in matters involving ${joinAnd(found)}${d.serving && d.serving.length ? `, serving ${where}` : ` in ${city}, ${prov}`}.`;
    else if (!sentences.length) { // nothing written about the firm yet: say what it practises (as listed) and where
      matterSentence = tags.length > 1 ? `Its listed practice areas are ${joinAnd(tags.slice(0, 4))}, and it serves clients in ${where}.` : `The firm serves clients in ${where}.`;
    }
  }
  let p1 = [first, matterSentence].filter(Boolean).join(' ');
  if (!p1.includes(city)) p1 += ` The firm is based in ${city}, ${prov}.`;

  // ---- part 2: the facts we hold about the firm
  const extra = [];
  if (!sentences.length) {
    if (d.languages && d.languages.length) extra.push(`The firm works in ${joinAnd(d.languages)}.`);
  }
  const p2sentences = [...facts, ...extra];
  const paras = [p1];
  const p2 = p2sentences.join(' ');
  if (p2.length > 620 && p2sentences.length > 3) { // a long block is two paragraphs, split at a sentence
    let acc = 0, cut = 1;
    for (let i = 0; i < p2sentences.length; i++) { acc += p2sentences[i].length; if (acc >= p2.length / 2) { cut = i + 1; break; } }
    paras.push(p2sentences.slice(0, cut).join(' '), p2sentences.slice(cut).join(' '));
  } else if (p2) paras.push(p2);

  // ---- part 3
  paras.push(callToAction(f));
  return paras.filter(Boolean).join('\n\n');
}
