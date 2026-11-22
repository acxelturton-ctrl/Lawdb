// Draws Canada (images/ca-map.svg) for the home page map. Run: node scripts/build-ca-map.mjs   (or --check, which fails when the file is not what this makes)
// Uses the same projection as src/routes/map.js (src/lib/map-projection.js), so a firm's logo lands on its city. The provinces that have firms listed carry class
// "live" (the gold ones); when firms are added in another province, add it to LIVE below and run this again.
//
// The outlines are Natural Earth's 1:50m provinces and territories (public domain, naturalearthdata.com), kept in data/canada-provinces.json. To rebuild that file
// from a download of ne_50m_admin_1_states_provinces.geojson:  node scripts/build-ca-map.mjs --import path/to/ne_50m_admin_1_states_provinces.geojson
// To refit the projection (only if the frame changes): fitWidth(W - 20, frame) on the points from -134 to -52 degrees and 41.5 to 60 north, then move the top edge to y = 10.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoPath } from 'd3-geo';
import { projection, W, H } from '../src/lib/map-projection.js';

export const LIVE = new Set(['ON', 'QC', 'BC', 'AB', 'MB']);
const SOURCE = new URL('../data/canada-provinces.json', import.meta.url);
const TARGET = new URL('../images/ca-map.svg', import.meta.url);

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const svg = drawing();
  if (process.argv[2] === '--check') {
    let have = '';
    try { have = readFileSync(TARGET, 'utf8'); } catch { /* missing */ }
    if (have !== svg) { console.error('images/ca-map.svg is not what scripts/build-ca-map.mjs makes: run node scripts/build-ca-map.mjs'); process.exit(1); }
    console.log('images/ca-map.svg is current');
  } else {
    writeFileSync(TARGET, svg);
    console.log(`images/ca-map.svg: ${(svg.length / 1024).toFixed(0)} KB`);
  }
}
