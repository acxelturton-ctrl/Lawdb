// Finds the awards and rankings a firm reports on its own website (read by research-gather.mjs) and stores one sentence per firm in data/firm-research.json (`siteAwards`).
//   node scripts/research-awards.mjs <site-dir>
// Only recognition of the FIRM from an independent ranking guide counts (Best Law Firms, Chambers, The Legal 500, Lexpert, Canadian Lawyer, Benchmark, Doyle's, Who's Who
// Legal, the Globe and Mail's Canada's Best Law Firms report), with a year from 2018 on, in a sentence that is about the firm and not about one lawyer; paid badges and
// directories never count. The sentence says that the firm's website reports it, because LawDB has not checked it with the issuer.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AWARD_ISSUER_BAD, splitSentences } from './lib/research.mjs';
import { loadSiteFirms } from './lib/site-firms.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/research-awards.mjs <site-dir>'); process.exit(1); }
const FILE = 'data/firm-research.json';
const research = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

const ISSUERS = [
  [/best\s+law\s+firms/i, 'Best Law Firms in Canada', 'firm'],
  [/best\s+lawyers/i, 'Best Lawyers in Canada', 'person'],
  [/lexpert/i, 'Lexpert', 'person'],
  [/chambers\s+(?:canada|global|and\s+partners|&\s+partners)|chambers\s+\d{4}|ranked\s+(?:in|by)\s+chambers/i, 'Chambers Canada', 'firm'],
  [/legal\s*500/i, 'The Legal 500 Canada', 'firm'],
  [/canadian\s+lawyer/i, 'Canadian Lawyer', 'firm'],
  [/benchmark\s+(?:litigation|canada)/i, 'Benchmark Litigation Canada', 'firm'],
  [/doyle/i, "Doyle's Guide", 'firm'],
  [/who'?s\s+who\s+legal/i, "Who's Who Legal", 'person'],
  [/canada'?s\s+best\s+law\s+firms|globe\s+and\s+mail/i, "the Globe and Mail's Canada's Best Law Firms report", 'firm'],
];
// a sentence about one or several lawyers, not the firm
const PERSON = /\b(?:rising\s+stars?|leading\s+(?:lawyers?|practitioners?)|40\s+under|lawyer\s+of\s+the\s+year|ones\s+to\s+watch|named\s+(?:one\s+of|a|as)\s+(?:\w+\s+){0,2}(?:lawyer|partner)|(?:he|she|his|her)\b|\b(?:partners?|associates?|counsel|lawyers?|litigators?|practitioners?)\b[^.]{0,60}\b(?:named|recogni[sz]ed|selected|honou?red|ranked|listed|included|recommended)|\b(?:\d+|several|many|multiple|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:of\s+(?:our|its)\s+)?(?:lawyers?|partners?|attorneys?)\b|\bindividual\b)/i;
const FIRMCUE = /\b(?:the|our)\s+firm\b|\bwe\s+(?:are|have|were|ranked|received)\b|\bfirm\s+(?:is|was|has|been|ranked|received)\b|\branked\b|\bfirm\s+rankings?\b|\brankings?\b/i;
const YEAR = /\b(20(?:1[89]|2[0-9]))\b/g;

const join = (a) => (a.length <= 1 ? a[0] || '' : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
let read = 0, found = 0;
const samples = [];
for (const f of loadSiteFirms()) {
  const file = `${dir}/${f.slug}.json`;
  if (!existsSync(file)) continue;
  read++;
  const site = JSON.parse(readFileSync(file, 'utf8'));
  const firmTok = f.name.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length > 3 && !/^(?:law|firm|llp|lawyers?|barristers|solicitors|professional|corporation|office|group|associates|avocats?)$/.test(w))[0];
  const byIssuer = new Map();
  for (const page of site.pages) {
    for (const line of page.text.split('\n')) {
      if (line.length > 600) continue;
      for (const s of splitSentences(line)) {
        if (s.length < 20 || s.length > 320 || AWARD_ISSUER_BAD.test(s)) continue;
        const years = [...new Set([...s.matchAll(YEAR)].map((m) => m[1]))];
        if (!years.length) continue;
        const issuer = ISSUERS.find(([re]) => re.test(s));
        if (!issuer) continue;
        const named = firmTok && new RegExp(`\\b${firmTok}\\b`, 'i').test(s);
        if (!(named || FIRMCUE.test(s))) continue;
        // Best Lawyers and Lexpert list individual lawyers: they count only as a firm ranking ("Best Law Firms") or when the sentence is plainly about the firm
        if (PERSON.test(s) && !(issuer[2] === 'firm' && /\bfirm\b/i.test(s) && !/\blawyers?\b/i.test(s))) continue;
        if (issuer[2] === 'person' && !/\bfirm\b|\bLLP\b/i.test(s)) continue;
        const key = issuer[1];
        const e = byIssuer.get(key) || { issuer: key, years: new Set(), sentence: s, url: page.url };
        years.forEach((y) => e.years.add(y));
        byIssuer.set(key, e);
      }
    }
  }
  if (!byIssuer.size) continue;
  const items = [...byIssuer.values()].map((e) => ({ issuer: e.issuer, years: [...e.years].sort().slice(-3), sentence: e.sentence.slice(0, 260), url: e.url })).slice(0, 3);
  const sentence = `The firm's website reports rankings or recognition from ${join(items.map((i) => `${i.issuer} (${i.years.join(', ')})`))}.`;
  const r = research[f.slug] || { name: f.name, city: f.city, province: f.province, website: f.website || '' };
  r.siteAwards = { sentence, items, at: new Date().toISOString().slice(0, 10) };
  research[f.slug] = r;
  found++;
  if (samples.length < 14) samples.push(`${f.name} (${f.city}) -> ${sentence}\n     e.g. "${items[0].sentence.slice(0, 160)}"`);
}
writeFileSync(FILE, JSON.stringify(Object.fromEntries(Object.entries(research).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + '\n');
console.log(`${read} sites read; ${found} report a firm-level ranking or award from an independent guide`);
console.log(samples.join('\n'));
