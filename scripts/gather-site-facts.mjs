// Reads what each firm says about itself on its own public website, for writing one-of-a-kind profile text.
//   NODE_USE_ENV_PROXY=1 node scripts/gather-site-facts.mjs <out-dir> [--limit=N]
// For every firm (the original 370 and every data/firms-batch-N.json) it fetches the home page and up to three
// inner pages that look like About / Practice areas / Team / Services pages (public https only, same site only), and
// writes <out-dir>/<slug>.json with the page title, description, headings, structured-data facts and a few hundred
// words of plain page text. Nothing is stored in the repository; the facts are only the input for the copy.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/gather-site-facts.mjs <out-dir> [--limit=N]'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
mkdirSync(out, { recursive: true });
const UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';

const firms = JSON.parse(readFileSync('firms_data.json', 'utf8')).map((f) => ({ slug: f.slug, name: f.name, city: f.city, province: f.province, website: f.website, tags: f.tags || [] }));
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.push({ slug: f.slug, name: f.name, city: f.city, province: f.province, website: f.website, tags: f.tags || [] });
}

const decode = (s) => s.replace(/&#x27;|&#039;|&#0?39;|&apos;|&rsquo;|&#8217;|&lsquo;/g, "'").replace(/&amp;/g, '&').replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, ' ');
const clean = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(String(res.status));
  if (!/html/i.test(res.headers.get('content-type') || 'html')) throw new Error('not html');
  return { html: (await res.text()).slice(0, 700_000), url: res.url };
}

function meta(html, key) {
  for (const t of html.match(/<meta\b[^>]*>/gi) || []) {
    if (new RegExp(`(?:name|property)\\s*=\\s*["']${key}["']`, 'i').test(t)) {
      const c = t.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
      if (c) return clean(c[1] ?? c[2] ?? '');
    }
  }
  return '';
}

function structured(html) {
  const facts = {};
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    const nodes = Array.isArray(data) ? data : data['@graph'] || [data];
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      for (const k of ['foundingDate', 'description', 'slogan', 'areaServed', 'knowsLanguage', 'priceRange', 'numberOfEmployees']) {
        if (n[k] && !facts[k]) facts[k] = typeof n[k] === 'string' ? clean(n[k]).slice(0, 300) : JSON.stringify(n[k]).slice(0, 300);
      }
    }
  }
  return facts;
}

function readable(html) {
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [html])[0]
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  const heads = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(m[2])).filter((t) => t.length > 3 && t.length < 120);
  const paras = [...body.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2])).filter((t) => t.length > 40 && !/cookie|copyright|all rights reserved|privacy policy|terms of use|©/i.test(t));
  return { heads: [...new Set(heads)].slice(0, 25), paras: [...new Set(paras)] };
}

const WANT = /(about|who-we|our-firm|firm|practice|areas|services|what-we|team|lawyer|attorney|people|profile|story|why)/i;
const SKIP = /(blog|news|article|post|contact|privacy|terms|disclaimer|login|career|\.pdf|tag|category|\/20\d\d\/|wp-content|sitemap)/i;

function innerLinks(html, base) {
  const origin = new URL(base).origin;
  const seen = new Set();
  const found = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], base); } catch { continue; }
    if (u.origin !== origin || u.protocol !== 'https:' || u.pathname === '/' || seen.has(u.pathname)) continue;
    const label = clean(m[2]);
    if (SKIP.test(u.pathname) || !(WANT.test(u.pathname) || WANT.test(label))) continue;
    if (u.pathname.split('/').filter(Boolean).length > 2) continue;
    seen.add(u.pathname);
    found.push({ url: u.origin + u.pathname, label: label.slice(0, 60), rank: /about|firm|who-we|story/i.test(u.pathname + label) ? 0 : /practice|areas|services/i.test(u.pathname + label) ? 1 : 2 });
  }
  return found.sort((a, b) => a.rank - b.rank).slice(0, 3);
}

async function one(f) {
  const rec = { slug: f.slug, name: f.name, city: f.city, province: f.province, tags: f.tags, site: f.website, ok: false, pages: [] };
  try {
    const home = await get(f.website.replace(/^http:/i, 'https:'));
    rec.ok = true;
    rec.title = clean((home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]).slice(0, 200);
    rec.description = meta(home.html, 'description') || meta(home.html, 'og:description');
    rec.structured = structured(home.html);
    const h = readable(home.html);
    rec.pages.push({ url: home.url, heads: h.heads, text: h.paras.join(' ').slice(0, 1800) });
    for (const l of innerLinks(home.html, home.url)) {
      try {
        const p = await get(l.url);
        const r = readable(p.html);
        if (r.paras.length) rec.pages.push({ url: p.url, label: l.label, heads: r.heads.slice(0, 15), text: r.paras.join(' ').slice(0, 1800) });
      } catch { /* an inner page that will not load is skipped */ }
    }
  } catch (e) { rec.error = String(e.message || e).slice(0, 80); }
  writeFileSync(`${out}/${f.slug}.json`, JSON.stringify(rec));
  return rec;
}

const todo = firms.filter((f) => f.website && !existsSync(`${out}/${f.slug}.json`)).slice(0, limit);
let i = 0, ok = 0;
await Promise.all(Array.from({ length: 16 }, async () => { while (i < todo.length) { const f = todo[i++]; if ((await one(f)).ok) ok++; process.stdout.write('.'); } }));
console.log(`\nread ${ok} of ${todo.length} websites`);
