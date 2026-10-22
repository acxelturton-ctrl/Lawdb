// The site's colours: navy, gold and cream (plus white and two greys), taken from the home page design. Every colour in the site's CSS, inline
// styles, SVG attributes and scripts has to be one of these (scripts/test-palette.mjs fails otherwise); scripts/recolor-site.mjs maps any other
// colour to the nearest of them, by hue family and lightness, so it is safe to run again after pasting in something from elsewhere.
//   gold on a light page is only for fills, borders and large type; small gold text uses goldDeep (4.7:1 on cream), and text on a gold button is ink.
export const PALETTE = {
  ink: '#142434',       // text and headings (navy)
  ink2: '#2b3a4c',      // a lighter navy: avatars, lines on dark panels, dark chips
  panel: '#1b242d',     // dark panels: footer, menu drawer, the Kind of lawyer + City bar
  gold: '#c9a050',      // buttons, fills, icons, borders
  goldDeep: '#8a6224',  // gold text and links on cream or white (4.9:1 on cream)
  goldLight: '#e2bd6a', // gold on a dark panel
  goldEdge: '#e6d4a4',  // a gold-tinted border
  goldTint: '#f4ecd8',  // a gold-tinted background (hover, chips, notes)
  cream: '#f5f3ec',     // the page
  cream2: '#edeae1',    // a band on the page
  line: '#e3dfd3',      // borders and dividers
  white: '#ffffff',
  slate: '#586170',     // secondary text
  slate2: '#8a919b',    // placeholders and disabled text on a light page
  slate3: '#b4bac4',    // muted text on a dark panel (9.9:1 on the panel)
};
export const PALETTE_HEX = new Set(Object.values(PALETTE));

// ---- colour maths
export function parseColor(s) {
  s = String(s).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1, form: 'hex' };
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4], form: 'rgb' };
  return null;
}
export function hsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}
const hex2rgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

// Which palette colour stands in for this one. `semantic` keeps pure signal colours (red, green) for the owner-only admin and account screens.
export function nearest(rgb, { semantic = false } = {}) {
  const { h, s, l } = hsl(rgb);
  const P = PALETTE;
  if (l >= 0.975) return P.white;
  const warm = h >= 15 && h < 65 && s >= 0.3;          // gold, yellow, orange, brown, cream-yellow
  const red = (h < 15 || h >= 335) && s >= 0.3;
  const green = h >= 65 && h < 170 && s >= 0.2;
  if (semantic && (red || green) && l > 0.2 && l < 0.85) return null; // kept as it is (admin and account status colours)
  const neutral = s < 0.12;
  // light end: the page, bands, borders
  if (l >= 0.955) return P.cream;
  if (l >= 0.9) return warm && s >= 0.5 ? P.goldTint : P.cream2;
  if (l >= 0.86) return warm && s >= 0.3 ? P.goldTint : P.line;
  if (l >= 0.78) return warm && s >= 0.4 ? P.goldEdge : P.line;
  if (l >= 0.7) return warm && s >= 0.6 ? P.goldLight : P.line;
  if (l >= 0.55) return (warm || red) && s >= 0.45 ? P.gold : P.slate2;
  if (l >= 0.45) return warm || red ? P.gold : neutral ? P.slate2 : P.slate;
  if (l >= 0.3) return warm || red ? P.goldDeep : P.slate;
  if (l >= 0.165) return neutral ? (l >= 0.17 ? P.ink2 : P.ink) : P.ink2;
  if (l >= 0.12) return neutral ? P.ink : P.ink2;
  return neutral ? P.panel : P.ink;
}

export function toCss(rgb, hexOut, alpha) {
  if (alpha < 1) return `rgba(${rgb.r},${rgb.g},${rgb.b},${+alpha.toFixed(3)})`;
  return hexOut;
}

// Map one colour literal (hex or rgb()/rgba()) to the palette; returns the text unchanged if it is already a palette colour or must be kept.
export function mapLiteral(text, opts = {}) {
  const c = parseColor(text);
  if (!c) return text;
  const hexIn = '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (PALETTE_HEX.has(hexIn)) return text; // already a palette colour (with or without opacity)
  const target = (opts.overrides && opts.overrides[hexIn]) || nearest(c, opts);
  if (target === null) return text; // kept
  const t = hex2rgb(target);
  if (c.a < 1) {
    // an overlay colour with some opacity: the palette colour with the same opacity
    return `rgba(${t.r},${t.g},${t.b},${+c.a.toFixed(3)})`;
  }
  return target === '#ffffff' && /^#fff$/i.test(text) ? '#fff' : target;
}
