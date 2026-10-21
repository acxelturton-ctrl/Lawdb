// A city practice page must say the same thing everywhere about how many firms it lists, and must list every firm the directory has for that city
// and practice area. (The wording of each part is rebuilt by refresh-practice-pages.mjs, whose --check keeps the pages in step with the data.)
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const firms = JSON.parse(readFileSync('firms_data.json', 'utf8'));
const released = new Set(JSON.parse(readFileSync('data/release.json', 'utf8')).released);
for (const f of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x)).sort()) {
  if (released.has(Number(f.match(/\d+/)[0]))) firms.push(...JSON.parse(readFileSync(`data/${f}`, 'utf8')));
}

const KEY = { 'business-lawyers': 'business', 'criminal-defence-lawyers': 'criminal', 'employment-lawyers': 'employment', 'family-lawyers': 'family', 'immigration-lawyers': 'immigration', 'litigation-lawyers': 'litigation', 'personal-injury-lawyers': 'injury', 'real-estate-lawyers': 'realestate', 'traffic-ticket-lawyers': 'traffic', 'wills-estate-lawyers': 'wills' };
const PROV = { ontario: 'ON', quebec: 'QC', 'british-columbia': 'BC', alberta: 'AB', manitoba: 'MB' };

const problems = { count: [], rows: [], items: [], faq: [], missing: [], dup: [], stat: [], feat: [], lawlaw: [] };
let pages = 0;
for (const [dirName, code] of Object.entries(PROV)) {
  for (const d of readdirSync(dirName, { withFileTypes: true })) {
    const dir = `${dirName}/${d.name}`;
    if (!d.isDirectory() || !existsSync(`${dir}/index.html`)) continue;
    const hm = readFileSync(`${dir}/index.html`, 'utf8').match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
    if (!hm) continue;
    const city = hm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    for (const f of readdirSync(dir)) {
      const key = KEY[f.replace(/\.html$/, '')];
      if (!key || !f.endsWith('.html')) continue;
      const file = `${dir}/${f}`;
      const want = firms.filter((x) => x.province === code && x.city === city && (x.caseTypes || []).includes(key));
      if (!want.length) continue;
      pages++;
      const html = readFileSync(file, 'utf8');
      const n = want.length;
      const title = (html.match(/<title>[^<]*\| (\d+) Firms? \| LawDB\.ca<\/title>/) || [])[1];
      if (Number(title) !== n) problems.count.push(`${file}: title says ${title}, data has ${n}`);
      const table = (html.match(/<tbody>[\s\S]*?<\/tbody>/) || [''])[0];
      const rows = [...table.matchAll(/<tr><td><a href="\/firms\/([a-z0-9-]+)"/g)].map((m) => m[1]);
      if (rows.length !== n) problems.rows.push(`${file}: table has ${rows.length}, data has ${n}`);
      if (new Set(rows).size !== rows.length) problems.dup.push(file);
      const missing = want.filter((x) => !rows.includes(x.slug));
      if (missing.length) problems.missing.push(`${file}: ${missing[0].slug}`);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      const items = (ld.find((x) => x['@type'] === 'ItemList') || { itemListElement: [] }).itemListElement.length;
      if (items !== n) problems.items.push(`${file}: structured data lists ${items}, data has ${n}`);
      const faq = (html.match(/LawDB currently lists (\d+) /) || [])[1];
      if (Number(faq) !== n) problems.faq.push(`${file}: FAQ says ${faq}, data has ${n}`);
      const stat = (html.match(/<div class="seo-stats"><div><b>(\d+)<\/b>/) || [])[1];
      if (Number(stat) !== n) problems.stat.push(`${file}: stats say ${stat}, data has ${n}`);
      // a Featured badge only where the data says Featured
      const badges = [...table.matchAll(/<a href="\/firms\/([a-z0-9-]+)">[^<]*<\/a> <span class="seo-feat">/g)].map((m) => m[1]);
      for (const slug of badges) if (!want.find((x) => x.slug === slug)?.featured) problems.feat.push(`${file}: ${slug}`);
      if (/\blaw law firms\b/.test(html)) problems.lawlaw.push(file);
    }
  }
}
ok(pages >= 90, `${pages} city practice pages checked`);
ok(!problems.count.length, `every title count matches the firms in the data${problems.count.length ? ': ' + problems.count.slice(0, 3).join(' | ') : ''}`);
ok(!problems.rows.length && !problems.missing.length, `every page's table lists every firm for that city and practice area${problems.rows.length ? ': ' + problems.rows.slice(0, 3).join(' | ') : ''}`);
ok(!problems.dup.length, 'no firm appears twice in a table');
ok(!problems.items.length, 'the structured data lists the same firms');
ok(!problems.faq.length && !problems.stat.length, 'the FAQ answer and the numbers box agree with the table');
ok(!problems.feat.length, `no Featured badge for a firm that is not Featured${problems.feat.length ? ': ' + problems.feat.slice(0, 3).join(' | ') : ''}`);
ok(!problems.lawlaw.length, 'no "family law law firms" wording');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
