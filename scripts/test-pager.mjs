// Checks the page-number logic of the results page bar (pageItems in lawdb-map.js): always exactly `slots` entries,
// first page, last page and the current page always shown, "..." (0) only where it hides at least one page, numbers ascending.
import { readFileSync } from 'node:fs';

const src = readFileSync('lawdb-map.js', 'utf8');
const m = src.match(/function pageItems[\s\S]*?\n  \}\n/);
if (!m) { console.error('pageItems not found in lawdb-map.js'); process.exit(1); }
const pageItems = new Function(`${m[0]}; return pageItems;`)();

let bad = 0;
const fail = (...a) => { if (bad++ < 10) console.error('page bar:', ...a); };
for (const slots of [5, 6, 7, 8, 9, 10]) {
  for (let total = 1; total <= 40; total++) {
    for (let cur = 1; cur <= total; cur++) {
      const it = pageItems(cur, total, slots);
      const tag = `slots=${slots} total=${total} current=${cur}: ${it.join(' ')}`;
      if (it.length !== Math.min(slots, total)) { fail('wrong length', tag); continue; }
      if (![1, cur, total].every((p) => it.includes(p))) { fail('first, last or current page missing', tag); continue; }
      let prev = 0;
      it.forEach((p, i) => {
        if (p === 0) { if (!(it[i + 1] - it[i - 1] >= 2)) fail('"..." hides nothing', tag); }
        else { if (p <= prev) fail('not ascending', tag); prev = p; }
      });
      if (slots >= 7 && ((cur > 1 && !it.includes(cur - 1)) || (cur < total && !it.includes(cur + 1)))) fail('a neighbour of the current page is hidden', tag);
    }
  }
}
if (bad) process.exit(1);
console.log('page bar logic ok');
