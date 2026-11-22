// Draws Canada (images/ca-map.svg) for the home page map. Run: node scripts/build-ca-map.mjs   (or --check, which fails when the file is not what this makes)
// Uses the same projection as src/routes/map.js (src/lib/map-projection.js), so a firm's logo lands on its city. The provinces that have firms listed carry class
// "live" (the gold ones); when firms are added in another province, add it to LIVE below and run this again.
//
// The outlines are Natural Earth's 1:50m provinces and territories (public domain, naturalearthdata.com), kept in data/canada-provinces.json. To rebuild that file
// from a download of ne_50m_admin_1_states_provinces.geojson:  node scripts/build-ca-map.mjs --import path/to/ne_50m_admin_1_states_provinces.geojson
// It also writes src/lib/map-land.generated.js: a coarse grid of the same drawing (4 x 4 units a cell) saying which province each cell is in, so the Worker can keep
// a logo on land and inside its own province (src/routes/map.js). `--check` covers both files.
// To refit the projection (only if the frame changes): fitExtent([[10, 10], [W - 10, 5000]], the provinces), then move it up so the bottom of the country is at y = H - 12.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoPath, geoStream } from 'd3-geo';
import { projection, W, H } from '../src/lib/map-projection.js';

export const LIVE = new Set(['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE']);
const SOURCE = new URL('../data/canada-provinces.json', import.meta.url);
const TARGET = new URL('../images/ca-map.svg', import.meta.url);
const LAND = new URL('../src/lib/map-land.generated.js', import.meta.url);
const CELL = 4;

const round = (n) => Math.round(n * 1000) / 1000; // about 100 metres: plenty for a drawing 1000 pixels wide
const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(roundCoords));

if (process.argv[2] === '--import') {
  const gj = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const features = gj.features
    .filter((f) => f.properties.adm0_a3 === 'CAN')
    .map((f) => ({ type: 'Feature', properties: { postal: f.properties.postal, name: f.properties.name }, geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) } }))
    .sort((a, b) => a.properties.postal.localeCompare(b.properties.postal));
  writeFileSync(SOURCE, JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  console.log(`data/canada-provinces.json: ${features.length} provinces and territories`);
  process.exit(0);
}

export function drawing() {
  const features = JSON.parse(readFileSync(SOURCE, 'utf8')).features;
  const path = geoPath(projection().clipExtent([[-40, -40], [W + 40, H + 40]]));
  const d = (f) => (path(f) || '').replace(/(\d+)\.\d+/g, '$1');
  const body = features.map((f) => ({ f, d: d(f) })).filter((x) => x.d)
    .map(({ f, d: dd }) => `<path class="${LIVE.has(f.properties.postal) ? 'live' : 'st'}" d="${dd}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of Canada"><title>Canada</title><style>.st{fill:#ece6d3;stroke:#fffdf8;stroke-width:1}.live{fill:#e6d4a4;stroke:#fffdf8;stroke-width:1}</style>${body}</svg>\n`;
}

// Which province each cell of a CELL x CELL grid over the drawing is in: 0 = water or another country, else 1 + the province's place in CODES. The rings come from the
// projected outlines (the same ones the drawing is made from), and a cell belongs to a province when its centre is inside them (even-odd, so lakes and holes are water).
export function landMask() {
  const features = JSON.parse(readFileSync(SOURCE, 'utf8')).features;
  const CODES = features.map((f) => f.properties.postal);
  const proj = projection().clipExtent([[-40, -40], [W + 40, H + 40]]);
  const shapes = features.map((f) => {
    const rings = []; let cur = null;
    geoStream(f, proj.stream({ point(x, y) { cur.push([x, y]); }, lineStart() { cur = []; }, lineEnd() { rings.push(cur); }, polygonStart() {}, polygonEnd() {}, sphere() {} }));
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rings) for (const [x, y] of r) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
    return { rings, box };
  });
  const inside = (rings, x, y) => {
    let c = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL), runs = [];
  for (let j = 0; j < rows; j++) {
    const row = []; let last = -1, n = 0;
    for (let i = 0; i < cols; i++) {
      const x = i * CELL + CELL / 2, y = j * CELL + CELL / 2;
      let id = 0;
      for (let k = 0; k < shapes.length && !id; k++) {
        const b = shapes[k].box;
        if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(shapes[k].rings, x, y)) id = k + 1;
      }
      if (id === last) n++; else { if (n) row.push(last, n); last = id; n = 1; }
    }
    row.push(last, n);
    runs.push(row);
  }
  return `// Generated by scripts/build-ca-map.mjs (run it again, do not edit): which province each ${CELL} x ${CELL} cell of the home page map (images/ca-map.svg) is in.\n// Each row is runs of [province number, how many cells]; 0 is water or another country, otherwise 1 + the place in CODES. Read with src/lib/map-land.js.\n` +
    `export const CELL = ${CELL}, COLS = ${cols}, ROWS = ${rows};\nexport const CODES = ${JSON.stringify(CODES)};\nexport const RUNS = [\n${runs.map((r) => JSON.stringify(r)).join(',\n')},\n];\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = [[TARGET, drawing(), 'images/ca-map.svg'], [LAND, landMask(), 'src/lib/map-land.generated.js']];
  if (process.argv[2] === '--check') {
    for (const [target, text, name] of files) {
      let have = '';
      try { have = readFileSync(target, 'utf8'); } catch { /* missing */ }
      if (have !== text) { console.error(`${name} is not what scripts/build-ca-map.mjs makes: run node scripts/build-ca-map.mjs`); process.exit(1); }
    }
    console.log('images/ca-map.svg and src/lib/map-land.generated.js are current');
  } else {
    for (const [target, text, name] of files) { writeFileSync(target, text); console.log(`${name}: ${(text.length / 1024).toFixed(0)} KB`); }
  }
}
