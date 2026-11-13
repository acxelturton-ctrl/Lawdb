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
// Practice areas read from the firm's own home page (title, description, headings, menu links), for firms whose Google category is only "Attorney" or "Law firm".
const KINDS = [
  ['family', 'Family Law', /family law|divorce|separation agreement|child custody|child support|droit de la famille|divorce|s[ée]paration/],
  ['realestate', 'Real Estate', /real estate|conveyanc|property transaction|buying or selling (a )?(home|property)|droit immobilier|immobilier/],
  ['wills', 'Wills & Estates', /\bwills?\b|estate planning|estate administration|estate litigation|probate|power of attorney|succession|testament/],
  ['injury', 'Personal Injury', /personal injury|accident|injur|blessures corporelles|long[- ]term disability/],
  ['criminal', 'Criminal Defence', /criminal (law|defen[cs]e)|\bdui\b|impaired driving|droit criminel|droit p[ée]nal|d[ée]fense p[ée]nale/],
  ['immigration', 'Immigration', /immigration|citizenship|refugee|work permit|study permit/],
  ['employment', 'Employment Law', /employment law|wrongful dismissal|labou?r (and employment )?law|workplace|droit du travail|droit de l'emploi/],
  ['business', 'Business Law', /business law|corporate (law|and commercial)|commercial law|incorporation|shareholder|droit des affaires|droit commercial|droit corporatif/],
  ['litigation', 'Litigation', /litigation|dispute resolution|civil (disputes|claims)|contentieux|litige/],
  ['traffic', 'Traffic Tickets', /traffic (ticket|court|violation)|provincial offences?/],
];
function inferKinds(html) {
  const text = [
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '',
    ...[...html.matchAll(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:description|og:description|og:title)["'][^>]*>/gi)].map((m) => (m[0].match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i) || [])[1] || ''),
    ...[...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0, 25).map((m) => m[1]),
    ...[...html.matchAll(/<a\b[^>]*>([\s\S]{2,60}?)<\/a>/gi)].slice(0, 80).map((m) => m[1]),
  ].join(' \n ').replace(/<[^>]+>/g, ' ').toLowerCase();
  return KINDS.map(([k, label, rx]) => [k, label, (text.match(new RegExp(rx.source, 'g')) || []).length]).filter((x) => x[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 4);
}
let lastKinds = new Map();
async function description(site) {
  try {
    const res = await fetch(site, { redirect: 'follow', headers: { 'user-agent': 'LawDB-LogoFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)', accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) return '';
    const html = (await res.text()).slice(0, 300_000);
    lastKinds.set(site, inferKinds(html));
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
  if (!(f.caseTypes || []).length) {
    const ks = lastKinds.get(f.website) || [];
    if (ks.length) {
      f.caseTypes = ks.map((x) => x[0]); f.tags = ks.map((x) => x[1]);
      const al = f.tags.slice(0, 3).map((t) => (t === 'Wills & Estates' ? 'wills and estates' : t.toLowerCase().replace(/ law$/, '')));
      const area = al.length < 2 ? al[0] : al.slice(0, -1).join(', ') + ' and ' + al[al.length - 1];
      f.about = f.about.replace(/^(.*? is a law firm in [^,]+, [^.]*?)\./, `$1 that practises ${area}.`);
      f.blurb = `${f.tags.slice(0, 2).join(' / ')} in ${f.city}. ${(f.blurb.match(/Rated .*$/) || [''])[0]}`.trim();
      out.kinds = f.caseTypes.join('+');
    }
  }
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
console.log(`\nlogos ${results.filter((r) => r.logo).length}/${todo.length}, descriptions ${results.filter((r) => r.desc).length}/${todo.length}, practice areas read from the site ${results.filter((r) => r.kinds).length}`);
for (const r of results.filter((x) => !x.logo)) console.log('  no logo:', r.slug, '-', r.note);
