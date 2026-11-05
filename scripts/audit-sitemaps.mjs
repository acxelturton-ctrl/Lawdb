// Checks what Google will see when it reads LawDB's sitemaps: is each file valid, and is every address in it a clean, indexable page?
//   node scripts/audit-sitemaps.mjs                         the live site, all three sitemaps, a sample of 100 pages from each
//   node scripts/audit-sitemaps.mjs --all                   every page of every sitemap (about 1,900 requests: a few minutes)
//   node scripts/audit-sitemaps.mjs --base http://127.0.0.1:8799 --all   a local copy (the addresses in the sitemaps are read as paths)
//   node scripts/audit-sitemaps.mjs --sample 300 sitemap-firms.xml      one sitemap
// It never changes anything; it only reads. Exit code 1 when it finds a problem Search Console would also report (a bad file, a redirect, an error page,
// a noindex page or a wrong canonical in a sitemap, or a file too big for Google); softer findings (long titles, duplicates) are listed but do not fail.
//
// Checks per page: status 200 without a redirect, no noindex (header or tag), the canonical tag is the sitemap address, one h1, a title and a meta description,
// every JSON-LD block parses, no aggregateRating (the rating shown is Google's, so it is not marked up), a viewport tag, html lang.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = (val('--base', 'https://lawdb.ca')).replace(/\/+$/, '');
const ALL = flag('--all');
const SAMPLE = Number(val('--sample', 100));
const named = args.filter((a, i) => /\.xml$/.test(a) && args[i - 1] !== '--base');
const FILES = named.length ? named : ['sitemap.xml', 'sitemap-news.xml', 'sitemap-firms.xml'];
const MAX_URLS = 50000, MAX_BYTES = 50 * 1024 * 1024;

const hard = [], soft = [];
const get = async (url) => fetch(url, { redirect: 'manual', headers: { 'user-agent': 'LawDB-sitemap-audit/1.0' } });
const pathOf = (u) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
const pick = (arr, n) => { if (ALL || arr.length <= n) return arr; const out = []; const step = arr.length / n; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]); return out; };
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; };

for (const file of FILES) {
  const res = await get(`${BASE}/${file}`);
  const text = res.status === 200 ? await res.text() : '';
  if (res.status !== 200) { hard.push(`${file}: HTTP ${res.status} (Google would report "Couldn't fetch")`); continue; }
  const bytes = Buffer.byteLength(text);
  const urls = [...text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const isIndex = /<sitemapindex/.test(text);
  console.log(`\n${file}: ${res.status} ${res.headers.get('content-type')}, ${(bytes / 1024).toFixed(0)} KB, ${isIndex ? 'a sitemap index' : urls.length + ' addresses'}${res.headers.get('x-sitemap-truncated') ? ', TRUNCATED' : ''}`);
  if (!/^\s*<\?xml/.test(text) || !/<(urlset|sitemapindex)[^>]+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(text) || !/<\/(urlset|sitemapindex)>\s*$/.test(text)) hard.push(`${file}: not a well-formed sitemap (header, namespace or closing tag)`);
  if (/<url>(?:(?!<\/url>)[\s\S])*<url>/.test(text)) hard.push(`${file}: nested or unclosed <url>`);
  if (res.headers.get('x-sitemap-truncated')) hard.push(`${file}: the sitemap reached its size limit and is missing pages`);
  if (urls.length > MAX_URLS) hard.push(`${file}: ${urls.length} addresses, more than the ${MAX_URLS} one file may hold`);
  if (bytes > MAX_BYTES) hard.push(`${file}: ${bytes} bytes, more than the 50 MB one file may be`);
  const dup = urls.length - new Set(urls).size; if (dup) hard.push(`${file}: ${dup} repeated addresses`);
  const foreign = urls.filter((u) => !/^https:\/\/lawdb\.ca(\/|$)/.test(u)); if (foreign.length) hard.push(`${file}: ${foreign.length} addresses not on https://lawdb.ca, e.g. ${foreign[0]}`);
  const lastmods = [...text.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);
  const badLm = lastmods.filter((d) => !/^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/.test(d)); if (badLm.length) hard.push(`${file}: ${badLm.length} lastmod values in the wrong format, e.g. ${badLm[0]}`);
  const distinct = new Set(lastmods).size;
  if (lastmods.length > 50 && distinct <= 2) soft.push(`${file}: ${lastmods.length} lastmod dates but only ${distinct} different one(s): Google ignores dates that do not follow real changes`);
  if (isIndex) continue;

  const titles = new Map(), descs = new Map(), bad = {};
  const note = (k, u, extra) => { (bad[k] ||= []).push(extra ? `${u} (${extra})` : u); };
  const sample = pick(urls, SAMPLE);
  console.log(`  checking ${sample.length} page${sample.length === 1 ? '' : 's'}${ALL || sample.length === urls.length ? '' : ` (a sample; use --all for every one)`}`);
  await pool(sample, 6, async (u) => {
    let r;
    try { r = await get(BASE + pathOf(u)); } catch (e) { note('request failed', u, e.message); return; }
    if (r.status !== 200) { note(`HTTP ${r.status}${r.status >= 300 && r.status < 400 ? ' (a redirect in a sitemap)' : ''}`, u, r.headers.get('location') || ''); return; }
    const body = await r.text();
    if (/noindex/i.test(r.headers.get('x-robots-tag') || '') || /<meta[^>]+name="robots"[^>]+noindex/i.test(body)) note('noindex page listed in the sitemap', u);
    const canon = body.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/) || body.match(/<link[^>]+href="([^"]*)"[^>]+rel="canonical"/);
    if (!canon) note('no canonical tag', u); else if (canon[1] !== u) note('canonical is not the sitemap address', u, canon[1]);
    const t = (body.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim();
    if (!t) note('no title', u); else { (titles.get(t) || titles.set(t, []).get(t)).push(u); if (t.length > 70) note('title over 70 characters (soft)', u); }
    const d = (body.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/) || [])[1];
    if (!d || d.length < 50) note('meta description missing or under 50 characters (soft)', u); else (descs.get(d) || descs.set(d, []).get(d)).push(u);
    const h1 = (body.match(/<h1[\s>]/g) || []).length; if (h1 !== 1) note(`${h1} h1 tags`, u);
    for (const m of body.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)) {
      try { const j = JSON.parse(m[1]); if (j && typeof j === 'object' && 'aggregateRating' in j) note('aggregateRating in structured data', u); } catch { note('structured data does not parse', u); }
    }
    if (!/name="viewport"/.test(body)) note('no viewport tag', u);
    if (!/<html[^>]+lang=/.test(body.slice(0, 600))) note('no html lang', u);
  });
  const dupT = [...titles].filter(([, v]) => v.length > 1), dupD = [...descs].filter(([, v]) => v.length > 1);
  if (dupT.length) bad['duplicate titles (soft)'] = dupT.flatMap(([t, v]) => v.slice(0, 2).map((u) => `${u} (${t.slice(0, 50)})`));
  if (dupD.length) bad['duplicate meta descriptions (soft)'] = dupD.flatMap(([t, v]) => v.slice(0, 2).map((u) => `${u} (${t.slice(0, 40)})`));
  const kinds = Object.keys(bad);
  if (!kinds.length) console.log('  every page checked is clean');
  for (const k of kinds) {
    const isSoft = /\(soft\)/.test(k);
    console.log(`  ${isSoft ? 'note' : 'PROBLEM'}: ${k}: ${bad[k].length}, e.g. ${bad[k].slice(0, 2).join(' | ')}`);
    (isSoft ? soft : hard).push(`${file}: ${k}: ${bad[k].length}`);
  }
}

// robots.txt announces the sitemaps and does not block them
const robots = await (await get(`${BASE}/robots.txt`)).text().catch(() => '');
const listed = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
console.log(`\nrobots.txt announces: ${listed.join(', ') || 'nothing'}`);
for (const f of FILES) if (!listed.includes(`https://lawdb.ca/${f}`) && f !== 'sitemap-index.xml') soft.push(`robots.txt does not announce ${f}`);
if (/^Disallow:\s*\/\s*$/im.test(robots)) hard.push('robots.txt blocks the whole site');

console.log(soft.length ? `\nnotes (do not fail): ${soft.length}\n  - ${soft.join('\n  - ')}` : '\nno notes');
if (hard.length) { console.log(`\n${hard.length} PROBLEM${hard.length === 1 ? '' : 'S'}:\n  - ${hard.join('\n  - ')}`); process.exit(1); }
console.log('\nno problems: Search Console should accept these sitemaps');
