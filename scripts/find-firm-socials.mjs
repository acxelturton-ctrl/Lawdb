// Finds each firm's own social profile links (Facebook, Instagram, LinkedIn, X, YouTube) on the firm's OWN website: the structured-data
// "sameAs" list and the links in the page (usually the footer or header icons) of its home page, and, when the home page has none, its contact page.
//   NODE_USE_ENV_PROXY=1 node scripts/find-firm-socials.mjs <out-dir> [--limit=N]
// Public https only; a site's robots.txt is honoured. Only profiles and pages are kept (src/lib/social.js drops share buttons, single posts,
// videos and logins). A link whose name has nothing to do with the firm (a web agency's footer, a bar association) is not picked: it goes to
// review.json for a person to look at. Writes <out-dir>/found.json (everything seen), picked.json ({ slug: { network: url } }) and review.json.
// NOTHING goes on the site until a person has looked at the result: scripts/apply-firm-socials.mjs only uses data/firm-socials.json.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { cleanSocialUrl, NETWORKS } from '../src/lib/social.js';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/find-firm-socials.mjs <out-dir> [--limit=N]'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
mkdirSync(out, { recursive: true });
const UA = 'LawDB-SocialFinder/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const MAX_BYTES = 2.5 * 1024 * 1024;

const firms = [];
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) if (f.website) firms.push({ slug: f.slug, name: f.name, website: f.website });
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) if (f.website) firms.push({ slug: f.slug, name: f.name, website: f.website });
}

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x2F;/gi, '/');

async function getText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(String(res.status));
  if (!/^https:/i.test(res.url)) throw new Error('not https');
  if (!/html|xml/i.test(res.headers.get('content-type') || '')) throw new Error('not a page');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('too big');
  return { text: new TextDecoder().decode(bytes), url: res.url };
}

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
  return !rules.some((r) => (r === '/' ? true : !!r.split('*')[0] && path.startsWith(r.split('*')[0])));
}

// Every address in the page that is a social profile: [{ network, url, via }]; via is 'sameAs' (the site's own structured-data list) or 'link'.
function socialLinks(html, base) {
  const found = [];
  const add = (raw, via) => {
    let abs;
    try { abs = new URL(decode(raw), base).href; } catch { return; }
    for (const { key } of NETWORKS) {
      const url = cleanSocialUrl(key, abs);
      if (url) { found.push({ network: key, url, via }); return; }
    }
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') {
          if (n.sameAs) [].concat(n.sameAs).forEach((s) => typeof s === 'string' && add(s, 'sameAs'));
          Object.values(n).forEach(walk);
        }
      };
      walk(JSON.parse(m[1].trim()));
    } catch { /* not valid JSON: skip */ }
  }
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) add(m[1], 'link');
  return found;
}

const STOP = new Set('law legal lawyers lawyer firm office offices associates associes professional corporation group llp pc inc ltd barristers solicitors barrister solicitor avocats avocat notaires notary the and cabinet'.split(' '));
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Does the profile's name have something to do with the firm (a word of its name, or its web domain)?
function plausible(firm, network, url) {
  const u = new URL(url);
  const seg = u.pathname.split('/').filter(Boolean);
  const last = network === 'facebook' && seg[0] === 'pages' ? seg[1] : seg[seg.length - 1] || '';
  if (/^profile\.php/.test(seg[0] || '')) return null; // a numeric Facebook id says nothing about the firm
  const handle = norm(decodeURIComponent(last)).replace(/[^a-z0-9]/g, '');
  const tokens = norm(firm.name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));
  let label = '';
  try { label = norm(new URL(firm.website).hostname).replace(/^www\./, '').split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, ''); } catch { /* none */ }
  if (tokens.some((t) => handle.includes(t.replace(/[^a-z0-9]/g, '')))) return true;
  if (label.length >= 4 && (handle.includes(label) || (handle.length >= 5 && label.includes(handle)))) return true;
  const initials = tokens.map((t) => t[0]).join('');
  return initials.length >= 3 && handle.includes(initials);
}

async function one(firm) {
  const rec = { website: firm.website, pages: [], links: [] };
  let origin;
  try { origin = new URL(firm.website).origin; } catch { rec.error = 'bad website'; return rec; }
  const visit = async (url) => {
    const u = new URL(url);
    if (!(await allowed(u.origin, u.pathname))) { rec.pages.push({ url, skipped: 'robots' }); return null; }
    try {
      const page = await getText(url);
      rec.pages.push({ url: page.url });
      rec.links.push(...socialLinks(page.text, page.url));
      return page;
    } catch (e) { rec.pages.push({ url, error: String(e.message || e) }); return null; }
  };
  const home = await visit(firm.website.replace(/^http:/i, 'https:'));
  if (home && !rec.links.length) {
    // no icons on the home page: look at the contact page it links to
    const m = home.text.match(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]*contact[^"']*)["']/i);
    if (m) { try { const target = new URL(decode(m[1]), home.url); if (target.origin === new URL(home.url).origin) await visit(target.href); } catch { /* skip */ } }
  }
  return rec;
}

const found = {}, picked = {}, review = [];
const todo = firms.slice(0, limit);
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < todo.length) {
    const firm = todo[i++];
    const rec = await one(firm);
    found[firm.slug] = rec;
    const by = {};
    for (const l of rec.links) (by[l.network] ||= []).push(l);
    for (const [network, list] of Object.entries(by)) {
      const uniq = [...new Map(list.map((l) => [l.url.toLowerCase(), l])).values()].sort((a, b) => (a.via === 'sameAs' ? 0 : 1) - (b.via === 'sameAs' ? 0 : 1));
      const good = uniq.find((l) => plausible(firm, network, l.url) === true);
      const sameAs = uniq.find((l) => l.via === 'sameAs');
      const pick = good || sameAs;
      if (pick) (picked[firm.slug] ||= {})[network] = pick.url;
      else review.push({ slug: firm.slug, name: firm.name, website: firm.website, network, url: uniq[0].url, others: uniq.length - 1 });
    }
    if (i % 25 === 0) { process.stdout.write(`${i} `); writeFileSync(`${out}/found.json`, JSON.stringify(found)); }
  }
}));
writeFileSync(`${out}/found.json`, JSON.stringify(found, null, 1));
writeFileSync(`${out}/picked.json`, JSON.stringify(picked, null, 1));
writeFileSync(`${out}/review.json`, JSON.stringify(review, null, 1));
const count = (k) => Object.values(picked).filter((p) => p[k]).length;
console.log(`\n${todo.length} firms looked at; with at least one profile: ${Object.keys(picked).length}; ` + NETWORKS.map(({ key }) => `${key} ${count(key)}`).join(', ') + `; to review: ${review.length}`);
