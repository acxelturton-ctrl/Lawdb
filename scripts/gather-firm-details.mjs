// Reads the pages where a firm's own website names its lawyers and says where it works, for the "At a glance" facts on a profile.
//   NODE_USE_ENV_PROXY=1 node scripts/gather-firm-details.mjs <out-dir> [--limit=N]
// For every firm with a website it fetches the home page and up to two team / lawyer / about pages (public https, same site only) and writes
// <out-dir>/<slug>.json with page headings, plain text and any Person names in the page's structured data. A site's robots.txt is honoured:
// a page it disallows for everyone is not fetched. Nothing is stored in the repository; this is only the input for scripts/extract-firm-details.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/gather-firm-details.mjs <out-dir> [--limit=N]'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
mkdirSync(out, { recursive: true });
const UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';

const firms = JSON.parse(readFileSync('firms_data.json', 'utf8')).map((f) => ({ slug: f.slug, website: f.website }));
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.push({ slug: f.slug, website: f.website });
}

const decode = (s) => s.replace(/&#x27;|&#039;|&#0?39;|&apos;|&rsquo;|&#8217;|&lsquo;/g, "'").replace(/&amp;/g, '&').replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, ' ');
const clean = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(String(res.status));
  if (!/html/i.test(res.headers.get('content-type') || 'html')) throw new Error('not html');
  if (!/^https:/i.test(res.url)) throw new Error('not https');
  return { html: (await res.text()).slice(0, 900_000), url: res.url };
}

// robots.txt: only "Disallow" lines under User-agent: * (or us) matter here
const robotsCache = new Map();
async function allowed(origin, path) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const res = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return [];
        const rules = []; let applies = false, sawAgent = false;
        for (const raw of (await res.text()).split(/\r?\n/)) {
          const line = raw.replace(/#.*$/, '').trim();
          const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
          if (!m) continue;
          const k = m[1].toLowerCase();
          if (k === 'user-agent') { if (!sawAgent) applies = false; sawAgent = true; if (m[2].trim() === '*' || /lawdb/i.test(m[2])) applies = true; }
          else { sawAgent = false; if (applies && k === 'disallow' && m[2].trim()) rules.push(m[2].trim()); }
        }
        return rules;
      } catch { return []; }
    })());
  }
  const rules = await robotsCache.get(origin);
  return !rules.some((r) => {
    if (r === '/') return true;
    const prefix = r.split('*')[0]; // a rule that starts with a wildcard is not matched here, which only errs towards fetching less
    return !!prefix && path.startsWith(prefix);
  });
}

const TEAM = /(our-?team|the-?team|\bteam\b|lawyers?|attorneys?|\bpeople\b|professionals|meet|partners?|counsel|biograph|who-we-are|about)/i;
const SKIP = /(blog|news|article|post|contact|privacy|terms|disclaimer|login|career|\.pdf|tag|category|\/20\d\d\/|wp-content|sitemap|practice|service|areas)/i;
function teamLinks(html, base) {
  const origin = new URL(base).origin;
  const seen = new Set(); const found = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], base); } catch { continue; }
    if (u.origin !== origin || u.protocol !== 'https:' || u.pathname === '/' || seen.has(u.pathname)) continue;
    const label = clean(m[2]);
    if (SKIP.test(u.pathname) || !(TEAM.test(u.pathname) || TEAM.test(label))) continue;
    if (u.pathname.split('/').filter(Boolean).length > 3) continue;
    seen.add(u.pathname);
    found.push({ url: u.origin + u.pathname, label: label.slice(0, 50), rank: /team|lawyers?|attorneys?|people|professionals|partners?|counsel/i.test(u.pathname + label) ? 0 : 1 });
  }
  return found.sort((a, b) => a.rank - b.rank).slice(0, 2);
}

function persons(html) {
  const names = new Set();
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const t = [].concat(n['@type'] || []).join(' ');
      if (/Person|Attorney/i.test(t) && typeof n.name === 'string' && /\s/.test(n.name) && n.name.length < 60) names.add(clean(n.name));
      for (const k of Object.keys(n)) if (typeof n[k] === 'object') walk(n[k]);
    };
    walk(data);
  }
  return [...names].slice(0, 20);
}

function readable(html) {
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [html])[0].replace(/<(script|style|noscript|svg|nav|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  const heads = [...body.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(m[2])).filter((t) => t.length > 2 && t.length < 90);
  const paras = [...body.matchAll(/<(p|li|span|div)\b[^>]*>([^<]{25,400})<\/\1>/gi)].map((m) => clean(m[2])).filter((t) => t.length > 25 && !/cookie|copyright|all rights reserved|privacy policy|©/i.test(t));
  return { heads: [...new Set(heads)].slice(0, 60), text: [...new Set(paras)].join(' ').slice(0, 5000) };
}

async function one(f) {
  const rec = { slug: f.slug, site: f.website, ok: false, pages: [], persons: [] };
  try {
    const home = await get(f.website.replace(/^http:/i, 'https:'));
    const origin = new URL(home.url).origin;
    rec.ok = true;
    const take = (html, url, kind) => { const r = readable(html); rec.pages.push({ url, kind, heads: r.heads, text: r.text }); for (const n of persons(html)) if (!rec.persons.includes(n)) rec.persons.push(n); };
    take(home.html, home.url, 'home');
    for (const l of teamLinks(home.html, home.url)) {
      try {
        if (!(await allowed(origin, new URL(l.url).pathname))) { rec.robots = 'some pages disallowed'; continue; }
        const p = await get(l.url);
        take(p.html, p.url, l.rank === 0 ? 'team' : 'about');
      } catch { /* a page that will not load is skipped */ }
    }
  } catch (e) { rec.error = String(e.message || e).slice(0, 80); }
  writeFileSync(`${out}/${f.slug}.json`, JSON.stringify(rec));
  return rec;
}

const todo = firms.filter((f) => f.website && !existsSync(`${out}/${f.slug}.json`)).slice(0, limit);
let i = 0, ok = 0;
await Promise.all(Array.from({ length: 12 }, async () => { while (i < todo.length) { const f = todo[i++]; if ((await one(f)).ok) ok++; process.stdout.write('.'); } }));
console.log(`\nread ${ok} of ${todo.length} websites`);
