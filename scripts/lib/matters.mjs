// "By the kind of matter" on a city practice page (<province>/<city>/<practice>-lawyers.html): a table whose rows are kinds of matter ("Impaired driving and
// roadside sanctions") and whose cells are the firms in that city whose LawDB profile mentions that kind of matter, with the facts the profile holds.
// It is the shape of a good answer to "who do I call about X?", made of what the profiles say, not of anyone's opinion: a directory may not call a lawyer the
// best, a specialist or the right choice (law societies restrict those claims, see src/lib/content-rules.js), so a firm is in a row only because its own text mentions the matter,
// the firms are in the same order as the table of firms above them, and the last column is facts (rating and reviews, founded, lawyers listed, languages).
// Pure functions; practice-pages-core.mjs puts the result on the page and scripts/test-matters.mjs checks every table.
import { lawyersOf } from '../../src/lib/lawyers.js';
import { cleanDetails } from '../../src/lib/details.js';
import { splitSentences } from './research.mjs';

export const MIN_ROWS = 3; // a table needs at least this many kinds of matter that some firm mentions
export const MAX_ROWS = 6;
export const PER_ROW = 3; // firms shown in a row (the row says how many mention the matter)

// A sentence that says a firm does NOT do something, or sends it elsewhere, must not put the firm in that row.
const NEGATED = /\b(?:not|no longer|never|cannot|can't|except|excluding|unable|refers?|referral|outside (?:of )?(?:its|our|the firm's) (?:scope|practice))\b|n['’]t\b/i;

// key (see TYPES in practice-pages-core.mjs) -> [label, pattern, short name]. Patterns are read against a firm's description, its listed focus areas and the areas on its own site.
// The short name is how another firm's profile is said to "also mention" the matter.
export const MATTERS = {
  criminal: [
    ['Impaired driving and roadside sanctions', /impaired|\bDUI\b|\bDWI\b|breath(?:alyzer| ?test| sample)|over 80|roadside (?:suspension|sanction|screening)|drunk driving/i, 'impaired driving'],
    ['Assault and other violent charges', /(?<!sexual )\bassaults?\b|violent (?:offen[cs]e|crime|charge)|homicide|murder|manslaughter|weapons? (?:charge|offen[cs]e)/i, 'assault and violent offences'],
    ['Sexual offences', /sexual (?:assault|offen[cs]e|abuse|interference|exploitation)/i, 'sexual offences'],
    ['Drug offences', /\bdrug (?:offen[cs]e|charge|trafficking|possession|crime)|\bdrugs?\b(?!-impaired)|traffick|narcotic|controlled substance|cannabis|possession for the purpose/i, 'drug offences'],
    ['Theft, fraud and white-collar charges', /\bfraud|\btheft\b|white[- ]collar|shoplifting|embezzlement|break(?:ing)? and enter/i, 'theft and fraud'],
    ['Bail and release', /\bbail\b|release hearing|show cause/i, 'bail'],
    ['Domestic and family violence charges', /domestic (?:assault|violence|abuse)|family violence|intimate partner|peace bond/i, 'domestic violence'],
    ['Youth charges', /youth (?:criminal|justice|charge)|young offender|young person/i, 'youth charges'],
    ['Criminal appeals', /criminal appeals?|conviction (?:or sentence )?appeals?|sentence appeals?|appellate/i, 'appeals'],
  ],
  family: [
    ['Divorce', /divorce/i, 'divorce'],
    ['Parenting, custody and access', /custody|parenting|parental|decision-making responsibility|child access|access to (?:the )?children/i, 'parenting and custody'],
    ['Child and spousal support', /child support|spousal support|\balimony|support (?:order|claim|variation)|support payments|maintenance order/i, 'support'],
    ['Division of property', /property division|division of (?:family |matrimonial )?property|matrimonial property|equalization|asset division|family property/i, 'property division'],
    ['Separation agreements and marriage contracts', /separation agreement|marriage contract|prenup|cohabitation agreement|domestic contract/i, 'separation agreements'],
    ['Adoption and guardianship', /adoption|surrogacy|guardianship|assisted reproduction|step-?parent/i, 'adoption and guardianship'],
    ['Protection orders and family violence', /protection order|restraining order|family violence|domestic violence|intimate partner/i, 'protection orders'],
  ],
  injury: [
    ['Car and other motor vehicle accidents', /motor vehicle|car accident|auto(?:mobile)? accident|vehicle accident|traffic accident|\bICBC\b|accident benefits|motorcycle|pedestrian|truck accident|\bMVA\b/i, 'motor vehicle accidents'],
    ['Slip and fall and premises injuries', /slip[- ]and[- ]fall|trip and fall|occupiers|premises liability/i, 'slip and fall'],
    ['Serious and catastrophic injuries', /catastrophic|brain injur|spinal|serious injur|concussion|traumatic/i, 'serious injuries'],
    ['Long-term disability and insurance claims', /long[- ]term disability|disability (?:claim|benefit|insurance)|\bLTD\b|insurance (?:claim|denial|dispute)|critical illness/i, 'disability and insurance claims'],
    ['Medical negligence', /medical (?:malpractice|negligence)|malpractice|clinical negligence/i, 'medical negligence'],
    ['Wrongful death', /wrongful death|fatal accident|fatal(?:ity|ities)?\b/i, 'wrongful death'],
  ],
  immigration: [
    ['Express Entry and permanent residence', /express entry|permanent residen|provincial nominee|\bPNP\b|skilled worker|economic (?:class|immigration)/i, 'permanent residence'],
    ['Work permits', /work permit|\bLMIA\b|post-graduation|temporary foreign worker/i, 'work permits'],
    ['Study permits and visitor visas', /study permit|student visa|visitor visa|super visa|temporary resident visa/i, 'study permits and visitor visas'],
    ['Family sponsorship', /sponsor|spousal|family class|parents and grandparents|\bPGP\b/i, 'family sponsorship'],
    ['Refugee and humanitarian claims', /refugee|asylum|humanitarian|protected person|\bPRRA\b/i, 'refugee and humanitarian claims'],
    ['Appeals and judicial review', /judicial review|appeal division|\bIAD\b|federal court/i, 'appeals and judicial review'],
    ['Citizenship', /citizenship/i, 'citizenship'],
    ['Business and investor immigration', /business immigration|start-?up visa|investor|entrepreneur|intra-company|corporate immigration/i, 'business immigration'],
    ['Inadmissibility and removal', /inadmissib|removal order|deportation|criminal rehabilitation|misrepresentation|temporary resident permit/i, 'inadmissibility'],
  ],
  employment: [
    ['Wrongful dismissal and severance', /wrongful dismissal|wrongful termination|severance|without cause|constructive dismissal/i, 'dismissal and severance'],
    ['Employment contracts and agreements', /employment (?:contract|agreement)|non-?compete|restrictive covenant/i, 'employment contracts'],
    ['Harassment and discrimination', /harass|discriminat|human rights|workplace bullying/i, 'harassment and discrimination'],
    ['Advice for employers', /(?:acts?|advis(?:es|e|ing)|represent(?:s|ing)?|work(?:s|ing)? (?:with|for)|counsel(?:s|ling)?|serv(?:es|ing)) (?:for )?(?:employers|businesses)|employer-side|for employers/i, 'advice for employers'],
    ['Workers’ compensation and disability', /workers['’]? compensation|\bWCB\b|\bWSIB\b|\bCNESST\b|disability accommodation|long[- ]term disability/i, 'workers’ compensation'],
    ['Overtime and unpaid wages', /overtime|unpaid wages|wage claim|employment standards/i, 'overtime and wages'],
    ['Labour and union matters', /labour (?:relations|arbitration)|\bunions?\b|collective agreement|grievance/i, 'labour and union matters'],
  ],
  realestate: [
    ['Buying or selling a home', /purchase|buying|selling|residential (?:real estate|transaction|purchase|sale)|resale|conveyanc|sale of (?:a |your )?(?:home|property|house)/i, 'home purchases and sales'],
    ['Mortgages and refinancing', /mortgage|refinanc|private lending/i, 'mortgages'],
    ['Title, closings and conveyancing', /title (?:insurance|search|transfer|issue)|closing|conveyanc|land titles?|deeds?\b/i, 'title and closings'],
    ['Condominiums and new builds', /condo|strata|pre-?construction|new (?:home|build|construction)|builders?\b|developers?\b/i, 'condominiums and new builds'],
    ['Commercial real estate and leasing', /commercial (?:real estate|lease|leasing|propert)|commercial transactions/i, 'commercial real estate'],
    ['Landlords and tenants', /landlord|tenan(?:t|cy)|evict/i, 'landlord and tenant matters'],
    ['Property disputes and liens', /real estate (?:dispute|litigation)|failed closing|specific performance|property dispute|boundary|easement|construction lien|builders['’]? lien|foreclos/i, 'property disputes'],
  ],
  wills: [
    ['Wills', /\bwills?\b/i, 'wills'],
    ['Powers of attorney and incapacity planning', /power(?:s)? of attorney|enduring|personal directive|representation agreement|incapacity|protective mandate|health care directive|living will/i, 'powers of attorney'],
    ['Probate and estate administration', /probate|estate administration|administration of (?:an )?estates?|estate trustee|executor|letters of administration|estate settlement|estate matters/i, 'probate'],
    ['Trusts and estate planning', /\btrusts?\b|estate planning|succession|inheritance/i, 'trusts and estate planning'],
    ['Estate disputes', /estate (?:litigation|dispute)|contest(?:ed|ing)? (?:a |the )?will|will challenge|dependants['’]? relief|wills? variation|undue influence|testamentary capacity/i, 'estate disputes'],
  ],
  litigation: [
    ['Contract and business disputes', /contract dispute|breach of contract|commercial (?:dispute|litigation)|business dispute|shareholder dispute|partnership dispute|oppression/i, 'contract disputes'],
    ['Debt collection and creditor rights', /debt collection|collections|creditor|receivership|bankruptcy|insolven|enforcement of judgments?|judgment enforcement/i, 'debt collection'],
    ['Construction and lien disputes', /construction (?:lien|dispute|law|litigation)|builders['’]? lien|\bliens?\b/i, 'construction disputes'],
    ['Real estate and property disputes', /real estate (?:dispute|litigation)|property dispute|landlord/i, 'property disputes'],
    ['Insurance disputes', /insurance (?:dispute|claim|coverage|litigation)/i, 'insurance disputes'],
    ['Estate disputes', /estate (?:litigation|dispute)/i, 'estate disputes'],
    ['Class actions', /class action/i, 'class actions'],
    ['Defamation and professional negligence', /defamation|professional negligence|malpractice|libel/i, 'defamation and professional negligence'],
    ['Appeals and judicial review', /\bappeals?\b|judicial review|administrative law/i, 'appeals and judicial review'],
  ],
  business: [
    ['Incorporating and starting a business', /incorporat|start-?up|new business|business formation|corporate structur|registering a business/i, 'incorporation'],
    ['Contracts and commercial agreements', /\bcontracts?\b|commercial agreements?|agreement drafting/i, 'contracts'],
    ['Buying and selling a business', /mergers?|acquisitions?|buying (?:or selling )?a business|sale of (?:a )?business|business sales|purchase of (?:a )?business|\bM&A\b|due diligence/i, 'buying and selling a business'],
    ['Shareholder agreements and governance', /shareholder|partnership agreement|corporate governance|minute books?|corporate (?:records|reorganization)/i, 'shareholder agreements'],
    ['Commercial leases', /commercial leas/i, 'commercial leases'],
    ['Intellectual property and trademarks', /intellectual property|trade-?marks?|copyright|patent/i, 'intellectual property'],
    ['Franchising', /franchis/i, 'franchising'],
    ['Tax planning and succession', /tax planning|succession|estate freeze|corporate tax/i, 'tax planning'],
  ],
  traffic: [
    ['Speeding and photo radar', /speeding|photo radar|speed (?:ticket|limit|violation)/i, 'speeding'],
    ['Stunt driving and excessive speed', /stunt|excessive speed|street rac/i, 'stunt driving'],
    ['Careless and dangerous driving', /careless|dangerous driving|reckless/i, 'careless driving'],
    ['Demerit points and licence suspensions', /demerit|suspension|licen[cs]e (?:suspension|reinstatement)|points/i, 'licence suspensions'],
    ['Distracted driving and seat belts', /distracted|cell ?phone|seat ?belt/i, 'distracted driving'],
  ],
};

// The sentences a profile says about what the firm does: its description (the researched copy when there is one), then the focus areas it lists and the areas on its own site.
export function matterSentences(f, { copy = {}, details = {} } = {}) {
  const d = cleanDetails(f.details || details[f.slug]) || {};
  return [...splitSentences(String(copy[f.slug] || f.about || '')), ...[...(f.tags || []), ...(d.areas || [])].filter(Boolean)];
}

// Does the profile mention the matter, in a sentence that does not say the firm does not do it?
export const mentions = (sentences, re) => sentences.some((s) => re.test(s) && !NEGATED.test(s));

// The facts a profile holds about a firm, in one line. Only things we hold: the Google rating and reviews, when it was founded, how many lawyers it lists, the languages it works in.
export function matterFacts(f, { stored = {}, details = {} } = {}) {
  const d = cleanDetails(f.details || details[f.slug]) || {};
  const lw = lawyersOf({ ...f, lawyers: f.lawyers || stored[f.slug] });
  const out = [];
  out.push(Number(f.rating) > 0 && Number(f.count) > 0 ? `${Number(f.rating).toFixed(1)} from ${Number(f.count).toLocaleString('en-CA')} Google reviews` : 'No Google rating yet');
  if (d.founded) out.push(`Founded in ${d.founded}`);
  if (lw.length >= 2) out.push(`${lw.length} lawyers listed`); // lawyersOf is empty for a firm with fewer than two lawyers
  if (d.languages && d.languages.length) out.push(`Works in ${d.languages.join(', ').replace(/, ([^,]*)$/, ' and $1')}`);
  return out.slice(0, 4);
}

// The rows of the table for one city and practice. `list` is the page's firms in the order of its table. A row shows up to PER_ROW of the firms that mention the matter, in
// that order; a firm already shown in an earlier row is passed over (unless the row would be left short) so that more of the firms are seen, not the same few every time.
// Each firm also carries the other kinds of matter in the table that its profile mentions.
export function matterRows(key, list, ctx = {}) {
  const defs = MATTERS[key];
  if (!defs) return [];
  const hit = new Map(list.map((f) => { const s = matterSentences(f, ctx); return [f.slug, defs.map(([, re]) => mentions(s, re))]; }));
  const found = defs.map(([label, , short], i) => ({ i, label, short, firms: list.filter((f) => hit.get(f.slug)[i]) })).filter((r) => r.firms.length);
  if (found.length < MIN_ROWS) return [];
  // the kinds of matter most firms mention first; ties keep the order above
  const rows = [...found].sort((a, b) => b.firms.length - a.firms.length || a.i - b.i).slice(0, MAX_ROWS);
  const shown = new Set();
  return rows.map((r) => {
    const pick = r.firms.filter((f) => !shown.has(f.slug)).slice(0, PER_ROW);
    for (const f of r.firms) if (pick.length < PER_ROW && !pick.includes(f)) pick.push(f);
    pick.sort((a, b) => r.firms.indexOf(a) - r.firms.indexOf(b)); // back into the order of the table
    for (const f of pick) shown.add(f.slug);
    return {
      label: r.label,
      total: r.firms.length,
      firms: pick.map((f) => ({ firm: f, also: found.filter((o) => o.i !== r.i && hit.get(f.slug)[o.i]).map((o) => o.short).slice(0, 3) })),
    };
  });
}
