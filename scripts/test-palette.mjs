// The palette (scripts/palette.mjs) has to stay readable: the pairs the site actually uses must meet WCAG contrast (4.5:1 for text), and no colour may
// be listed twice. That every colour in the site IS one of these is checked by scripts/recolor-site.mjs --check.
import { PALETTE } from './palette.mjs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const lum = (h) => {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const P = PALETTE;

const hexes = Object.values(P);
ok(new Set(hexes).size === hexes.length && hexes.length === 15, `${hexes.length} palette colours, none repeated`);
for (const [fg, bg, why] of [
  ['ink', 'cream', 'text on the page'], ['ink', 'white', 'text on a card'], ['slate', 'cream', 'secondary text on the page'], ['slate', 'white', 'secondary text on a card'],
  ['goldDeep', 'cream', 'gold links on the page'], ['goldDeep', 'white', 'gold links on a card'], ['goldDeep', 'goldTint', 'gold text on a gold tint'], ['goldDeep', 'cream2', 'gold numbers on the band'],
  ['ink', 'gold', 'text on a gold button'], ['white', 'ink', 'white on navy'], ['white', 'panel', 'white on a dark panel'], ['white', 'ink2', 'white on a monogram'],
  ['goldLight', 'panel', 'gold on a dark panel'], ['slate3', 'panel', 'muted text on a dark panel'], ['slate3', 'ink', 'muted text on navy'],
]) ok(ratio(P[fg], P[bg]) >= 4.5, `${why}: ${fg} on ${bg} is ${ratio(P[fg], P[bg]).toFixed(1)}:1 (4.5 needed)`);
// white on the gold fill is the one thing that must never be used
ok(ratio(P.white, P.gold) < 3, `white on gold is only ${ratio(P.white, P.gold).toFixed(1)}:1, so buttons use navy text (scripts/recolor-site.mjs fixes any white-on-gold)`);

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
