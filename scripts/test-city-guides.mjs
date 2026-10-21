// The local facts on the city pages (data/city-guides/*.json) must each carry a source and a verbatim proof, must not repeat each other, and
// must not contain a number that is not in their proof. (That the pages match the data is checked by apply-city-guides.mjs --check.)
import { loadGuides } from './city-guides-data.mjs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const cities = Object.entries(loadGuides());
ok(cities.length >= 1, `${cities.length} city guide(s) in the data file`);

const all = [];
for (const [key, g] of cities) {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(g.checked || ''), `${key}: has a "checked" date`);
  ok(g.courthouse && Number.isFinite(g.courthouse.lat) && Number.isFinite(g.courthouse.lng) && g.courthouse.address, `${key}: has a courthouse with a map position`);
  ok(g.pages && g.pages.index, `${key}: has a city page guide`);
  for (const [page, def] of Object.entries(g.pages)) {
    ok(def.title && def.groups?.length >= 1, `${key}/${page}: has a title and at least one group`);
    for (const gr of def.groups || []) for (const it of gr.items || []) all.push({ where: `${key}/${page}`, it });
  }
}

const norm = (s) => String(s).replace(/(\d),(\d)/g, '$1$2').replace(/\.00\b/g, '');
const noProof = [], noSource = [], badUrl = [], longText = [], invented = [];
for (const { where, it } of all) {
  if (!it.proof || it.proof.length < 20) noProof.push(it.text.slice(0, 40));
  if (!Array.isArray(it.sources) || !it.sources.length) noSource.push(it.text.slice(0, 40));
  for (const s of it.sources || []) {
    let u; try { u = new URL(s.url); } catch { u = null; }
    if (!u || u.protocol !== 'https:' || u.search || /(^|\.)lawdb\.ca$/.test(u.hostname) || !s.label) badUrl.push(s.url);
  }
  if (it.text.length > 520) longText.push(it.text.slice(0, 40));
  // every figure in the sentence must be in the proof (a wrong or invented number is the worst mistake a guide can make)
  const proof = norm(it.proof);
  for (const n of norm(it.text).match(/\d+/g) || []) if (!proof.includes(n)) invented.push(`${where}: "${n}" in "${it.text.slice(0, 50)}"`);
}
ok(all.length >= 10, `${all.length} sourced facts`);
ok(!noProof.length, `every fact has a proof taken from its source${noProof.length ? ': ' + noProof.slice(0, 2).join(' | ') : ''}`);
ok(!noSource.length && !badUrl.length, `every fact links to an https source with a label, and none to LawDB itself${badUrl.length ? ': ' + badUrl.slice(0, 2).join(' | ') : ''}`);
ok(!longText.length, 'each fact is short enough to read at a glance (520 characters at most)');
ok(!invented.length, `every number in a fact also appears in its proof${invented.length ? ': ' + invented.slice(0, 3).join(' | ') : ''}`);
// a city's own pages never repeat a fact; a few facts that are true province-wide (legal aid, the regulator) may appear in more than one city,
// but most of a city's guide has to be its own
const byCity = new Map();
for (const x of all) { const c = x.where.split('/').slice(0, 2).join('/'); (byCity.get(c) || byCity.set(c, []).get(c)).push(x.it.text); }
const dupWithin = [...byCity].filter(([, t]) => new Set(t).size !== t.length).map(([c]) => c);
ok(!dupWithin.length, `no fact is repeated within a city${dupWithin.length ? ': ' + dupWithin.join(', ') : ''}`);
const seenIn = new Map();
for (const [c, t] of byCity) for (const x of new Set(t)) (seenIn.get(x) || seenIn.set(x, new Set()).get(x)).add(c);
const shared = [...byCity].map(([c, t]) => [c, new Set(t).size ? [...new Set(t)].filter((x) => seenIn.get(x).size > 1).length / new Set(t).size : 0]).filter(([, r]) => r > 0.3);
ok(!shared.length, `at most 30% of a city's facts are shared with another city${shared.length ? ': ' + shared.map(([c, r]) => `${c} ${Math.round(r * 100)}%`).join(', ') : ''}`);

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
