// Two steps around the person (or agent) that reads a firm's pages and proposes "At a glance" facts.
//   node scripts/extract-firm-details.mjs prepare <raw-dir> <chunks-dir>        writes chunk-NN.json files (the pages to read, 20 firms each)
//   node scripts/extract-firm-details.mjs verify  <raw-dir> <proposals-dir> [out.json]
//        reads proposal files ([{ slug, founded, languages, lawyers, areas, serving }, each fact with the exact "quote" it was taken from)
//        and keeps a fact ONLY if its quote appears word for word in what the firm's own pages say and the fact itself is in the quote.
//        Result: { slug: details } (default data/firm-details.json), cleaned by src/lib/details.js.
// A fact nobody can point to on the firm's page never reaches a profile.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { cleanDetails } from '../src/lib/details.js';

const [mode, rawDir, dir3, outArg] = process.argv.slice(2);
if (!['prepare', 'verify'].includes(mode) || !rawDir || !dir3) { console.error('usage: extract-firm-details.mjs prepare <raw-dir> <chunks-dir> | verify <raw-dir> <proposals-dir> [out.json]'); process.exit(1); }

const batchFirms = [];
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) batchFirms.push(...JSON.parse(readFileSync(`data/${file}`, 'utf8')));
const rawOf = (slug) => { const p = `${rawDir}/${slug}.json`; return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };

if (mode === 'prepare') {
  mkdirSync(dir3, { recursive: true });
  const recs = [];
  for (const f of batchFirms) {
    const r = rawOf(f.slug);
    if (!r || !r.ok || !r.pages.length) continue;
    let budget = 6500;
    const pages = [];
    for (const p of r.pages.slice().sort((a, b) => (a.kind === 'team' ? -1 : 0) - (b.kind === 'team' ? -1 : 0))) {
      const text = p.text.slice(0, Math.min(2600, budget)); budget -= text.length;
      pages.push({ kind: p.kind, headings: p.heads.slice(0, 45), text });
      if (budget <= 0) break;
    }
    recs.push({ slug: f.slug, name: f.name, city: f.city, province: f.province, tags: f.tags, persons: r.persons, pages });
  }
  for (let i = 0; i < recs.length; i += 20) writeFileSync(`${dir3}/chunk-${String(i / 20 + 1).padStart(2, '0')}.json`, JSON.stringify(recs.slice(i, i + 20)));
  console.log(`${recs.length} firms with pages to read, in ${Math.ceil(recs.length / 20)} chunks`);
  process.exit(0);
}

// ---- verify
const norm = (s) => String(s).toLowerCase().replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const corpusOf = (r) => norm([...r.pages.map((p) => p.heads.join(' | ') + ' ' + p.text), r.persons.join(' | ')].join(' '));
const proposals = new Map();
for (const f of readdirSync(dir3).filter((x) => /\.json$/.test(x)).sort()) for (const p of JSON.parse(readFileSync(`${dir3}/${f}`, 'utf8'))) proposals.set(p.slug, p);

const stats = { firms: 0, facts: 0, kept: 0 };
const dropped = [];
const result = {};
for (const [slug, p] of proposals) {
  const r = rawOf(slug);
  if (!r || !r.ok) continue;
  const corpus = corpusOf(r);
  stats.firms++;
  const proven = (item, term, why) => {
    stats.facts++;
    const q = norm(item?.quote || '');
    if (q.length < 6 || !corpus.includes(q)) { dropped.push(`${slug}: ${why}: quote not on the page: ${String(item?.quote).slice(0, 60)}`); return false; }
    if (!q.includes(norm(term))) { dropped.push(`${slug}: ${why}: "${term}" not in its quote`); return false; }
    stats.kept++;
    return true;
  };
  const stem = (w) => norm(w).slice(0, 5);
  const d = {
    founded: p.founded && Number.isInteger(Number(p.founded.year)) && proven(p.founded, String(p.founded.year), 'founded') ? Number(p.founded.year) : undefined,
    languages: (p.languages || []).filter((l) => proven(l, l.name, 'language')).map((l) => l.name),
    lawyers: (p.lawyers || []).filter((l) => proven(l, l.name, 'lawyer') && (!l.title || norm(l.quote).includes(norm(l.title)) || corpus.includes(norm(l.title)))).map((l) => ({ name: l.name, ...(l.title && norm(l.quote).includes(norm(l.title)) ? { title: l.title } : {}) })),
    areas: (p.areas || []).filter((a) => {
      const words = String(a.label || '').split(/\s+/).filter((w) => w.length >= 4);
      const q = norm(a.quote || '');
      return proven(a, words[0] || a.label || '', 'area') && words.every((w) => q.includes(stem(w)));
    }).map((a) => a.label),
    serving: (p.serving || []).filter((s) => proven(s, s.place, 'place')).map((s) => s.place),
  };
  const clean = cleanDetails(d);
  if (clean) result[slug] = clean;
}
const out = outArg || 'data/firm-details.json';
const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(out, JSON.stringify(sorted, null, 1) + '\n');
console.log(`${stats.firms} firms read, ${stats.facts} facts proposed, ${stats.kept} proven by their quote, details for ${Object.keys(sorted).length} firms -> ${out}`);
console.log(`dropped ${dropped.length}; first few:`); for (const x of dropped.slice(0, 8)) console.log('  ' + x);
