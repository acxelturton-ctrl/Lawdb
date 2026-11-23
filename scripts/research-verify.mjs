// Checks the researched paragraph of every firm (data/firm-research.json) against the pages it came from, sentence by sentence, and keeps only what holds up.
//   NODE_USE_ENV_PROXY=1 node scripts/research-verify.mjs [--redo] [--limit=N] [--cache=<dir>]
// A sentence is dropped when it breaks the advertising rules (lintText), when it speaks of an award or ranking that does not come from an independent
// issuer or cannot be found with its year on the page it cites, when a year or a figure in it is on none of the cited pages, or when most of the names in
// it are on none of them. What is left is `verdict.final`; research-apply.mjs adds it to the firm's description if it is long enough.
import { readFileSync, writeFileSync } from 'node:fs';
import { AWARD_ISSUER_BAD, AWARD_ISSUER_OK, closeBrowser, hostOf, lintText, normText, pageText, splitSentences, urlsIn } from './lib/research.mjs';

const FILE = 'data/firm-research.json';
const REDO = process.argv.includes('--redo');
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const cacheDir = (process.argv.find((a) => a.startsWith('--cache=')) || '').split('=')[1] || process.env.RESEARCH_CACHE || '/tmp/research-pages';
const research = JSON.parse(readFileSync(FILE, 'utf8'));

const AWARDISH = /\b(?:awards?|rankings?|ranked|recogni[sz]ed|recognition|named|listed|selected|honou?red|finalists?|winners?|inducted|accredited|certified|included)\b/i;
const YEAR = /\b(?:19[5-9]\d|20[0-3]\d)\b/g;
const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const GENERIC_CAPS = new Set(['co', 'founder', 'committee', 'accreditation', 'national', 'association', 'civil', 'trial', 'lawyers', 'family', 'best', 'canada', 'canadian', 'mortgage', 'professional', 'globe', 'mail', 'statista', 'employment', 'disability', 'show', 'class', 'action', 'supreme', 'federal', 'appeal', 'queen', 'king', 'bench', 'justice', 'real', 'estate', 'wills', 'estates', 'pro', 'bono', 'day', 'fund', 'giving', 'scholarship', 'legal', 'the', 'its', 'it', 'in', 'on', 'at', 'for', 'with', 'from', 'since', 'and', 'also', 'their', 'both', 'each', 'one', 'two', 'three', 'four', 'five', 'six', 'law', 'firm', 'offices', 'office', 'english', 'french', 'ontario', 'alberta', 'quebec', 'manitoba', 'canada', 'british', 'columbia', 'saskatchewan', 'nova', 'scotia', 'new', 'brunswick', 'newfoundland', 'labrador', 'prince', 'edward', 'island', 'court', 'bar', 'university', 'llp', 'inc', 'ltd', 'professional', 'corporation', 'barristers', 'solicitors']);

function parseEvidence(s) {
  return String(s || '').split(/\s*\|\|\s*/).map((item) => {
    const m = item.match(/^(https?:\/\/\S+)\s*::\s*"?([\s\S]*?)"?$/);
    return m ? { url: m[1], quote: m[2] } : null;
  }).filter(Boolean);
}
function parseAwards(s) {
  if (!s || /^none/i.test(s.trim())) return [];
  return s.split(/\s*\|\s*/).map((item) => {
    const [name, issuer, year, url] = item.split(/\s*;\s*/);
    return { name: name || '', issuer: issuer || '', year: (year || '').match(/\b(?:19|20)\d\d\b/)?.[0] || '', url: (url || '').trim() };
  }).filter((a) => a.name);
}

async function verify(slug, r) {
  const urls = [...new Set([...urlsIn(r.sources), ...urlsIn(r.evidence), ...urlsIn(r.awards)])].slice(0, 8);
  const pages = new Map();
  await Promise.all(urls.map(async (u) => pages.set(u, normText(await pageText(u, cacheDir)))));
  const evidence = parseEvidence(r.evidence);
  const quotesText = normText(evidence.map((e) => e.quote).join(' '));
  const pageAll = [...pages.values()].join(' ');
  const readable = [...pages.values()].filter(Boolean).length;
  const ownHost = hostOf(r.website ? (/^https?:/.test(r.website) ? r.website : `https://${r.website}`) : '');
  const fetchedOwn = urls.some((u) => hostOf(u) === ownHost && pages.get(u));

  // an award counts only from an independent issuer, with a year, and found on the page it cites (or, when that page cannot be read, in the quote the researcher kept from it)
  const awards = parseAwards(r.awards).map((a) => {
    const text = pages.get(a.url) || '';
    const firmTok = normText(r.name).split(' ').filter((w) => w.length > 3 && !GENERIC_CAPS.has(w))[0] || normText(r.name).split(' ')[0];
    const quote = normText(evidence.filter((e) => e.url === a.url || /award|rank|best|lexpert|chambers/i.test(e.quote)).map((e) => e.quote).join(' '));
    const nameTok = normText(a.name).split(' ').filter((w) => w.length > 3)[0] || '';
    const okIssuer = AWARD_ISSUER_OK.test(`${a.issuer} ${a.name}`) && !AWARD_ISSUER_BAD.test(`${a.issuer} ${a.name} ${a.url}`);
    const onPage = !!text && a.year && text.includes(a.year) && (!nameTok || text.includes(nameTok)) && text.includes(firmTok);
    const soft = !text && a.year && quote.includes(a.year) && (!nameTok || quote.includes(nameTok)) && quote.includes(firmTok);
    return { ...a, ok: okIssuer && (onPage || soft), mode: onPage ? 'page' : soft ? 'quote' : 'none' };
  });
  const goodAwards = awards.filter((a) => a.ok);

  const kept = [], dropped = [];
  for (const s of splitSentences(r.addition || '')) {
    const why = [];
    const bad = lintText(s);
    if (bad.length) why.push(...bad);
    if (AWARDISH.test(s)) {
      const hit = goodAwards.some((a) => normText(s).includes(normText(a.issuer).split(' ')[0] || '@@') || normText(s).includes(normText(a.name).split(' ')[0] || '@@'));
      if (!hit) why.push('award or ranking not verified');
    }
    const norm = normText(s);
    const support = `${pageAll} ${quotesText}`;
    for (const y of s.match(YEAR) || []) if (!support.includes(y)) why.push(`year ${y} on no cited page`);
    const nums = (s.match(/\b\d{2,4}\b/g) || []).filter((n) => !/^(?:19|20)\d\d$/.test(n));
    for (const n of nums) if (!support.includes(n)) why.push(`figure ${n} on no cited page`);
    // a person's name (two or three capitalised words in a row, not starting the sentence with a common word): the surname has to be on a cited page
    const NAMEISH = /(?:^|[^\wÀ-ÿ])((?:[A-ZÀ-Ý][\wÀ-ÿ'’-]+\s){1,2}([A-ZÀ-Ý][\wÀ-ÿ'’-]{2,}))(?=[^\wÀ-ÿ]|$)/g;
    const surnames = [...new Set([...s.matchAll(NAMEISH)].filter((m) => !GENERIC_CAPS.has(normText(m[1]).split(' ')[0]) && !GENERIC_CAPS.has(normText(m[2])) && !MONTHS.has(normText(m[1]).split(' ')[0])).map((m) => normText(m[2])))];
    const missing = surnames.filter((w) => w && !support.includes(w));
    if (missing.length && missing.length / surnames.length > 0.34) why.push(`names not on the pages: ${missing.slice(0, 3).join(', ')}`);
    if (!readable && !evidence.length) why.push('no page could be read');
    (why.length ? dropped.push({ s, why: [...new Set(why)] }) : kept.push(s));
  }
  const final = kept.join(' ');
  return { kept: kept.length, final, dropped, awards: awards.map(({ name, issuer, year, url, ok, mode }) => ({ name, issuer, year, url, ok, mode })), pagesRead: readable, pagesTried: urls.length, ownSite: fetchedOwn, at: new Date().toISOString().slice(0, 10) };
}

const todo = Object.entries(research).filter(([, r]) => r.addition && (REDO || !r.verdict)).slice(0, limit);
let i = 0, done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < todo.length) {
    const [slug, r] = todo[i++];
    try { r.verdict = await verify(slug, r); } catch (e) { r.verdict = { error: String(e.message || e).slice(0, 120), final: '', kept: 0, dropped: [] }; }
    if (++done % 20 === 0) { process.stdout.write('.'); writeFileSync(FILE, JSON.stringify(research, null, 1) + '\n'); }
  }
}));
await closeBrowser();
writeFileSync(FILE, JSON.stringify(research, null, 1) + '\n');
const v = Object.values(research).filter((r) => r.verdict);
const lens = v.map((r) => (r.verdict.final || '').length);
console.log(`\nverified ${todo.length} firms; ${lens.filter((n) => n >= 200).length} of ${v.length} have 200+ characters of checked text; ${lens.filter((n) => n === 0).length} have none`);
