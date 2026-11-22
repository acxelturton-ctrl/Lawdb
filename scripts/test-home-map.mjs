// The map of Canada on the home page (images/ca-map.svg, src/lib/map-projection.js, src/routes/map.js, scripts/build-ca-map.mjs, home-map.js, home-map.css):
//   node --no-warnings scripts/test-home-map.mjs
// The drawing is what the builder makes, a logo lands on its city, only our own logo files are used, the quotas and round-robin hold, the page has the map in place of
// the old "Why LawDB" band, every logo is on land inside its own province (never in the water), the whole map fits a phone, and the script puts each logo where the
// server says.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { projection, W, H } from '../src/lib/map-projection.js';
import { drawing, LIVE } from './build-ca-map.mjs';
import { logoOf, pickLogos, mapPoints } from '../src/routes/map.js';
import { provinceAt, inland } from '../src/lib/map-land.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the drawing
const svg = readFileSync('images/ca-map.svg', 'utf8');
ok(svg === drawing(), 'images/ca-map.svg is what scripts/build-ca-map.mjs makes (run it again if this fails)');
ok(svg.includes(`viewBox="0 0 ${W} ${H}"`) && (svg.match(/<path /g) || []).length >= 12 && (svg.match(/class="live"/g) || []).length === LIVE.size, `a ${W}x${H} drawing with every province and territory, and ${LIVE.size} live provinces in gold`);
const firms = JSON.parse(readFileSync('firms_data.json', 'utf8'));
ok([...new Set(firms.map((f) => f.province))].every((p) => LIVE.has(p)), 'every province that has a firm in the site data is drawn as live');
ok(!/<script|onload|href=/i.test(svg) && svg.length < 120 * 1024, 'the drawing is only shapes, and small');
ok(readFileSync('.assetsignore', 'utf8').split('\n').includes('data/canada-provinces.json'), 'the outlines the drawing is made from are not served as a public file');

// ---- the projection
{
  const proj = projection();
  const at = (lat, lng) => proj([lng, lat]);
  const [van, cal, win, tor, mtl] = [at(49.28, -123.12), at(51.05, -114.07), at(49.9, -97.14), at(43.65, -79.38), at(45.5, -73.57)];
  ok([van, cal, win, tor, mtl].every((p) => p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H), 'Vancouver, Calgary, Winnipeg, Toronto and Montreal all land on the drawing');
  ok(van[0] < cal[0] && cal[0] < win[0] && win[0] < tor[0] && tor[0] < mtl[0], 'from west to east: Vancouver, Calgary, Winnipeg, Toronto, Montreal');
  ok(tor[1] > win[1] && tor[1] > cal[1], 'Toronto is further south than Winnipeg and Calgary');
  const st = at(47.56, -52.71); // St. John's
  ok(st && st[0] < W && st[1] > 0 && st[1] < H, 'even St. John\'s is on the drawing');
}

// ---- land and provinces
{
  const proj = projection();
  const at = (lat, lng) => { const p = proj([lng, lat]); return [p[0], p[1]]; };
  const [win, cal, edm, kam, lon] = [at(49.9, -97.14), at(51.05, -114.07), at(53.55, -113.49), at(50.67, -120.33), at(42.98, -81.25)];
  ok(provinceAt(...win) === 'MB' && provinceAt(...cal) === 'AB' && provinceAt(...edm) === 'AB' && provinceAt(...kam) === 'BC' && provinceAt(...lon) === 'ON', 'the land grid knows Winnipeg is in Manitoba, Calgary and Edmonton in Alberta, Kamloops in BC and London in Ontario');
  ok(provinceAt(...at(47.6, -122.3)) === '' && provinceAt(...at(45, -55)) === '' && provinceAt(...at(42.33, -83.05)) === '' && provinceAt(-5, 10) === '' && provinceAt(W + 50, 100) === '', 'Seattle, the Atlantic, Detroit and anywhere off the drawing are not Canada');
  ok(inland(...win, 'MB', 13) && !inland(...win, 'ON', 0) && !inland(...at(49.3, -123.5), 'BC', 13), 'a circle has to be wholly inside the province: Winnipeg\'s is, a point in the wrong province is not, a point out in the Strait of Georgia is not');
}

// ---- which logos
ok(logoOf('images/logos/a-b-law.png') === '/images/logos/a-b-law.png' && logoOf('images/logos/x.SVG') === '/images/logos/x.SVG' && logoOf('img/0123456789abcdef01234567') === '/img/0123456789abcdef01234567', 'a logo file of the site, or one the firm uploaded, is used');
ok(['https://other.example/logo.png', 'http://x.example/a.png', 'javascript:alert(1)', 'images/logos/../../secret.png', 'images/hero/cover.jpg', 'images/logos/a.png?x=1', '//x.example/a.png', 'img/xyz', '', null, undefined, 5].every((s) => logoOf(s) === ''), 'nothing from another site, no path tricks, no cover pictures, no junk');

const row = (n, province, city, extra = {}) => ({ slug: `f${n}`, city, province, lat: 43.65, lng: -79.38, type: 'logo', src: `images/logos/f${n}.png`, logoBg: null, ...extra });
const TOR = { lat: 43.65, lng: -79.38 }, OTT = { lat: 45.42, lng: -75.7 }, WPG = { lat: 49.9, lng: -97.14 }, VAN = { lat: 49.28, lng: -123.12 };
{
  const rows = [];
  for (let i = 0; i < 80; i++) rows.push(row(i, 'ON', i % 2 ? 'Toronto' : 'Ottawa', i % 2 ? TOR : OTT));
  for (let i = 80; i < 90; i++) rows.push(row(i, 'MB', 'Winnipeg', WPG));
  rows.push(row(90, 'ON', 'Hamilton', { lat: 43.25, lng: -79.87, type: 'mono', src: '' }), row(91, 'ON', 'Hamilton', { lat: 43.25, lng: -79.87, src: 'https://other.example/x.png' }), row(92, 'ON', 'Guelph', { lat: null, lng: null }), row(93, 'ON', 'London', { lat: 'x', lng: 'y' }), row(94, 'ON', 'Nowhere', { lat: -80, lng: 10 }));
  const logos = pickLogos(rows);
  const on = logos.filter((l) => l[0].startsWith('ON|')), mb = logos.filter((l) => l[0].startsWith('MB|'));
  ok(on.length === 40 && mb.length === 8, 'at most 40 logos in Ontario and 8 in Manitoba, however many firms there are');
  ok(!logos.some((l) => /Hamilton|Guelph|London|Nowhere/.test(l[0])), 'a firm with no logo of ours, no position or a position off the drawing is left out');
  ok(on.slice(0, 4).map((l) => l[0]).join() === 'ON|Ottawa,ON|Toronto,ON|Ottawa,ON|Toronto', 'one city at a time, round-robin, so every city is on the map before any has a second');
  ok(logos.every((l) => l.length === 4 && typeof l[1] === 'number' && typeof l[2] === 'number' && l[3].startsWith('/images/logos/')), 'each entry is [city, x, y, logo]');
  ok(logos.every((l) => inland(l[1], l[2], l[0].split('|')[0], 13)), 'every logo is wholly on land, inside its own province: none in the water, none across the border');
  const tor = on.filter((l) => l[0] === 'ON|Toronto');
  ok(new Set(tor.map((l) => `${l[1]},${l[2]}`)).size === tor.length, 'the logos of a city never share a place');
  const origin = projection()([TOR.lng, TOR.lat]);
  ok(tor.every((l) => Math.hypot(l[1] - origin[0], l[2] - origin[1]) < 120), 'and stay together in a ring around their city');
  const vanLogos = pickLogos(Array.from({ length: 12 }, (_, i) => row(i, 'BC', 'Vancouver', VAN)));
  ok(vanLogos.length === 12 && vanLogos.every((l) => provinceAt(l[1], l[2]) === 'BC' && inland(l[1], l[2], 'BC', 13)), 'a city on the coast gets its ring on the land side: 12 logos for Vancouver, all in BC and none in the sea');
  const small = pickLogos(rows, { small: true });
  ok(small.filter((l) => l[0].startsWith('ON|')).length === 22 && small.filter((l) => l[0].startsWith('MB|')).length === 5 && small.length < logos.length, 'for a phone: fewer logos (22 in Ontario, 5 in Manitoba)');
  ok(small.every((l) => inland(l[1], l[2], l[0].split('|')[0], 26)), 'and each one has the room a bigger logo on a small map needs: its whole circle is on land too');
  const bg = pickLogos([row(1, 'ON', 'Toronto', { logoBg: '#2a2a2a' }), row(2, 'ON', 'Ottawa', { ...OTT, logoBg: 'red' })]);
  ok(bg.find((l) => l[3].endsWith('f1.png'))[4] === '#2a2a2a' && bg.find((l) => l[3].endsWith('f2.png')).length === 4, 'a logo drawn on its own colour carries that colour; a bad colour is dropped');
  const ns = pickLogos([row(1, 'NS', 'Halifax', { lat: 44.65, lng: -63.57 })]);
  ok(ns.length === 1 && provinceAt(ns[0][1], ns[0][2]) === 'NS' && pickLogos([]).length === 0, 'a province with no quota of its own still gets a few, on its own land; no firms, no logos');
  const tiny = pickLogos([row(1, 'PE', 'Charlottetown', { lat: 46.24, lng: -63.13 }), row(2, 'PE', 'Charlottetown', { lat: 46.24, lng: -63.13 })], { small: true });
  ok(tiny.length === 2 && tiny.every((l) => Number.isFinite(l[1]) && Number.isFinite(l[2])), 'a province too small for the room a logo needs still gets its logos (placed as close as can be)');
}

// ---- the route, on a real database
{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE firms (slug TEXT PRIMARY KEY, data TEXT, status TEXT, province TEXT, city TEXT, featured INTEGER DEFAULT 0, rating REAL DEFAULT 0, review_count INTEGER DEFAULT 0)');
  const add = (slug, status, featured, rating, extra = {}) => db.prepare('INSERT INTO firms (slug, data, status, province, city, featured, rating, review_count) VALUES (?,?,?,?,?,?,?,?)').run(slug, JSON.stringify({ slug, lat: 43.65, lng: -79.38, type: 'logo', src: `images/logos/${slug}.png`, ...extra }), status, 'ON', 'Toronto', featured, rating, 10);
  add('plain-low', 'live', 0, 3.1); add('plain-high', 'live', 0, 4.9); add('feat', 'live', 1, 4.0); add('hidden', 'hidden', 1, 5); add('pending', 'pending', 0, 5);
  const d1 = { prepare(sql) { const st = db.prepare(sql); const o = { bind() { return o; }, async all() { return { results: st.all() }; } }; return o; } };
  const res = await mapPoints({ request: new Request('https://lawdb.ca/api/map'), env: { DB: d1 } });
  const resSmall = await mapPoints({ request: new Request('https://lawdb.ca/api/map?small=1'), env: { DB: d1 } });
  const body = await res.json();
  ok(resSmall.status === 200 && (await resSmall.json()).logos.length === 3, '?small=1 answers too (for phones)');
  ok(res.status === 200 && /public, max-age=3600/.test(res.headers.get('cache-control')) && body.w === W && body.h === H, 'GET /api/map is public JSON, cached for an hour, with the size of the drawing');
  ok(body.logos.map((l) => l[3]).join() === '/images/logos/feat.png,/images/logos/plain-high.png,/images/logos/plain-low.png', 'only live firms, a city\'s Featured firm first and then the best rated');
}

// ---- the page
const index = readFileSync('index.html', 'utf8');
ok(!/why-b|whyBH/.test(index) && !/why-b/.test(readFileSync('home-wide.css', 'utf8')) && !/Why LawDB/.test(index), 'the old "Why LawDB" band and its styles are gone');
ok(/<div class="hm-badge"><img src="\/images\/logo-icon\.svg" alt=""[^>]*><span><b>Find your lawyer, faster\.<\/b><small>Real law firms across Canada\.<\/small><\/span><\/div>/.test(index) && existsSync('images/logo-icon.svg') && index.indexOf('class="hm-bg"') < index.indexOf('class="hm-badge"'), 'the LawDB mark and the line "Find your lawyer, faster." sit in the empty north of the map');
ok(/<section class="hm" id="camap" aria-label="Map of the law firms LawDB lists across Canada">/.test(index) && /id="hmMap"><img class="hm-bg" src="\/images\/ca-map\.svg" alt="Map of Canada[^"]*"/.test(index), 'the home page has the map section, named for screen readers, with the drawing and a text alternative');
ok(!/hm-head|hm-eyebrow|hmTitle|hmSub|Directory coverage|Law firms across Canada|Browse law firms by province/.test(index) && !/hm-head|hm-eyebrow/.test(readFileSync('home-map.css', 'utf8')), 'there is no heading above the map (no \"Directory coverage\", no \"Law firms across Canada\", no \"Browse law firms by province and city\") and none of its styles are left');
ok(!/hm-foot|Browse firms by city/.test(index) && !/hm-foot/.test(readFileSync('home-map.css', 'utf8')) && /<section class="citystrip" id="cities">/.test(index), 'there is no "Browse firms by city" button under the map (and none of its styles); the city list it used to jump to is still on the page');
ok(index.indexOf('class="h5-stats"') < index.indexOf('class="hm"') && index.indexOf('class="hm"') < index.indexOf('class="top-c"'), 'it sits where the old band was: after the numbers, before the top-rated lawyers');
ok(index.includes('href="home-map.css?v=1"') && index.includes('src="home-map.js?v=1" defer') && existsSync('home-map.css') && existsSync('home-map.js'), 'its stylesheet and script are linked and exist');
const css = readFileSync('home-map.css', 'utf8');
ok(new RegExp(`aspect-ratio:${W}/${H}`).test(css) && /--pin:clamp\(18px,2\.3vw,30px\)/.test(css) && /--pin:20px/.test(css) && /prefers-reduced-motion/.test(css) && /pointer-events:none/.test(css), 'the map is drawn at the drawing\'s own proportions, is still for people who ask for less motion, and cannot be clicked');
ok(/body\.pg-home section\.hm\{ padding:14px 20px 10px; \}/.test(css) && /@media\(max-width:760px\)\{ body\.pg-home section\.hm\{ padding:8px 0 6px; \}/.test(css) && /\.hm-scroll\{ padding:0; margin:0; \}/.test(css), 'the band is tight around the map: 14px above, 10px below on a computer, 8px and 6px on a phone');
ok(!/min-width:\d+px/.test(css.replace(/@media\(min-width/g, '')) && !/overflow-x:\s*(auto|scroll)/.test(css) && /\.hm\{ overflow:hidden;/.test(css), 'the whole map fits the screen: nothing to swipe sideways on a phone, and nothing sticks out of the band');
ok(/\.hm-badge\{[^}]*pointer-events:none/.test(css) && /@media\(max-width:760px\)\{[^}]*\.hm-badge/.test(css), 'the badge is part of the picture (not clickable) and has its own smaller size on a phone');
ok(/run_worker_first[\s\S]*"\/api\/\*"/.test(readFileSync('wrangler.jsonc', 'utf8')) && /route\('GET', '\/api\/map', mapPoints\)/.test(readFileSync('src/worker.js', 'utf8')), 'the Worker answers /api/map');

// ---- the script that puts the logos on the map (home-map.js, run against a small stand-in for the page)
async function lay(logos, sizes, { fail = false, phone = false } = {}) {
  const urls = [];
  const el = () => ({ className: '', style: {}, children: [], setAttribute() {}, appendChild(c) { this.children.push(c); } });
  const root = { children: [], appendChild(c) { this.children.push(c); } };
  class Img {
    constructor() { this.l = {}; this.naturalWidth = 0; this.naturalHeight = 0; }
    addEventListener(t, f) { this.l[t] = f; }
    set src(v) { this._src = v; setTimeout(() => { const z = sizes[v]; if (!z) { this.l.error && this.l.error(); return; } this.naturalWidth = z[0]; this.naturalHeight = z[1]; this.l.load && this.l.load(); }, 1); }
  }
  const sandbox = { document: { getElementById: (id) => (id === 'hmMap' ? root : null), createElement: () => el() }, window: { matchMedia: (q) => ({ matches: phone && /max-width:\s*760px/.test(q) }) }, Image: Img, setTimeout,
    fetch: (u) => { urls.push(u); return fail ? Promise.reject(new Error('down')) : Promise.resolve({ ok: true, json: () => Promise.resolve({ w: W, h: H, logos }) }); }, console };
  vm.runInNewContext(readFileSync('home-map.js', 'utf8'), sandbox);
  await new Promise((r) => setTimeout(r, 400));
  return { pins: root.children, urls };
}
{
  const logos = [['ON|Toronto', 700, 330, '/images/logos/a.png'], ['ON|Toronto', 720, 345, '/images/logos/b.png'], ['ON|Ottawa', 800, 300, '/images/logos/wide.png'], ['ON|Ottawa', 810, 310, '/images/logos/tiny.png'], ['ON|Ottawa', 820, 320, '/images/logos/gone.png'], ['MB|Winnipeg', 413, 459, '/images/logos/dark.png', '#2a2a2a']];
  const sizes = Object.fromEntries(logos.map((l) => [l[3], [120, 100]]));
  sizes['/images/logos/wide.png'] = [400, 60]; sizes['/images/logos/tiny.png'] = [10, 10]; delete sizes['/images/logos/gone.png'];
  const { pins, urls } = await lay(logos, sizes);
  const at = (p) => [parseFloat(p.style.left) / 100 * W, parseFloat(p.style.top) / 100 * H];
  ok(pins.length === 4, `4 of 6 are placed: a picture too small to see and a logo that does not load are left out, a wide wordmark is not (${pins.length})`);
  ok(pins.every((p) => logos.some((l) => Math.abs(at(p)[0] - l[1]) < 0.1 && Math.abs(at(p)[1] - l[2]) < 0.5)), 'each logo goes exactly where the server put it (the page does no layout of its own)');
  ok(urls.join() === '/api/map', 'on a computer it asks for /api/map');
  const dark = pins.find((p) => p.style.background === '#2a2a2a');
  ok(dark && /\bfull\b/.test(dark.className), 'a logo drawn on its own colour fills its circle with that colour');
  ok(pins.every((p) => /\bhm-pin\b/.test(p.className) && /^\d+(\.\d+)?%$/.test(p.style.left) && /^\d+(\.\d+)?$/.test(p.style.zIndex) && /^\d+ms$/.test(p.style.animationDelay) && p.children.length === 1 && p.children[0].alt === ''), 'each pin is a circle with a picture that has no alt text, that pops in after the one before (the map is only a picture)');
  ok((await lay([], {}, { fail: true })).pins.length === 0, 'if the data cannot be fetched the plain map is left alone');
  ok((await lay(logos, sizes, { phone: true })).urls.join() === '/api/map?small=1', 'on a phone it asks for the smaller set: /api/map?small=1');
}
{
  const js = readFileSync('home-map.js', 'utf8');
  ok(/IntersectionObserver/.test(js) && /credentials: 'omit'/.test(js) && !/referrerPolicy/.test(js) && !/innerHTML/.test(js) && !/scrollLeft|Math\.sqrt/.test(js), 'nothing is fetched until the map is about to scroll into view; no cookies sent; no markup built from data; no layout and no scrolling in the page script');
}

console.log(bad ? `\n${bad} check(s) failed` : '\nall home map checks passed');
process.exit(bad ? 1 : 0);
