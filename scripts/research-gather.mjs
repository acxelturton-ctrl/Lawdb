// Reads each firm's own website for awards and recognition: the home page plus up to four inner pages that look like Awards / Recognition / News / About pages
// (public http(s) only, same site only), keeping the text with its line breaks.
//   NODE_USE_ENV_PROXY=1 node scripts/research-gather.mjs <out-dir> [--limit=N] [--only=slug,slug]
// Writes <out-dir>/<slug>.json = { slug, site, pages: [{ url, text }] }. Nothing is stored in the repository: research-awards.mjs reads these.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadSiteFirms } from './lib/site-firms.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/research-gather.mjs <out-dir> [--limit=N] [--only=slug,slug]'); process.exit(1); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
const limit = Number(arg('limit')) || Infinity, only = arg('only') ? new Set(arg('only').split(',')) : null;
mkdirSync(out, { recursive: true });
const UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';

const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-').replace(/&[a-z]+;/g, ' ');
const lines = (html) => decode(html.replace(/<(script|style|noscript|svg|template|form)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<\/(p|li|h[1-6]|div|section|article|tr|blockquote|a)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2).join('\n');

const PRIORITY = [[/award|recogni|accolade|honou?r|ranking|achievement|rankings/i, 6], [/news|press|media|in-the-news|announcement|latest/i, 3], [/about|our-?firm|the-?firm|who-?we|history/i, 2]];
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?)(\?|$)|^(mailto|tel|javascript):|\/(wp-content|wp-json|tag|category|author|cart|login|privacy|terms|contact)\b/i;

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') || 'html')) throw new Error(String(res.status));
  return { html: (await res.text()).slice(0, 800_000), url: res.url };
}
const hostKey = (u) => new URL(u).hostname.replace(/^www\./, '').toLowerCase();

async function one(f) {
  const file = `${out}/${f.slug}.json`;
  if (existsSync(file)) return 'cached';
  let site = (f.website || '').trim();
  if (!site) return 'no site';
  if (!/^https?:/.test(site)) site = `https://${site}`;
  const pages = [];
  try {
    const home = await get(site);
    pages.push({ url: home.url, text: lines(home.html).slice(0, 16000) });
    const base = new URL(home.url);
    const cand = new Map();
    for (const m of home.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let u;
      try { u = new URL(m[1].trim(), base); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || hostKey(u.href) !== hostKey(base.href) || SKIP.test(u.pathname + u.search) || u.pathname === '/' || u.href === home.url) continue;
      const label = `${u.pathname} ${m[2].replace(/<[^>]+>/g, ' ')}`;
      const score = PRIORITY.reduce((n, [re, w]) => n + (re.test(label) ? w : 0), 0);
      if (score && (!cand.has(u.href) || cand.get(u.href) < score)) cand.set(u.href, score);
    }
    for (const [u] of [...cand].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      try { const p = await get(u); pages.push({ url: p.url, text: lines(p.html).slice(0, 16000) }); } catch { /* skip a page that will not load */ }
    }
  } catch (e) { if (!pages.length) return `failed ${String(e.message || e).slice(0, 30)}`; }
  writeFileSync(file, JSON.stringify({ slug: f.slug, site, pages }));
  return `ok ${pages.length}`;
}

const firms = loadSiteFirms().filter((f) => (!only || only.has(f.slug))).slice(0, limit);
const tally = {};
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < firms.length) {
    const f = firms[i++];
    const r = (await one(f)).split(' ')[0];
    tally[r] = (tally[r] || 0) + 1;
    if (i % 100 === 0) process.stdout.write(`${i} `);
  }
}));
console.log(`\n${JSON.stringify(tally)}`);
