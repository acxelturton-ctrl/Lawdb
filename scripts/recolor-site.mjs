// Maps every colour in the site's CSS, inline styles, SVG attributes and scripts to the palette in scripts/palette.mjs.
//   node scripts/recolor-site.mjs            rewrites the files
//   node scripts/recolor-site.mjs --check    fails if any file still has a colour outside the palette (npm run check runs this)
//   node scripts/recolor-site.mjs --table    prints what each colour maps to, most used first (nothing is written)
// Only places that are really colours are touched: CSS properties (in style sheets, <style> blocks, style="" attributes and CSS inside script
// strings), rgb()/rgba(), six-digit hex anywhere in a style or script, and SVG fill/stroke attributes. Text such as "Suite #300" is left alone.
// The owner-only admin and account screens keep their red and green signal colours; firm logos and photos are pictures and are not touched.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { PALETTE_HEX, mapLiteral, parseColor } from './palette.mjs';

const MODE = process.argv.includes('--check') ? 'check' : process.argv.includes('--table') ? 'table' : 'write';
const SKIP_DIRS = new Set(['node_modules', '.wrangler', '.claude', '.git', 'migrations', 'data']);
const SKIP_PREFIX = ['images/logos/', 'images/bio/', 'images/hero/', 'images/blog/', 'scripts/palette.mjs', 'scripts/recolor-site.mjs', 'scripts/test-palette.mjs', 'package-lock.json'];
const EXT = new Set(['.html', '.css', '.js', '.mjs', '.svg']);

// what a few colours stand for on this site (the rest follow the rules in palette.mjs)
const OVERRIDES = {
  '#1f2328': '#142434', '#15181c': '#1b242d', '#8d9197': '#8a919b', '#636870': '#586170', '#30353b': '#2b3a4c', '#3f444b': '#2b3a4c',
  '#e8a91f': '#c9a050', '#e0a93a': '#c9a050', '#b45309': '#8a6224', '#e3dfd5': '#e3dfd3', '#f8f6f1': '#f5f3ec', '#fdfcf9': '#ffffff',
  '#fff3d4': '#f4ecd8', '#f6dc9a': '#e6d4a4', '#f0ede5': '#edeae1', '#eef0f2': '#edeae1', '#c7cfda': '#e3dfd3', '#e0342f': '#c9a050',
  '#b91c1c': '#8a6224', '#1f6f6b': '#2b3a4c', '#e8f2e2': '#edeae1', '#f3a9a5': '#e6d4a4',
  // the monogram colours firms had for their avatar: all the same navy now
  '#2f4858': '#2b3a4c', '#1c2a3a': '#2b3a4c', '#2e4a43': '#2b3a4c', '#3f4a5a': '#2b3a4c', '#4a3b52': '#2b3a4c', '#3d5a6c': '#2b3a4c', '#5a4632': '#2b3a4c',
  '#4a5d5f': '#2b3a4c', '#4a3a1e': '#2b3a4c', '#3a3a1c': '#2b3a4c', '#3a2a1c': '#2b3a4c', '#2a3a2c': '#2b3a4c', '#3a1c2a': '#2b3a4c', '#2a1c3a': '#2b3a4c', '#1c3a3a': '#2b3a4c',
  // social brand blues
  '#0a66c2': '#142434', '#1877f2': '#142434', '#1d5fb4': '#142434', '#000': '#142434', '#000000': '#142434',
};

const cssProp = /(^|[;{\s"'(`])((?:color|background(?:-color|-image)?|border(?:-top|-right|-bottom|-left)?(?:-color)?|outline(?:-color)?|fill|stroke|stop-color|flood-color|box-shadow|text-shadow|caret-color|accent-color|column-rule(?:-color)?|text-decoration(?:-color)?|filter|-webkit-text-fill-color|--[\w-]+)\s*:\s*)([^;}"`\n]*)/gi;
const anyColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g;
const hex6 = /(?<=[:\s"'(,=`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?=[\s;"')},`<])/g;
const rgbFn = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g;
const svgAttr = /(\b(?:fill|stroke|stop-color|flood-color|color)=["'])(#[0-9a-fA-F]{3,8})(["'])/g;
const meta = /(<meta[^>]+name=["']theme-color["'][^>]+content=["'])(#[0-9a-fA-F]{3,8})(["'])/gi;

const table = new Map();
function recolor(text, semantic, file) {
  const m = (lit) => {
    if (!parseColor(lit)) return lit;
    const out = mapLiteral(lit, { semantic, overrides: OVERRIDES });
    const k = lit.toLowerCase().replace(/\s+/g, '');
    const e = table.get(k) || { to: out, n: 0 };
    e.n++; e.to = out; table.set(k, e);
    return out;
  };
  let t = text;
  t = t.replace(cssProp, (all, pre, head, val) => pre + head + val.replace(anyColor, m));
  t = t.replace(rgbFn, m);
  t = t.replace(hex6, m);
  t = t.replace(svgAttr, (all, a, c, z) => a + m(c) + z);
  t = t.replace(meta, (all, a, c, z) => a + m(c) + z);
  return t;
}

// Text on a gold button or badge is navy, not white (white on this gold is only 2.4:1; navy is 6.5:1).
const GOLD_BG = /background(?:-color)?\s*:\s*(?:#c9a050|var\(--(?:brass|red|gold)(?![\w-])[^)]*\))/i;
const WHITE_TEXT = /(^|[;{\s"'])(color\s*:\s*)(#fff(?:fff)?|white)(?![\w-])/i;
const fixOnGold = (block) => (GOLD_BG.test(block) && WHITE_TEXT.test(block) ? block.replace(WHITE_TEXT, '$1$2#142434') : block);
// Muted text in a block that has a dark background is the lighter slate (the darker one is for light pages).
const DARK_BG = /background(?:-color)?\s*:\s*(?:#142434|#2b3a4c|#1b242d|var\(--(?:dark|dark-2|ink|panel)(?![\w-])[^)]*\))/i;
const SLATE2_TEXT = /(^|[;{\s"'])(color\s*:\s*)#8a919b(?![\w-])/i;
const fixOnDark = (block) => (DARK_BG.test(block) && SLATE2_TEXT.test(block) ? block.replace(SLATE2_TEXT, '$1$2#b4bac4') : block);
function onGold(text) {
  return text.replace(/\{[^{}]*\}/g, (b) => fixOnDark(fixOnGold(b))).replace(/style=("[^"]*"|'[^']*')/g, (all, v) => 'style=' + fixOnDark(fixOnGold(v)));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(extname(name))) yield p;
  }
}

let changed = 0;
const offenders = [];
for (const p of walk('.')) {
  const rel = relative('.', p).split('\\').join('/');
  if (SKIP_PREFIX.some((s) => rel.startsWith(s))) continue;
  const old = readFileSync(p, 'utf8');
  const semantic = rel.startsWith('admin/') || rel.startsWith('account/');
  const t = onGold(recolor(old, semantic, rel));
  if (t !== old) {
    changed++;
    if (MODE === 'write') writeFileSync(p, t);
    else if (MODE === 'check') offenders.push(rel);
  }
}

if (MODE === 'table') {
  const rows = [...table].filter(([from, v]) => v.to !== from && v.to.toLowerCase() !== from).sort((a, b) => b[1].n - a[1].n);
  for (const [from, { to, n }] of rows) console.log(String(n).padStart(6), from.padEnd(24), '->', to);
  console.log(`${rows.length} distinct colours would change, in ${changed} files`);
} else if (MODE === 'check') {
  if (offenders.length) { console.error(`${offenders.length} file(s) use a colour outside the palette, e.g. ${offenders.slice(0, 5).join(', ')} (run node scripts/recolor-site.mjs)`); process.exit(1); }
  console.log('every colour is in the palette');
} else console.log(`${changed} file(s) recoloured`);
