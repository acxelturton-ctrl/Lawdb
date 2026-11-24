// The lawyers of a firm: the Lawyers page (/firms/<slug>/lawyers) and, for a lawyer with enough to say, a page of their own (/firms/<slug>/lawyers/<lawyer>).
// They are stored in the firm's record as `lawyers` (a list). They were read from the firm's own website (scripts/find-firm-lawyers.py), checked
// (scripts/check-lawyer-photos.py, scripts/prepare-firm-lawyers.py) and put in the database by db/lawyers-updates.sql (scripts/apply-firm-lawyers.mjs); a firm's owner
// will be able to confirm, correct or hide them from the dashboard (`lawyersOff` hides all of them).
//
// A firm can confirm, correct, hide, add or remove lawyers, and add pictures, from its profile editor (src/lib/lawyer-edit.js). What the firm itself states
// (confirmed: true) is shown as the firm wrote it, under the same plain-text rules, and keeps the page address it already had; a lawyer the firm hides
// (hidden: true) is on no page. The firm's changes are kept: once it edits the list, the bulk update no longer touches it (lawyersLocked).
//
// Only facts are kept: name, title, the year called to the bar (shown as years in practice), schools, languages, a LinkedIn address and the address of the lawyer's page on
// the firm's own site. Two more facts only a firm can give, and only a Featured firm may: the awards and achievements it lists for the lawyer and the lawyer's direct
// phone number. No biography text is copied. A picture is kept as an address and shown only once it is confirmed (photoConfirmed), because it is the firm's or the lawyer's picture.
// cleanLawyers keeps only what is well formed and plain, so nothing odd can reach a page, whatever is in the data.
//
// A page is only made when it has something to say (no thin pages): a firm needs two or more lawyers for a Lawyers page (every lawyer shows name, role and years in
// practice there), and a page of their own is a Featured lawyer's, with a clear title and at least one fact to show. See lawyersOf for what each plan shows.
import { checkOwnerText } from './content-rules.js';
import { LANGUAGES } from './details.js';

// A picture the admin has accepted is kept on LawDB itself (R2, served at /img/lawyer/<id>), never as a link to the firm's own site, so it cannot change or
// break later. The admin's decisions are kept in the firm's record as `lawyerPhotos` ({ <lawyer slug>: { status: 'ok', photo } or { status: 'no' } }) rather
// than in the list of lawyers, so loading the list again (scripts/apply-firm-lawyers.mjs) never undoes them.
export const HOSTED_PHOTO = /^\/img\/lawyer\/[0-9a-f]{24}$/;
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

// Education: the reader took a fixed number of characters from the page, so many stored strings end in the middle of a word or run into the next paragraph
// ("...University of Southampton LL", "...(2014) Sadaf Raja received her Juris Do"). Only a string that reads whole as "<law degree> <school>" is kept, and it is
// shown in one plain form ("J.D., University of Calgary"); the year, a second degree after the school and anything else are left out. Anything that does not read
// whole is dropped, never guessed at.
const CAP = "[\\p{Lu}][\\p{L}'\u2019.\\-]*";
const STOP = '(?!(?:LL(?:\\.?[BM]\\.?)?|J(?:\\.?D\\.?)?|BA|MA|BSc|BComm|MBA|CPA|CMA|CFA|PMP|[A-Z][a-z]?)(?![\\p{L}.])|Bachelors?\\b|Masters?\\b|Doctor|Degree|Hon[ou]|Diploma|Certificate|In-Depth|Professional|Affiliations|Associations?|Memberships?|Admissions?|Admitted|Called|Bar\\b|Publications?|Co-Author|Awards?|Languages?|Practice|Areas?|Experience|Biography|Contact|Book|Community|Volunteer|Education|Courses?|Teaching|Presentations?)';
const NEXT = `(?: ${STOP}(?:(?:of|and|de|du|des) )?${CAP})`;
const SCHOOL = `(?:University of ${STOP}${CAP}${NEXT}{0,3}|Universit[\u00e9e] (?:de |du |d[\u2019'] ?)?${STOP}${CAP}${NEXT}{0,2}|${CAP}(?: ${STOP}${CAP}){0,3} (?:University|College|Law School|School of Law|Faculty of Law))`;
const DEGREES = [['LL.B.', 'LL\\.?\\s?B\\.?|Bachelor of Laws?'], ['LL.M.', 'LL\\.?\\s?M\\.?|Master of Laws'], ['J.D.', 'J\\.?\\s?D\\.?|Juris Doctor(?:ate)?'], ['B.C.L.', 'B\\.?C\\.?L\\.?']];
const OTHER_DEGREE = 'LL(?:\\.?[BM]\\.?)?|J(?:D|\\.D\\.?)?|B|M|Bachelors?|Masters?|Certificate|Diploma|In-Depth|BA|MA|BSc|BComm|MBA|B\\.A|M\\.A|B\\.Sc|B\\.Comm';
const EDUCATION = new RegExp(
  `^(?:${DEGREES.map(([, r]) => `(${r})`).join('|')})(?:\\s*\\((?:LL\\.?B\\.?|J\\.?D\\.?)\\))?(?:\\s*\\([^)]{1,30}\\))?(?:\\s*\\(?\\d{4}\\)?)?` +
  `(?:\\s*[,.:;\\-\u2013]\\s*|\\s+)(?:(?:Bachelor of Laws?|Juris Doctor|Honou?rs|Hons\\.?|Degree|program(?:me)?)(?:\\s*[\u2013-]\\s*\\d{4})?\\s*[,.:;\\-\u2013]?\\s*)?` +
  `(?:(?:in )?\\d{4}\\s*,?\\s*)?(?:(?:from|at|de|of|in)\\s+)?(?:the\\s+)?(?:l[\u2019']\\s?)?(${SCHOOL})` +
  `(?:\\s*[\u2013-]?\\s*\\(?\\d{4}\\)?)?(?:\\s*\\([A-Z]{2,6}\\))?(?:\\s+in \\d{4})?(?:\\s+(?:${OTHER_DEGREE})\\b.*)?\\.?$`, 'u');
export function normalizeEducation(e) {
  const m = EDUCATION.exec(one(e, 160));
  if (!m) return '';
  const i = [1, 2, 3, 4].findIndex((k) => m[k] !== undefined);
  return `${DEGREES[i][0]}, ${m[5].replace(/^l[\u2019']\s?/, '')}`;
}

// A LinkedIn profile address (a person's /in/ or /pub/ page), without the tracking part; '' when it is not one.
export function cleanLinkedIn(v) {
  const u = typeof v === 'string' ? v.trim().split('?')[0].split('#')[0] : '';
  return /^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9%_\-\/.]+$/.test(u) ? u : '';
}
// What the firm types is its own statement: letters and plain punctuation only (a title with a figure is a rate or a blurb), and nothing the advertising rules forbid.
export const OWNER_TITLE = /^[\p{L}][\p{L}'\u2019&,()\/.\- ]{0,69}$/u;
export const OWNER_EDUCATION = /^[\p{L}][\p{L}0-9'\u2019&,.()\- ]{1,119}$/u;
// An award or achievement as a firm may list it: a short plain line (letters, figures such as a year, ordinary punctuation, no links) that also passes the advertising rules.
export const OWNER_ACHIEVEMENT = /^[\p{L}\p{N}][\p{L}\p{N}'\u2019&,.()\-\u2013:\/ ]{2,139}$/u;
export const MAX_ACHIEVEMENTS = 5;
// A direct line: a North American number (+1 and ten digits, the area code and the exchange starting 2 to 9); '' when it is not one.
export function cleanPhone(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : '';
}

// How long a lawyer has been in practice, from the year they were called to the bar: "18 years" (and since when), or just "since 2025" for the first year or two.
export function inPractice(callYear, thisYear = new Date().getFullYear()) {
  const y = Number(callYear);
  if (!Number.isInteger(y) || y < 1950 || y > thisYear) return null;
  const years = thisYear - y;
  return { years, since: y, text: years >= 2 ? `${years} years` : `since ${y}` };
}
const stored_photo = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : typeof v === 'string' && /^\/?img\/[0-9a-f]{24}$/.test(v) ? '/' + v.replace(/^\//, '') : '');

// A person's name as it may appear: letters, initials and the usual marks (degrees after it are removed); '' when it is not one.
export function cleanName(raw) {
  const n = tidyName(raw).slice(0, 70);
  return NAME.test(n) && !/[<>@\d]/.test(n) && !/\b\p{Lu}{3,}\b/u.test(n) ? n : '';
}

export function lawyerSlug(name) {
  return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// list: what is stored. Returns the lawyers that are fit to show, in the order given, each with a unique slug.
// decisions: the firm's `lawyerPhotos` (the admin's accept / erase decisions, src/lib/lawyer-photos.js). A picture is shown only when the firm itself added it, or the
// admin accepted it (a copy kept on LawDB), or, for older records, photoConfirmed is true; a picture the admin erased is never shown (see photoStateOf).
// { stored: true } is for the editor and the updates: it also keeps the picture address with its confirmed flag (public pages never see an unconfirmed picture).
export function cleanLawyers(list, thisYear = new Date().getFullYear(), decisions = null, { stored = false } = {}) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const l of list.slice(0, MAX_LAWYERS)) {
    if (!l || typeof l !== 'object') continue;
    const name = cleanName(l.name);
    if (!name) continue;
    const mine = l.confirmed === true; // the firm's own statement
    const own = mine && typeof l.slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(l.slug) ? l.slug : '';
    const slug = own || lawyerSlug(name);
    if (!slug || seen.has(slug)) continue;
    let title = '', junk = false;
    if (mine) {
      const t = one(l.title, 70);
      title = OWNER_TITLE.test(t) && plain(t) ? t : '';
    } else {
      // a title that repeats the person's own name ("Erin Levitsky / Associate") keeps only the role
      let rawTitle = String(l.title ?? '');
      for (const n of [one(l.name, 90), name]) if (n) rawTitle = rawTitle.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i'), '');
      const t = cleanTitle(rawTitle.replace(/^[\s\\/|:,\-\u2013\u2014]+|[\s\\/|:,\-\u2013\u2014]+$/g, ''));
      if (t.drop) continue;
      title = t.title || '';
      junk = !!t.junk;
    }
    const year = Number(l.callYear);
    const yearOk = Number.isInteger(year) && year >= 1950 && year <= thisYear;
    const rawEdu = Array.isArray(l.education) ? l.education : [];
    const edu = (mine ? rawEdu.map((e) => one(e, 120)).filter((e) => OWNER_EDUCATION.test(e)) : rawEdu.map(normalizeEducation)).filter((e, i, all) => e && all.indexOf(e) === i && plain(e)).slice(0, 3);
    const langs = (Array.isArray(l.languages) ? l.languages : []).filter((x, i, all) => LANGUAGES.includes(x) && all.indexOf(x) === i).slice(0, mine ? 8 : 5);
    const li = cleanLinkedIn(l.linkedin);
    // what only the firm can say about a lawyer: awards and achievements, and a direct phone number (never taken from a website)
    const awards = mine ? (Array.isArray(l.achievements) ? l.achievements : []).map((a) => one(a, 140)).filter((a, i, all) => OWNER_ACHIEVEMENT.test(a) && plain(a) && all.indexOf(a) === i).slice(0, MAX_ACHIEVEMENTS) : [];
    const phone = mine ? cleanPhone(l.phone) : '';
    const site = typeof l.site === 'string' && /^https:\/\/[^\s"'<>]+$/.test(l.site) ? l.site : '';
    const photo = stored_photo(l.photo);
    const found = typeof l.photoFound === 'string' && /^https:\/\/[^\s"'<>]+$/.test(l.photoFound) ? l.photoFound : '';
    // a "title" that is a sentence means a testimonial or a news line was read: the person stays only when something else on record backs them up
    if (junk && !(yearOk || edu.length || langs.length || li || awards.length)) continue;
    seen.add(slug);
    const shown = photoStateOf({ photo, photoConfirmed: l.photoConfirmed === true }, decisions && decisions[slug]);
    out.push({
      name, slug,
      ...(title && plain(title) ? { title } : {}),
      ...(yearOk ? { callYear: year } : {}),
      ...(edu.length ? { education: edu } : {}),
      ...(langs.length ? { languages: langs } : {}),
      ...(li ? { linkedin: li } : {}),
      ...(awards.length ? { achievements: awards } : {}),
      ...(phone ? { phone } : {}),
      ...(site ? { site } : {}),
      ...(stored ? (photo ? { photo, photoConfirmed: l.photoConfirmed === true } : {}) : (shown.state === 'confirmed' ? { photo: shown.url } : {})),
      ...(stored && found && photo !== found ? { photoFound: found } : {}),
      ...(mine ? { confirmed: true } : {}),
      ...(l.featured === true ? { featured: true } : {}),
      ...(l.hidden === true ? { hidden: true } : {}),
    });
  }
  return out;
}

// A picture the firm added itself (an upload, or "use this picture" for the one found on its own website) is kept on LawDB under /img/<id> with photoConfirmed.
export const OWN_PHOTO = /^\/img\/[0-9a-f]{24}$/;

// What is shown for a lawyer, and what the editor says about it. l: { photo, photoConfirmed } as stored; d: the admin's decision for this lawyer (firm.lawyerPhotos[slug]).
//   confirmed  shown: the firm's own picture first (the firm's own act beats the admin's erase), then one the admin accepted, then the old confirmed flag;
//   found      a picture found on the firm's website that nobody has decided on yet (never shown on a page: the firm or the admin has to say yes);
//   none       nothing (also when the admin erased the one that was found).
export function photoStateOf(l, d) {
  const photo = l && typeof l.photo === 'string' ? l.photo : '';
  if (photo && l.photoConfirmed === true && OWN_PHOTO.test(photo)) return { state: 'confirmed', url: photo, by: 'firm' };
  if (d && d.status === 'ok' && typeof d.photo === 'string' && HOSTED_PHOTO.test(d.photo)) return { state: 'confirmed', url: d.photo, by: 'admin' };
  if (d && d.status === 'no') return { state: 'none' };
  if (photo && l.photoConfirmed === true) return { state: 'confirmed', url: photo, by: 'record' };
  return /^https:\/\//.test(photo) ? { state: 'found', url: photo } : { state: 'none' };
}

// The lawyers a firm's pages may show: none when the firm has switched them off or has fewer than MIN_FIRM_LAWYERS.
// What a visitor sees of a lawyer depends on the plan. Every lawyer a firm lists shows the same: name, role, years in practice and their picture (only a picture that has been
// confirmed: one the firm added, or one the admin accepted in the Lawyer photos tab; a picture found on a website and not yet decided on is never shown). A Featured lawyer
// (`featured: true` on the lawyer, which only billing or an admin sets) at a Featured firm also gets a page of their own and shows everything we hold: education, languages,
// LinkedIn, the page on the firm's site, awards and achievements, and a direct phone number. The facts stay on record for a lawyer who is not (or no longer) Featured and come
// back with the plan, so what a firm entered is never lost.
const basicOf = ({ name, slug, title, callYear, confirmed, photo }) => ({ name, slug, ...(title ? { title } : {}), ...(callYear ? { callYear } : {}), ...(confirmed ? { confirmed } : {}), ...(photo ? { photo } : {}) });
export function lawyersOf(firm) {
  if (!firm || firm.lawyersOff) return [];
  const l = cleanLawyers(firm.lawyers, undefined, firm.lawyerPhotos).filter((x) => !x.hidden).map((x) => (firm.featured && x.featured ? x : basicOf(x)));
  return l.length >= MIN_FIRM_LAWYERS ? l : [];
}

// The address found on the firm's own website for a lawyer (stored form), '' when there is none. A firm's own picture, once added, keeps the found address aside.
const foundOf = (l) => (l.photoConfirmed ? l.photoFound || '' : /^https:\/\//.test(l.photo || '') ? l.photo : '');
const storedOf = (firm) => cleanLawyers(Array.isArray(firm && firm.lawyers) ? firm.lawyers : [], undefined, null, { stored: true });

// For the admin's Lawyer photos tab: the lawyers of a firm (one whose lawyers its pages show) that have a picture on the firm's own site and no decision yet.
// A lawyer the firm hid, or whose own picture the firm added, is not in the queue.
export function photoCandidates(firm) {
  if (!firm || firm.lawyersOff) return [];
  const all = storedOf(firm).filter((l) => !l.hidden);
  if (all.length < MIN_FIRM_LAWYERS) return [];
  const decided = firm.lawyerPhotos && typeof firm.lawyerPhotos === 'object' ? firm.lawyerPhotos : {};
  return all.filter((l) => foundOf(l) && !decided[l.slug] && !(l.photoConfirmed && OWN_PHOTO.test(l.photo || '')))
    .map((l) => ({ slug: l.slug, name: l.name, ...(l.title ? { title: l.title } : {}), photo: foundOf(l) }));
}

// The address of a lawyer's picture on the firm's own site, as stored (for the admin to look at before deciding). '' when there is none or the lawyer is not listed.
export function sourcePhoto(firm, lawyerSlugValue) {
  const l = storedOf(firm).find((x) => x.slug === lawyerSlugValue);
  return l ? foundOf(l) : '';
}

// A lawyer has a page of their own only with a clear title and at least two more facts (year called, school, language, LinkedIn).
export const MIN_PAGE_FACTS = 1;
// A page of their own is a Featured lawyer's: it needs a clear title and at least one fact to show (no thin pages), and only a lawyer that lawyersOf returned as Featured has `featured`.
export function lawyerHasPage(l) {
  return !!(l && l.featured && l.title && [l.callYear, l.education, l.languages, l.linkedin, l.achievements, l.phone].filter(Boolean).length >= MIN_PAGE_FACTS);
}

// A "really good" lawyer profile, for putting a firm on the home page: the Lawyers tab lists three or more lawyers, at least two thirds of them with a clear
// title, and at least two of them with a fact of their own (year called, school, language or LinkedIn), so a visitor who opens the tab finds a real team page and
// not a bare list of names. A firm with no Lawyers tab at all (fewer than two lawyers, or lawyersOff) never counts.
export const STRONG_MIN_LAWYERS = 3;
export const STRONG_MIN_WITH_FACTS = 2;
export function strongLawyerProfile(firm) {
  // judged on the facts we hold for the lawyers (what a Featured lawyer listing can show), not on what a Basic listing shows: this is about how complete the data is, whatever the plan
  const l = !firm || firm.lawyersOff ? [] : cleanLawyers(firm.lawyers, undefined, firm.lawyerPhotos).filter((x) => !x.hidden);
  if (l.length < STRONG_MIN_LAWYERS) return false;
  const titled = l.filter((x) => x.title).length;
  const withFacts = l.filter((x) => [x.callYear, x.education, x.languages, x.linkedin, x.achievements].some(Boolean)).length;
  return titled * 3 >= l.length * 2 && withFacts >= STRONG_MIN_WITH_FACTS;
}


// One plain sentence per lawyer, made from the facts only.
export function lawyerLead(l, f, prov) {
  const role = l.title ? `${/^[AEIOU]/i.test(l.title) ? 'an' : 'a'} ${l.title}` : 'a lawyer';
  let s = `${l.name} is ${role} at ${f.name} in ${f.city}, ${prov}.`;
  { const p = inPractice(l.callYear); if (p) s += p.years >= 2 ? ` ${p.years} years in practice.` : ` In practice ${p.text}.`; }
  if (l.languages) s += ` Speaks ${l.languages.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
  return s;
}
