// The rating box and its dialogs are drawn by follow.js, which injects its own styles. Those class names must not be reused by any other stylesheet on the
// site: lw-app.css once defined .lw-ov (a hidden, click-through overlay) and .lw-x, so for a signed-in member the rating dialog was invisible and nothing
// happened when they tapped Rate this firm. This test fails if a class defined in follow.js's styles is also defined in another stylesheet.
import { readFileSync, existsSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const js = readFileSync('follow.js', 'utf8');
const css = (js.match(/'[^']*\{[^']*\}[^']*'/g) || []).join('\n'); // the style strings in follow.js
const classesIn = (text) => new Set([...text.matchAll(/\.([a-z][a-z0-9_-]*)(?=[\s,{:.>[+~)]|$)/gi)].map((m) => m[1]));
const mine = classesIn(css);
// the rating box (.lw-rate) is styled in site.css on purpose, to fit the new profile layout
const SHARED = new Set(['lw-rate', 'lw-fbtn', 'lw-sbtn', 'lw-claim', 'lw-claimed', 'lw-fcount', 'lw-fline', 'lw-in', 'lw-a', 'lw-b', 'lc', 'frow', 'ic']);
const others = ['lw-app.css', 'site.css', 'desktop.css', 'admin/admin.css', 'admin/msp.css', 'account/shell.css'];
let clashes = [];
for (const f of others.filter((x) => existsSync(x))) {
  const theirs = classesIn(readFileSync(f, 'utf8'));
  for (const c of mine) if (theirs.has(c) && !SHARED.has(c) && /^lw/.test(c)) clashes.push(`.${c} (also in ${f})`);
}
ok(mine.size > 20, `follow.js defines ${mine.size} classes`);
ok(clashes.length === 0, clashes.length ? `class names shared with another stylesheet: ${clashes.join(', ')}` : 'no class defined in follow.js is also defined in another stylesheet');
ok(mine.has('lwr-ov') && mine.has('lwr-x') && !mine.has('lw-ov') && !mine.has('lw-x'), 'the dialog overlay and close button use their own names (lwr-ov, lwr-x)');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nrating UI checks passed');
