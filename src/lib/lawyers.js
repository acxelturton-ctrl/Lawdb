// The lawyers of a firm: the Lawyers page (/firms/<slug>/lawyers) and, for a lawyer with enough to say, a page of their own (/firms/<slug>/lawyers/<lawyer>).
// They are stored in the firm's record as `lawyers` (a list). They were read from the firm's own website (scripts/find-firm-lawyers.py), checked
// (scripts/check-lawyer-photos.py, scripts/prepare-firm-lawyers.py) and put in the database by db/lawyers-updates.sql (scripts/apply-firm-lawyers.mjs); a firm's owner
// will be able to confirm, correct or hide them from the dashboard (`lawyersOff` hides all of them).
//
// Only facts are kept: name, title, the year called to the bar, schools, languages, a LinkedIn address and the address of the lawyer's page on the firm's own site.
// No biography text is copied. A picture is kept as an address and shown only once it is confirmed (photoConfirmed), because it is the firm's or the lawyer's picture.
// cleanLawyers keeps only what is well formed and plain, so nothing odd can reach a page, whatever is in the data.
//
// A page is only made when it has something to say (no thin pages): a firm needs two or more lawyers for a Lawyers page, and a lawyer needs a clear title and at
// least two more facts (year called, school, language, LinkedIn) for a page of their own. The others still appear on the firm's Lawyers page.
import { checkOwnerText } from './content-rules.js';
import { LANGUAGES } from './details.js';

export const MIN_FIRM_LAWYERS = 2;
export const MAX_LAWYERS = 120;

const NAME = /^[\p{Lu}][\p{L}'’.\-]*(?: (?:[\p{Lu}]\.?|[\p{Ll}]{1,3}|[\p{Lu}][\p{L}'’.\-]*)){1,4}$/u;
const one = (s, max) => String(s ?? '').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const plain = (s) => { try { checkOwnerText('lawyers', s); return true; } catch { return false; } };

// A name as the firm's page prints it, without degrees after it ("Sara J. Premi B. Comm" -> "Sara J. Premi").
function tidyName(raw) {
  return one(raw, 90)
    .replace(/[,\s]+(?:B\.?\s?Comm\.?|B\.?A\.?|B\.?Sc\.?|LL\.?B\.?|LL\.?M\.?|J\.?D\.?|M\.?B\.?A\.?|Q\.?C\.?|K\.?C\.?)$/i, '')
    .replace(/\s+B$/, '');
}

// A title is a short role such as "Partner", "Senior Associate" or "Family Lawyer". What a page prints can be more than that (a billing rate, degrees, the firm's name,
// a sentence from a testimonial), so only a plain role is kept. Returns { title } ('' when there is no clear role), { junk: true } when the text is a sentence (a
// testimonial or a quote was read instead of a staff entry), or { drop: true } for someone who is not a practising lawyer (paralegal, retired, assistant, student,
// a notary who is not also a lawyer...).
const ROLE = /\b(partner|associate|associ[eé]e?|counsel|conseill?[eè]re?|lawyer|attorney|barrister|solicitor|founder|co-founder|principal|shareholder|litigator|avocate?|advocate|mediator|arbitrator|practitioner)\b/i;
const NOT_A_LAWYER = /\b(non-lawyer|paralegal|assistant|clerk|student|articling|intern|receptionist|secretary)\b/i;
// someone who is not in practice now (retired, deceased, on leave, not yet admitted) is not listed
const NOT_PRACTISING = /(retired|retrait|emerit|\bformer\b|deceased|memor|passed away|no longer|not in active|on leave|pending admission|inactive|non-practi[cs]ing)/i;
// parts of a title that are not the role of a lawyer: a company office, a section label, a line from a blurb or a testimonial
const NOT_A_ROLE = /\b(ceo|chief|vice president|hr|human resources|programs?|officer|spotlight|future|legalshield|esteemed|established|drafted|customized|an)\b/i;
const DEGREE = /^(?:(?:[A-Za-z]{1,2}\.){1,5}[A-Za-z]{0,5}\.?|LL[BM]|JD|MBA|BA|BSc|BComm|PhD|KC|QC|Q\.? ?Med\.?)$/;
const SPOKEN = /\b(who|has|have|been|our|we|my|is|are|was|really|great|highly|recommended|helped|years)\b/i;

// accents printed as two odd characters ("sÃ©nior"): put right when the whole text can be, otherwise null
function unmangle(t) {
  if (!/[ÃÂ]|â€/.test(t)) return t;
  try {
    const bytes = Uint8Array.from(Array.from(t, (c) => { if (c.charCodeAt(0) > 255) throw new Error('not latin-1'); return c.charCodeAt(0); }));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

export function cleanTitle(raw) {
  let t = one(raw, 200);
  if (!t) return { title: '' };
  if (NOT_A_LAWYER.test(t) || NOT_PRACTISING.test(t)) return { drop: true };
  t = unmangle(t);
  if (t === null) return { title: '' };
  if (NOT_PRACTISING.test(t)) return { drop: true };
  t = t.replace(/^\((.*)\)$/, '$1').replace(/\bSr\.?(?=\s)/gi, 'Senior').replace(/\bJr\.?(?=\s)/gi, 'Junior').replace(/\bU\.S\./g, 'US');
  // a qualification as a notary next to the lawyer's own title is not part of the role ("Barrister & Solicitor, and Notary"); a notary alone is not a lawyer
  const noNotary = t.replace(/(?:^|[,;|+]|\s[-–—]\s|\s)(?:and\s+)?Notary(?: Public)?\b/gi, '').replace(/\s+and\s*$/i, '');
  if (/\bnotary\b|\bnotaire\b/i.test(t) && !ROLE.test(noNotary.replace(/\bpartner\b/gi, ''))) return { drop: true };
  t = noNotary;
  // the parts: drop degrees (B.A., Ll.B.), honours (K.C.), anything with a figure (a billing rate: "Associate, $325.00/hr") and parts that are not a role
  t = t.split(/\s*[,;|+]\s*|\s[-–—]\s/).map((x) => x.trim()).filter((x) => x && !DEGREE.test(x) && !/[\d$€£]|\/\s*h(?:ou)?r/i.test(x) && !NOT_A_ROLE.test(x)).join(', ');
  t = t.replace(/^[\s\-–—,:]+|[\s\-–—,:]+$/g, '').replace(/\s*:\s*[\p{L} .'’-]{2,30}$/u, '');
  if (!t) return { title: '' };
  if (/[.!?:;]/.test(t) || t.length > 70 || SPOKEN.test(t)) return { junk: true };
  return { title: ROLE.test(t) ? t.replace(/\s+(?:at|@)\s+.*$/i, '') : '' };
}

export function lawyerSlug(name) {
  return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// list: what is stored. Returns the lawyers that are fit to show, in the order given, each with a unique slug.
export function cleanLawyers(list, thisYear = new Date().getFullYear()) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const l of list.slice(0, MAX_LAWYERS)) {
    if (!l || typeof l !== 'object') continue;
    const name = tidyName(l.name).slice(0, 70);
    if (!NAME.test(name) || /[<>@\d]/.test(name) || /\b\p{Lu}{3,}\b/u.test(name)) continue;
    const slug = lawyerSlug(name);
    if (!slug || seen.has(slug)) continue;
    // a title that repeats the person's own name ("Erin Levitsky / Associate") keeps only the role
    let rawTitle = String(l.title ?? '');
    for (const n of [one(l.name, 90), name]) if (n) rawTitle = rawTitle.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i'), '');
    const t = cleanTitle(rawTitle.replace(/^[\s\\/|:,\-–—]+|[\s\\/|:,\-–—]+$/g, ''));
    if (t.drop) continue;
    const title = t.title || '';
    const year = Number(l.callYear);
    const yearOk = Number.isInteger(year) && year >= 1950 && year <= thisYear;
    const edu = (Array.isArray(l.education) ? l.education : []).map((e) => one(e, 120).replace(/\s+[A-Z]$/, '')).filter((e) => e && plain(e)).slice(0, 3);
    const langs = (Array.isArray(l.languages) ? l.languages : []).filter((x) => LANGUAGES.includes(x)).slice(0, 5);
    const li = typeof l.linkedin === 'string' && /^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9%_\-\/.]+$/.test(l.linkedin.split('?')[0]) ? l.linkedin.split('?')[0] : '';
    const site = typeof l.site === 'string' && /^https:\/\/[^\s"'<>]+$/.test(l.site) ? l.site : '';
    const photo = typeof l.photo === 'string' && /^https:\/\/[^\s"'<>]+$/.test(l.photo) ? l.photo : '';
    // a "title" that is a sentence means a testimonial or a news line was read: the person stays only when something else on record backs them up
    if (t.junk && !(yearOk || edu.length || langs.length || li)) continue;
    seen.add(slug);
    out.push({
      name, slug,
      ...(title && plain(title) ? { title } : {}),
      ...(yearOk ? { callYear: year } : {}),
      ...(edu.length ? { education: edu } : {}),
      ...(langs.length ? { languages: langs } : {}),
      ...(li ? { linkedin: li } : {}),
      ...(site ? { site } : {}),
      ...(photo && l.photoConfirmed === true ? { photo } : {}),
    });
  }
  return out;
}

// The lawyers a firm's pages may show: none when the firm has switched them off or has fewer than MIN_FIRM_LAWYERS.
export function lawyersOf(firm) {
  if (!firm || firm.lawyersOff) return [];
  const l = cleanLawyers(firm.lawyers);
  return l.length >= MIN_FIRM_LAWYERS ? l : [];
}

// A lawyer has a page of their own only with a clear title and at least two more facts (year called, school, language, LinkedIn).
export const MIN_PAGE_FACTS = 2;
export function lawyerHasPage(l) {
  return !!(l && l.title && [l.callYear, l.education, l.languages, l.linkedin].filter(Boolean).length >= MIN_PAGE_FACTS);
}

export function lawyerFacts(l, province) {
  const out = [];
  if (l.title) out.push(['Title', l.title]);
  if (l.callYear) out.push(['Called to the bar', String(l.callYear)]);
  if (l.education) out.push(['Education', l.education.join('; ')]);
  if (l.languages) out.push(['Languages', l.languages.join(', ')]);
  return out;
}

// One plain sentence per lawyer, made from the facts only.
export function lawyerLead(l, f, prov) {
  const role = l.title ? `${/^[AEIOU]/i.test(l.title) ? 'an' : 'a'} ${l.title}` : 'a lawyer';
  let s = `${l.name} is ${role} at ${f.name} in ${f.city}, ${prov}.`;
  if (l.callYear) s += ` Called to the bar in ${l.callYear}.`;
  if (l.languages) s += ` Speaks ${l.languages.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
  return s;
}
