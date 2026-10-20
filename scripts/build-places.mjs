// Builds places.json: the towns and villages people may type into the search box ("Keswick", "Bradford", "Okotoks"), each with where it is,
// so a place that has no firm of its own can still be answered with the firms nearest to it (see lawdb-places.js).
//   node scripts/build-places.mjs <path to GeoNames CA.txt>
// CA.txt is the Canada dump from https://download.geonames.org/export/dump/CA.zip (CC BY 4.0, credit "GeoNames"). It is not kept in the repo; this
// script keeps the populated places of Ontario, Quebec, British Columbia, Alberta and Manitoba that are within 250 km of a listed firm, and the
// result is committed as places.json. Run it again whenever the GeoNames file or the firm list changes a lot.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-places.mjs <path to GeoNames CA.txt>'); process.exit(1); }

const ADMIN1 = { '08': 'ON', '10': 'QC', '02': 'BC', '01': 'AB', '03': 'MB' };
// GeoNames feature codes that are real, current places people live in. Historic, abandoned and "locality" entries with no people are skipped.
const SKIP = new Set(['PPLH', 'PPLQ', 'PPLS', 'PPLW', 'PPLF']);
const MAX_KM = 250;

const firms = [];
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) firms.push(f);
for (const file of readdirSync('data').filter((n) => /^firms-batch-\d+\.json$/.test(n)).sort()) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.push(f);
}
const spots = firms.filter((f) => typeof f.lat === 'number' && typeof f.lng === 'number').map((f) => [f.lat, f.lng]);

function km(a, b, c, d) {
  const t = Math.PI / 180, x = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
const nearestFirm = (la, ln) => spots.reduce((m, [a, b]) => Math.min(m, km(la, ln, a, b)), Infinity);

const round = (n) => Math.round(n * 1000) / 1000;
const best = new Map(); // "name|prov" -> the biggest entry
function keep(name, prov, la, ln, pop) {
  const k = `${name}|${prov}`;
  const have = best.get(k);
  if (!have || pop > have[4]) best.set(k, [name, prov, round(la), round(ln), pop]);
}

for (const line of readFileSync(src, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15 || f[6] !== 'P' || !ADMIN1[f[10]] || SKIP.has(f[7])) continue;
  const pop = Number(f[14]) || 0;
  if ((f[7] === 'PPLL' || f[7] === 'PPLX') && !pop) continue; // unnamed-size localities and neighbourhood sections only when someone lives there
  const la = Number(f[4]), ln = Number(f[5]);
  if (Number.isInteger(la) && Number.isInteger(ln)) continue; // a placeholder in the middle of a province, not a real spot
  if (nearestFirm(la, ln) > MAX_KM) continue;
  keep(f[1], ADMIN1[f[10]], la, ln, pop);
}

// Names people use that the GeoNames file does not carry as places.
for (const [name, prov, la, ln, pop] of [
  ['North York', 'ON', 43.7615, -79.4111, 691600],
  ['Scarborough', 'ON', 43.7731, -79.2578, 632000],
  ['Downtown Toronto', 'ON', 43.6532, -79.3832, 0],
]) keep(name, prov, la, ln, pop);

const places = [...best.values()].sort((a, b) => (b[4] - a[4]) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const out = '{"source":"GeoNames (CC BY 4.0), populated places within 250 km of a listed firm","places":[\n' + places.map((p) => JSON.stringify(p)).join(',\n') + '\n]}\n';
writeFileSync('places.json', out);
console.log(`${places.length} places, ${(out.length / 1024).toFixed(0)} KB`);
