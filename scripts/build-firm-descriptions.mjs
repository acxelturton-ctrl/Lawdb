// Builds every firm's description in three parts (who the firm is and what it handles, facts about it, what to do next: see scripts/lib/description.mjs) and writes it to
// data/firm-copy.json, which scripts/apply-firm-copy.mjs puts on the saved pages, the batch records and db/about-updates.sql.
//
// The facts come from data/firm-copy-base.json: the text written from each firm's own website and checked against the pages it cites (scripts/research-apply.mjs adds to it).
// A firm with no text there gets one built from its practice areas, address, phone and the details read from its website. The base is never overwritten by this script,
// so it can be run again at any time and gives the same result.
//   node scripts/build-firm-descriptions.mjs          writes data/firm-copy.json
//   node scripts/build-firm-descriptions.mjs --check  fails if the file is not what the base and the firm data make
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRepoFirms } from './lib/site-firms.mjs';
import { buildDescription } from './lib/description.mjs';
import { withoutPublicationNames } from './lib/research.mjs';
import { PROVINCES, metaFromAbout } from '../src/render/firm-page.js';
import { checkOwnerText } from '../src/lib/content-rules.js';

const CHECK = process.argv.includes('--check');
const base = JSON.parse(readFileSync('data/firm-copy-base.json', 'utf8'));
const details = JSON.parse(readFileSync('data/firm-details.json', 'utf8'));
export const MAX_LENGTH = 2000;

const out = {};
for (const f of loadRepoFirms()) {
  const text = buildDescription({ firm: f, base: base[f.slug] || '', details: details[f.slug] || f.details, provName: PROVINCES[f.province] });
  try { checkOwnerText('about', withoutPublicationNames(text)); } catch (e) { throw new Error(`${f.slug}: ${e.message} (${text.slice(0, 200).replace(/\n/g, ' / ')})`); } // the real titles of independent ranking guides are not claims
  if (!metaFromAbout(text)) throw new Error(`${f.slug}: the first sentence must be 50 to 160 characters: ${text.split(/\n/)[0].slice(0, 120)}`);
  if (text.length > MAX_LENGTH) throw new Error(`${f.slug}: ${text.length} characters, over ${MAX_LENGTH}`);
  out[f.slug] = text;
}
const sorted = JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 1) + '\n';
if (CHECK) {
  if (readFileSync('data/firm-copy.json', 'utf8') !== sorted) { console.error('out of date: data/firm-copy.json (run: node scripts/build-firm-descriptions.mjs)'); process.exit(1); }
  console.log(`firm descriptions up to date: ${Object.keys(out).length} firms`);
} else {
  writeFileSync('data/firm-copy.json', sorted);
  console.log(`firm descriptions written: ${Object.keys(out).length} firms (${Object.keys(base).length} from researched text, ${Object.keys(out).length - Object.keys(base).length} from the firm data)`);
}
