// Stores the researched paragraphs (written by hand from what the web research found, one JSON file per batch) in data/firm-research.json, keyed by firm.
//   node scripts/research-ingest.mjs <ids.json> <additions.json> [...]
// <ids.json> maps the short row ids that were sent to the researcher ("T001") to firm slugs. An additions file is
//   { "T001": { "addition": "...", "awards": "name; issuer; year; url | ...", "sources": "https://... https://...", "founded": "1999" } }
// where `sources` are the pages the facts came from (research-verify.mjs reads them again and checks the paragraph against them) and `awards` lists each independent
// award or ranking used ('None found' if none). A firm already in the file is replaced (its old verdict is dropped so it is checked again).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadSiteFirms } from './lib/site-firms.mjs';

const [idsFile, ...inputs] = process.argv.slice(2);
if (!idsFile || !inputs.length) { console.error('usage: node scripts/research-ingest.mjs <ids.json> <additions.json> [...]'); process.exit(1); }
const ids = JSON.parse(readFileSync(idsFile, 'utf8'));
const FILE = 'data/firm-research.json';
const research = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const firms = new Map(loadSiteFirms().map((f) => [f.slug, f]));

let stored = 0;
for (const file of inputs) {
  for (const [id, r] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
    const slug = ids[id], f = firms.get(slug);
    if (!f) { console.error(`unknown id ${id} in ${file}`); continue; }
    research[slug] = { name: f.name, city: f.city, province: f.province, website: f.website || '', addition: String(r.addition || '').trim(), awards: String(r.awards || 'None found'), sources: String(r.sources || ''), founded: String(r.founded || ''), evidence: String(r.evidence || ''), researched: new Date().toISOString().slice(0, 10) };
    stored++;
  }
}
writeFileSync(FILE, JSON.stringify(Object.fromEntries(Object.entries(research).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + '\n');
console.log(`${stored} paragraphs stored; ${Object.keys(research).length} firms in ${FILE}`);
