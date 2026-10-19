// Puts each firm's own written profile (data/firm-copy.json: { slug: about text }, written from what the firm says on its
// own website; see scripts/gather-site-facts.mjs) where it shows:
//  - the original hand-built firms: the <div class="article"> text on firms/<slug>.html, and the page's search description
//    (meta, Open Graph and Twitter descriptions) taken from the first sentence;
//  - firms from data/firms-batch-N.json: the batch record's `about`, so db/extra-firms.sql carries it for new rows;
//  - db/about-updates.sql: for firms already in the database, replaces the old generated text with the new text, but only
//    where the stored text is still the old generated one (a description typed in the admin area or by an owner is never replaced).
// data/firm-copy-previous.json remembers the original generated text of each firm, and data/firm-copy-history.json every later version of the
// copy that was ever committed, so the update stays safe and the script can be re-run: the database text is replaced only while it is still
// one of our own generated texts. (An update guarded by the original text alone silently skips every firm that already received an earlier
// version of the copy: that is how 363 live profiles kept the old "the website says..." wording.)
//   node scripts/apply-firm-copy.mjs          writes everything
//   node scripts/apply-firm-copy.mjs --check  fails if anything is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { aboutFromPage } from './lib/about.mjs';
import { metaFromAbout } from '../src/render/firm-page.js';
import { checkOwnerText } from '../src/lib/content-rules.js';

const CHECK = process.argv.includes('--check');
const copy = JSON.parse(readFileSync('data/firm-copy.json', 'utf8'));
const histFile = 'data/firm-copy-history.json';
const history = existsSync(histFile) ? JSON.parse(readFileSync(histFile, 'utf8')) : {};
const prevFile = 'data/firm-copy-previous.json';
const previous = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')) : {};
let stale = 0;
const write = (file, text) => {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { if (CHECK) { stale++; console.error('out of date:', file); } else writeFileSync(file, text); }
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

for (const [slug, text] of Object.entries(copy)) {
  checkOwnerText('about', text);
  if (!metaFromAbout(text)) throw new Error(`${slug}: the first sentence must be 50 to 160 characters`);
}

// 1. original firms: the page text and the search description
const known = new Set();
for (const file of readdirSync('firms').filter((f) => f.endsWith('.html'))) {
  const slug = file.replace(/\.html$/, '');
  if (!copy[slug]) continue;
  known.add(slug);
  const path = `firms/${file}`;
  let html = readFileSync(path, 'utf8');
  const m = html.match(/<div class="article">([\s\S]*?)<\/div>/);
  if (!m) throw new Error(`${slug}: no article block`);
  if (!(slug in previous)) previous[slug] = aboutFromPage(slug);
  const article = `<div class="article">${copy[slug].split(/\n{2,}/).map(esc).join('<br><br>')}</div>`;
  html = html.replace(m[0], () => article);
  const desc = esc(metaFromAbout(copy[slug]));
  html = html
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_, a, b) => a + desc + b)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_, a, b) => a + desc + b)
    .replace(/(<meta name="twitter:description" content=")[^"]*(">)/, (_, a, b) => a + desc + b);
  write(path, html);
}

// 2. batch firms
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
  const batch = JSON.parse(readFileSync(`data/${file}`, 'utf8'));
  for (const f of batch) {
    if (!copy[f.slug]) continue;
    known.add(f.slug);
    if (!(f.slug in previous)) previous[f.slug] = f.about;
    f.about = copy[f.slug];
  }
  write(`data/${file}`, JSON.stringify(batch, null, 1) + '\n');
}

// Remember the copy that is about to be replaced (the committed version), so databases that already hold it still get updated.
if (!CHECK) {
  try {
    const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:data/firm-copy.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    for (const [slug, text] of Object.entries(committed)) {
      if (copy[slug] && text !== copy[slug] && text !== previous[slug] && !(history[slug] || []).includes(text)) (history[slug] ||= []).push(text);
    }
  } catch { /* no git history here: keep the file as it is */ }
}
const sortedHistory = Object.fromEntries(Object.entries(history).filter(([slug]) => copy[slug]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
write(histFile, JSON.stringify(sortedHistory, null, 1) + '\n');

const missing = Object.keys(copy).filter((s) => !known.has(s));
if (missing.length) throw new Error('copy for unknown firms: ' + missing.slice(0, 5).join(', '));
if (!CHECK) writeFileSync(prevFile, JSON.stringify(previous, null, 1) + '\n');
else if (JSON.stringify(previous, null, 1) + '\n' !== readFileSync(prevFile, 'utf8')) { stale++; console.error('out of date:', prevFile); }

// 3. firms already in the database
const sql = ['-- Generated by scripts/apply-firm-copy.mjs from data/firm-copy.json. Do not edit by hand.'];
for (const slug of Object.keys(copy).sort()) {
  // every text we ever generated for this firm: the original, then each earlier version of the copy
  const olds = [previous[slug], ...(history[slug] || [])].filter((t) => t != null && t !== copy[slug]);
  const guard = !olds.length ? 'about IS NULL' : olds.length === 1 ? `about = ${q(olds[0])}` : `about IN (${olds.map(q).join(', ')})`;
  sql.push(`UPDATE firms SET about = ${q(copy[slug])}, updated_at = datetime('now') WHERE slug = ${q(slug)} AND ${guard};`);
}
write('db/about-updates.sql', sql.join('\n') + '\n');

if (CHECK) {
  if (stale) process.exit(1);
  console.log(`firm copy up to date: ${Object.keys(copy).length} firms`);
} else console.log(`firm copy applied to ${Object.keys(copy).length} firms`);
