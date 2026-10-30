// Checks that every page has ONE address: clean (no ".html"), the canonical tag and sitemap agree with it, and every internal link
// points straight at an existing page (no old addresses that would need a redirect).   node scripts/check-links.mjs
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ORIGIN = 'https://lawdb.ca';
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'admin', 'account', 'docs', 'migrations', 'scripts', 'src', 'db']);

// Firms added in batches have no hand-built page: /firms/<slug> is rendered from the database, so a released batch firm counts as an existing page.
const batchFirms = new Set();
{
  const released = new Set(JSON.parse(readFileSync(join(ROOT, 'data/release.json'), 'utf8')).released);
  for (const f of readdirSync(join(ROOT, 'data')).filter((x) => /^firms-batch-\d+\.json$/.test(x) && released.has(Number(x.match(/\d+/)[0])))) {
    for (const firm of JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'))) batchFirms.add(`/firms/${firm.slug}`);
  }
}

const pages = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.') || SKIP.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.html')) pages.push(relative(ROOT, p).split('\\').join('/'));
  }
})(ROOT);

const servedOf = (rel) => {
  let p = '/' + rel.replace(/\.html$/, '');
  if (p.endsWith('/index')) p = p.slice(0, -5);
  if (p === '/index') p = '/';
  return p;
};
const served = new Map(pages.map((r) => [servedOf(r), r]));
const dirOf = (rel) => { const d = posix.dirname('/' + rel); return d.endsWith('/') ? d : d + '/'; };

// Addresses the Worker answers itself (no file of that name) or that live outside the site's pages.
const DYNAMIC = [/^\/news$/, /^\/new-firms$/, /^\/report-listing$/,/^\/img\//, /^\/api\//, /^\/admin\//, /^\/account\//];
const problems = [];
const bad = (file, msg) => problems.push(`${file}: ${msg}`);

for (const rel of pages) {
  const html = readFileSync(join(ROOT, rel), 'utf8');
  const own = ORIGIN + servedOf(rel);
  const canon = /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/.exec(html);
  if (canon && canon[1] !== own) bad(rel, `canonical is ${canon[1]}, expected ${own}`);
  const og = /<meta[^>]+property="og:url"[^>]+content="([^"]*)"/.exec(html);
  if (og && og[1] !== own) bad(rel, `og:url is ${og[1]}, expected ${own}`);
  for (const m of html.matchAll(/\bhref\s*=\s*"([^"]*)"/g)) {
    let u = m[1].trim();
    if (/\$\{|'\s*\+|\+\s*'/.test(u)) continue; // built in the browser by the page's own script
    if (!u || u[0] === '#' || /^(mailto:|tel:|javascript:|data:|sms:)/i.test(u) || u.startsWith('//')) continue;
    if (/^https?:\/\//i.test(u)) {
      if (!/^https:\/\/(www\.)?lawdb\.ca/i.test(u)) continue;
      u = u.replace(/^https:\/\/(www\.)?lawdb\.ca/i, '') || '/';
    }
    u = u.split('#')[0].split('?')[0];
    if (!u) continue;
    const abs = u.startsWith('/') ? u : posix.normalize(posix.join(dirOf(rel), u));
    const path = u.endsWith('/') && !abs.endsWith('/') ? abs + '/' : abs;
    if (/\.html$/.test(path) || /\/index$/.test(path) || /^\/(services|legal-news)(\/|$)/.test(path)) { bad(rel, `old-style link ${m[1]}`); continue; }
    if (served.has(path) || served.has(path.replace(/\/$/, '')) || DYNAMIC.some((d) => d.test(path))) continue;
    if (path.endsWith('/') && served.has(path)) continue;
    if (existsSync(join(ROOT, path.slice(1))) && statSync(join(ROOT, path.slice(1))).isFile()) continue; // an asset: css, js, image, pdf...
    if (path === '/') continue;
    if (batchFirms.has(path)) continue;
    if (/^\/firms\/[a-z0-9-]+$/.test(path)) { bad(rel, `link to a firm page that does not exist: ${m[1]}`); continue; }
    bad(rel, `broken link ${m[1]} (-> ${path})`);
  }
}

// sitemap
const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const seen = new Set();
for (const l of locs) {
  const p = l.replace(ORIGIN, '') || '/';
  if (!l.startsWith(ORIGIN + '/')) bad('sitemap.xml', `not a lawdb.ca address: ${l}`);
  else if (/\.html$/.test(p) || /\/index$/.test(p)) bad('sitemap.xml', `old-style address ${l}`);
  else if (!served.has(p) && !DYNAMIC.some((d) => d.test(p))) bad('sitemap.xml', `no page for ${l}`);
  if (seen.has(l)) bad('sitemap.xml', `listed twice: ${l}`);
  seen.add(l);
}

if (problems.length) {
  console.error(problems.slice(0, 60).join('\n') + (problems.length > 60 ? `\n... and ${problems.length - 60} more` : ''));
  console.error(`\n${problems.length} link problem(s)`);
  process.exit(1);
}
console.log(`links ok: ${pages.length} pages, ${locs.length} sitemap addresses, one clean address each`);
