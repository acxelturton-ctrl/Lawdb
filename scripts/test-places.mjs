// Place search: a town with no firm of its own (Keswick) is found and answered with the nearest firms (lawdb-places.js + places.json).
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failed++; };

const ctx = vm.createContext({});
vm.runInContext(readFileSync('lawdb-places.js', 'utf8'), ctx);
const P = ctx.LawdbPlaces;
const data = JSON.parse(readFileSync('places.json', 'utf8'));
P.build(data.places);

const firms = [];
for (const f of JSON.parse(readFileSync('firms_data.json', 'utf8'))) firms.push(f);
for (const file of readdirSync('data').filter((n) => /^firms-batch-\d+\.json$/.test(n)).sort()) for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) firms.push(f);
const cities = new Set(firms.map((f) => `${f.city}|${f.province}`));

ok(data.places.length > 5000, `places.json has ${data.places.length} places`);
ok(data.places.every((p) => ['ON', 'QC', 'BC', 'AB', 'MB'].includes(p[1]) && p[2] > 41 && p[2] < 61 && p[3] < -52 && p[3] > -141), 'every place sits inside the five provinces');
ok(data.places.every((p, i, a) => i === 0 || a.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i), 'no place is listed twice');

const label = (text) => P.find(text).map((p) => p.label).join(' / ');
ok(label('Keswick') === 'Keswick, ON', 'Keswick is found');
ok(label('keswick, on') === 'Keswick, ON' && label('KESWICK ontario') === 'Keswick, ON', 'a province after the name is understood');
ok(label('  Keswick  ') === 'Keswick, ON', 'extra spaces do not matter');
ok(label('Montreal') === 'Montréal, QC', 'accents are optional');
ok(label('saint catharines') === 'St. Catharines, ON' && label('st catharines') === 'St. Catharines, ON', '"saint" and "st" are the same word');
ok(/^Sutton, QC \/ Sutton, ON$/.test(label('Sutton')), 'two places with one name are both offered, the bigger first');
ok(label('sutton on') === 'Sutton, ON', '...and the province picks one');
ok(label('Bradford') === 'Bradford, ON' && label('Okotoks') === 'Okotoks, AB' && label('North York') === 'North York, ON', 'towns that are not in the firm list are found');
ok(P.find('Nowhereville').length === 0 && P.find('').length === 0, 'something that is not a place finds nothing');
ok(P.suggest('kesw', 4)[0].label === 'Keswick, ON', 'a place is suggested while it is still being typed');
ok(P.suggest('k', 4).length === 0, 'one letter suggests nothing');
ok(P.suggest('bradf', 4).some((p) => p.label === 'Bradford, ON'), 'Bradford is suggested from "bradf"');

// the firms nearest to Keswick
const kes = P.find('Keswick')[0];
const near = P.nearest(firms, kes.lat, kes.lng, { max: 10 });
ok(near.list.length === 10 && near.list.every((x, i, a) => i === 0 || a[i - 1].km <= x.km), 'the nearest firms come back nearest first');
ok(near.list[0].km < 60, `the closest firm to Keswick is ${near.list[0].f.city}, ${Math.round(near.list[0].km)} km away`);
const crim = P.nearest(firms, kes.lat, kes.lng, { caseId: 'criminal', max: 10 });
ok(!crim.widened && crim.list.every((x) => x.f.caseTypes.includes('criminal')), 'a practice area keeps only firms that do it');
const rare = [{ lat: 44.2, lng: -79.4, caseTypes: ['family'], name: 'A' }, { lat: 44.3, lng: -79.5, caseTypes: ['family'], name: 'B' }];
const wide = P.nearest(rare, kes.lat, kes.lng, { caseId: 'immigration' });
ok(wide.widened && wide.list.length === 2, 'with no firm for that practice area nearby, every firm is listed and the result says so');
ok(P.nearest([], 44, -79, { caseId: 'family' }).list.length === 0, 'no firms gives an empty list');
ok(Math.abs(P.km(43.65, -79.38, 45.42, -75.7) - 351) < 5, 'distances are right (Toronto to Ottawa is about 351 km)');

// every city we list firms in can be looked up too
const missing = [...cities].filter((k) => { const [c, p] = k.split('|'); return !P.find(`${c}, ${p}`).length; });
console.log(`INFO  ${cities.size - missing.length} of ${cities.size} firm cities are also in the place list` + (missing.length ? ` (not in it: ${missing.join('; ')})` : ''));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nplaces checks passed');
