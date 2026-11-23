// Adds each firm's checked research paragraph (data/firm-research.json, see research-verify.mjs) to its description in data/firm-copy-base.json.
//   node scripts/research-apply.mjs [--min=200] [--dry]
// then:  node scripts/build-firm-descriptions.mjs  (lays each description out in three parts), then node scripts/apply-firm-copy.mjs   (puts the text on the saved pages, the batch records and db/about-updates.sql)
// - the paragraph goes after the firm's existing description; for a firm that only has the plain template text (the "built from public business
//   information" wording), the template's first sentence stays first, the paragraph follows it, and the rating / office sentences come last;
// - sentences that only repeat what the description already says are left out, and a paragraph under --min characters (default 200) is not added;
// - running it again replaces the paragraph it added before instead of adding a second one (the added text is remembered in the research file).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { aboutFromPage } from './lib/about.mjs';
import { lintText, normText, splitSentences, withoutPublicationNames } from './lib/research.mjs';
import { checkOwnerText } from '../src/lib/content-rules.js';
import { metaFromAbout } from '../src/render/firm-page.js';

const MIN = Number((process.argv.find((a) => a.startsWith('--min=')) || '').split('=')[1]) || 200;
const DRY = process.argv.includes('--dry');
const RESEARCH = 'data/firm-research.json';
const research = JSON.parse(readFileSync(RESEARCH, 'utf8'));
const copy = JSON.parse(readFileSync('data/firm-copy-base.json', 'utf8'));

const batchAbout = new Map();
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f))) for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) batchAbout.set(f.slug, f.about);
const TEMPLATE = /This listing is built from public business information/;

const words = (s) => normText(s).split(' ').filter((w) => w.length >= 4);
function repeats(sentence, base) {
  const ws = words(sentence);
  if (!ws.length) return true;
  const have = new Set(words(base));
  const years = (sentence.match(/\b(?:19|20)\d\d\b/g) || []);
  return ws.filter((w) => have.has(w)).length / ws.length >= 0.7 && years.every((y) => base.includes(y));
}

// A sentence that gives a different founding year from the one the description already gives is dropped (one of the two is wrong, and the page must not say both).
const FOUNDING = /\b(?:founded|established|opened|began|started|incorporated|formed|since)\b[^.]{0,80}?\b((?:18[89]\d|19\d\d|20[0-2]\d))\b/i;
const conflicts = (sentence, base) => {
  const y = sentence.match(FOUNDING)?.[1];
  return !!y && splitSentences(base).some((b) => { const by = b.match(FOUNDING)?.[1]; return by && by !== y; });
};
let applied = 0, short = 0, none = 0, awardsUsed = 0, conflicting = 0;
const byProvince = {}, samples = [];
for (const [slug, r] of Object.entries(research)) {
  if (!r.verdict && !r.siteAwards) continue;
  // the text without any paragraph this script added earlier
  let existing = copy[slug] ?? batchAbout.get(slug) ?? aboutFromPage(slug) ?? '';
  if (r.applied) existing = existing.replace(`\n\n${r.applied}`, '').replace(r.applied, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!existing) { none++; continue; }
  const fresh = splitSentences(r.verdict?.final || '').filter((s) => !repeats(s, existing) && !(conflicts(s, existing) && ++conflicting));
  // what the firm's own website reports about independent rankings (research-awards.mjs): short, but worth adding on its own
  const award = r.siteAwards?.sentence && !/best lawyers|best law firms|chambers|legal 500|lexpert|canadian lawyer|benchmark|doyle/i.test(existing) ? r.siteAwards.sentence : '';
  const addition = [...fresh, award].filter(Boolean).join(' ');
  if (addition.length < MIN && !award) { short++; if (r.applied) { copy[slug] = existing; delete r.applied; } continue; }
  let text;
  if (TEMPLATE.test(existing)) {
    const parts = splitSentences(existing);
    text = `${parts[0]}\n\n${addition}\n\n${parts.slice(1).join(' ')}`;
  } else text = `${existing}\n\n${addition}`;
  const problems = [...lintText(addition), ...(() => { try { checkOwnerText('about', withoutPublicationNames(text)); return []; } catch (e) { return [e.message.slice(0, 80)]; } })()];
  if (!metaFromAbout(text)) problems.push('first sentence is not 50 to 160 characters');
  if (text.length > 1900) problems.push('text over 1,900 characters');
  if (problems.length) { short++; console.error(`${slug}: not added (${problems.join('; ')})`); continue; }
  copy[slug] = text; r.applied = addition; applied++;
  byProvince[r.province] = (byProvince[r.province] || 0) + 1;
  if (award || r.verdict?.awards?.some((a) => a.ok)) awardsUsed++;
  if (samples.length < 4 && Math.random() < 0.05) samples.push(`${r.name} (${r.city}, ${r.province}):\n${addition}`);
}
if (!DRY) {
  writeFileSync('data/firm-copy-base.json', JSON.stringify(Object.fromEntries(Object.entries(copy).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 1) + '\n');
  writeFileSync(RESEARCH, JSON.stringify(research, null, 1) + '\n');
}
console.log(`${DRY ? '(dry run) ' : ''}added a paragraph to ${applied} descriptions (${awardsUsed} mention an independent award or ranking); ${short} had under ${MIN} characters of checked new text or failed a rule; ${none} had no description to add to; ${conflicting} sentence(s) left out because they gave a different founding year from the description`);
console.log(Object.entries(byProvince).sort().map(([p, n]) => `${p} ${n}`).join(', '));
for (const s of samples) console.log(`\n${s}`);
