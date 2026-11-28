// Open Graph and Twitter card tags:  node scripts/test-open-graph.mjs
// Every page shares the same new picture (images/og-lawdb.jpg, no firm count on it), the type is "website" (news stories are "article"), and the pages the Worker draws say so too.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// the picture: a JPEG, 1200 x 630, not huge; the old one is gone
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
const img = readFileSync('images/og-lawdb.jpg');
const size = jpegSize(img);
ok(img[0] === 0xff && img[1] === 0xd8 && size && size.w === 1200 && size.h === 630, 'images/og-lawdb.jpg is a 1200 x 630 JPEG');
ok(img.length > 20000 && img.length < 400000, `the picture is a sensible size (${Math.round(img.length / 1024)} KB)`);
ok(!existsSync('images/og-default.jpg'), 'the old picture ("Browse 277 Canadian law firms") is gone');

// every page
const SKIP = new Set(['node_modules', '.wrangler', '.git', 'migrations', 'data', 'docs']);
const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) walk(p); else if (name.endsWith('.html')) pages.push(p);
  }
})('.');
let withOg = 0, oldPic = 0, biz = 0, noTwitter = 0, noSize = 0;
for (const p of pages) {
  const h = readFileSync(p, 'utf8');
  if (!/property="og:image"/.test(h)) continue;
  withOg++;
  if (/og-default/.test(h)) oldPic++;
  if (/og:type" content="business\.business"/.test(h)) biz++;
  if (/og-lawdb\.jpg/.test(h) && !/name="twitter:image" content="https:\/\/lawdb\.ca\/images\/og-lawdb\.jpg"/.test(h)) noTwitter++;
  if (/og:image" content="https:\/\/lawdb\.ca\/images\/og-lawdb\.jpg"/.test(h) && !/og:image:width" content="1200"/.test(h)) noSize++;
}
ok(withOg > 600, `${withOg} pages carry a share picture`);
ok(oldPic === 0, 'no page points at the old picture');
ok(biz === 0, 'no page says og:type "business.business"');
ok(noTwitter === 0, 'every page with the picture also gives it to Twitter cards');
ok(noSize === 0, 'every page with the picture gives its size (1200 x 630)');
const firm = readFileSync('firms/aird-berlis-llp.html', 'utf8');
ok(/og:type" content="website"/.test(firm) && /og:image" content="https:\/\/lawdb\.ca\/images\/og-lawdb\.jpg"/.test(firm), 'a firm page says website and uses the new picture');

// the pages the Worker draws
const fp = readFileSync('src/render/firm-page.js', 'utf8');
ok(/'<meta property="og:type" content="website">'/.test(fp) && !/business\.business/.test(fp) && !/'profile'/.test(fp), 'firm and lawyer pages the Worker draws say og:type "website"');
ok(/\/images\/og-lawdb\.jpg/.test(fp) && !/og-default/.test(fp), 'they use the new picture unless the firm has its own cover');
ok(/CACHE_GENERATION = (1[2-9]|[2-9]\d)/.test(readFileSync('src/routes/firm-page.js', 'utf8')), 'the saved copies of firm pages were refreshed (cache generation)');
for (const f of ['news-page', 'new-firms-page']) {
  const s = readFileSync(`src/render/${f}.js`, 'utf8');
  ok(/og:image" content="https:\/\/lawdb\.ca\/images\/og-lawdb\.jpg"/.test(s) && /name="twitter:card" content="summary_large_image"/.test(s), `${f}: has the share picture and a large Twitter card`);
}
const st = readFileSync('src/render/story-page.js', 'utf8');
ok(/og:type" content="article"/.test(st) && /og-lawdb\.jpg/.test(st), 'news stories stay "article" and fall back to the new picture when the story has none');
const cp = readFileSync('scripts/build-case-pages.mjs', 'utf8');
ok(/og-lawdb\.jpg/.test(cp) && !/og-default/.test(cp), 'the generator for the case pages uses the new picture');

console.log(bad ? `\n${bad} check(s) failed` : '\nopen graph checks passed');
process.exit(bad ? 1 : 0);
