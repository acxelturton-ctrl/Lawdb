// Adds each firm's own logo and its own one-line description to a batch file (data/firms-batch-N.json).
//   NODE_USE_ENV_PROXY=1 node scripts/enrich-firm-batch.mjs data/firms-batch-1.json [--limit=20]
// Uses the same logo finder the admin Logos tab uses (public https only, redirects re-checked, real JPEG/PNG/WebP only, SVG never).
// A logo is taken only when the website itself labels the picture a logo (or its site icon is large and square); anything else is left
// with initials for a person to choose. Pictures are saved under images/logos/ and the batch records are updated in place.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { findLogos, fetchPicture } from '../src/lib/logo-finder.js';
import { checkOwnerText } from '../src/lib/content-rules.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/enrich-firm-batch.mjs data/firms-batch-N.json [--limit=N]'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const firms = JSON.parse(readFileSync(file, 'utf8'));
const EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp' };
mkdirSync('images/logos', { recursive: true });

const decode = (s) => s.replace(/&#x27;|&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&#8211;|&ndash;/g, '-').replace(/&[a-z]+;/g, ' ');
async function description(site) {
  try {
    const res = await fetch(site, { redirect: 'follow', headers: { 'user-agent': 'LawDB-LogoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)', accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) return '';
    const html = (await res.text()).slice(0, 300_000);
    const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
    const get = (key) => {
      for (const t of meta) {
        if (new RegExp(`(?:name|property)\\s*=\\s*["']${key}["']`, 'i').test(t)) {
          const c = t.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
          if (c) return decode((c[1] ?? c[2] ?? '').replace(/\s+/g, ' ').trim());
        }
      }
      return '';
    };
    let d = get('description') || get('og:description');
    d = d.replace(/\s+/g, ' ').trim();
    if (d.length < 70 || d.length > 400) return '';
    if (d.length > 300) d = d.slice(0, 300).replace(/\s+\S*$/, '') + '...';
    checkOwnerText('description', d); // no links, markup, or claims such as "best", "#1", "guaranteed", "specialist"
    return d;
  } catch { return ''; }
}

// Google often lists a site as http://. The logo finder (like the blog-card reader) only talks to https, so use https when the site answers on it.
async function upgrade(f) {
  if (!/^http:\/\//i.test(f.website)) return;
  const https = f.website.replace(/^http:/i, 'https:');
  try { const r = await fetch(https, { redirect: 'follow', headers: { 'user-agent': 'LawDB-LogoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)' }, signal: AbortSignal.timeout(9000) }); if (r.ok) f.website = https; } catch { /* keep http */ }
}

async function one(f) {
  await upgrade(f);
  const out = { slug: f.slug, logo: false, note: '' };
  try {
    const cands = await findLogos({}, f.website);
    const pick = cands.find((c) => c.source === 'logo on the page' && c.width / c.height <= 6 && c.height / c.width <= 3)
      || cands.find((c) => c.source === 'site icon' && c.width >= 150 && Math.abs(c.width - c.height) <= 4);
    if (pick) {
      const { bytes, info } = await fetchPicture({}, pick.url);
      const ext = EXT[info.format];
      if (ext) {
        const rel = `images/logos/${f.slug}.${ext}`;
        writeFileSync(rel, bytes);
        f.type = 'logo'; f.src = rel; delete f.initials; delete f.color;
        out.logo = true; out.note = `${pick.source} ${info.width}x${info.height}`;
      }
    } else out.note = cands.length ? 'no clearly-labelled logo' : 'none found';
  } catch (e) { out.note = String(e.message || e).slice(0, 80); }
  const d = await description(f.website);
  if (d && !/In its own words/.test(f.about)) { f.about += ` In its own words: “${d}”`; out.desc = true; }
  return out;
}

// Firms whose automatic pick was checked by eye and rejected (see data/logo-rejects.txt) are left with initials.
const rejects = new Set(readFileSync(new URL('../data/logo-rejects.txt', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')));
const todo = firms.filter((f) => !f.src && !rejects.has(f.slug)).slice(0, limit);
const results = [];
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < todo.length) { const f = todo[i++]; results.push(await one(f)); process.stdout.write('.'); } }));
writeFileSync(file, JSON.stringify(firms, null, 1) + '\n');
console.log(`\nlogos ${results.filter((r) => r.logo).length}/${todo.length}, descriptions ${results.filter((r) => r.desc).length}/${todo.length}`);
for (const r of results.filter((x) => !x.logo)) console.log('  no logo:', r.slug, '-', r.note);
