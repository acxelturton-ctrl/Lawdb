// The map of Canada on the home page (images/ca-map.svg, src/lib/map-projection.js, src/routes/map.js, scripts/build-ca-map.mjs, home-map.js, home-map.css):
//   node --no-warnings scripts/test-home-map.mjs
// The drawing is what the builder makes, a logo lands on its city, only our own logo files are used, the quotas and round-robin hold, the page has the map in place of
// the old "Why LawDB" band, and the script that lays the logos out never stacks one on another.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { projection, W, H } from '../src/lib/map-projection.js';
import { drawing, LIVE } from './build-ca-map.mjs';
import { logoOf, pickLogos, mapPoints } from '../src/routes/map.js';

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

// ---- which logos
ok(logoOf('images/logos/a-b-law.png') === '/images/logos/a-b-law.png' && logoOf('images/logos/x.SVG') === '/images/logos/x.SVG' && logoOf('img/0123456789abcdef01234567') === '/img/0123456789abcdef01234567', 'a logo file of the site, or one the firm uploaded, is used');
ok(['https://other.example/logo.png', 'http://x.example/a.png', 'javascript:alert(1)', 'images/logos/../../secret.png', 'images/hero/cover.jpg', 'images/logos/a.png?x=1', '//x.example/a.png', 'img/xyz', '', null, undefined, 5].every((s) => logoOf(s) === ''), 'nothing from another site, no path tricks, no cover pictures, no junk');

const row = (n, province, city, extra = {}) => ({ slug: `f${n}`, city, province, lat: 43.65, lng: -79.38, type: 'logo', src: `images/logos/f${n}.png`, logoBg: null, ...extra });
{
  const rows = [];
  for (let i = 0; i < 80; i++) rows.push(row(i, 'ON', i % 2 ? 'Toronto' : 'Ottawa', { lat: i % 2 ? 43.65 : 45.42, lng: i % 2 ? -79.38 : -75.7 }));
  for (let i = 80; i < 90; i++) rows.push(row(i, 'MB', 'Winnipeg', { lat: 49.9, lng: -97.14 }));
  rows.push(row(90, 'ON', 'Hamilton', { lat: 43.25, lng: -79.87, type: 'mono', src: '' }), row(91, 'ON', 'Hamilton', { lat: 43.25, lng: -79.87, src: 'https://other.example/x.png' }), row(92, 'ON', 'Guelph', { lat: null, lng: null }), row(93, 'ON', 'London', { lat: 'x', lng: 'y' }), row(94, 'ON', 'Nowhere', { lat: -80, lng: 10 }));
  const logos = pickLogos(rows);
  const on = logos.filter((l) => l[0].startsWith('ON|')), mb = logos.filter((l) => l[0].startsWith('MB|'));
  ok(on.length === 44 && mb.length === 10, 'at most 44 logos in Ontario and 10 in Manitoba, however many firms there are');
  ok(!logos.some((l) => /Hamilton|Guelph|London|Nowhere/.test(l[0])), 'a firm with no logo of ours, no position or a position off the drawing is left out');
  ok(on.slice(0, 4).map((l) => l[0]).join() === 'ON|Ottawa,ON|Toronto,ON|Ottawa,ON|Toronto', 'one city at a time, round-robin, so every city is on the map before any has a second');
  ok(logos.every((l) => l.length === 4 && typeof l[1] === 'number' && typeof l[2] === 'number' && l[3].startsWith('/images/logos/')), 'each entry is [city, x, y, logo]');
  const bg = pickLogos([row(1, 'ON', 'Toronto', { logoBg: '#2a2a2a' }), row(2, 'ON', 'Ottawa', { lat: 45.42, lng: -75.7, logoBg: 'red' })]);
  ok(bg.find((l) => l[3].endsWith('f1.png'))[4] === '#2a2a2a' && bg.find((l) => l[3].endsWith('f2.png')).length === 4, 'a logo drawn on its own colour carries that colour; a bad colour is dropped');
  ok(pickLogos([row(1, 'NS', 'Halifax', { lat: 44.65, lng: -63.57 })]).length === 1 && pickLogos([]).length === 0, 'a province with no quota of its own still gets a few; no firms, no logos');
}

// ---- the route, on a real database
{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE firms (slug TEXT PRIMARY KEY, data TEXT, status TEXT, province TEXT, city TEXT, featured INTEGER DEFAULT 0, rating REAL DEFAULT 0, review_count INTEGER DEFAULT 0)');
  const add = (slug, status, featured, rating, extra = {}) => db.prepare('INSERT INTO firms (slug, data, status, province, city, featured, rating, review_count) VALUES (?,?,?,?,?,?,?,?)').run(slug, JSON.stringify({ slug, lat: 43.65, lng: -79.38, type: 'logo', src: `images/logos/${slug}.png`, ...extra }), status, 'ON', 'Toronto', featured, rating, 10);
  add('plain-low', 'live', 0, 3.1); add('plain-high', 'live', 0, 4.9); add('feat', 'live', 1, 4.0); add('hidden', 'hidden', 1, 5); add('pending', 'pending', 0, 5);
  const d1 = { prepare(sql) { const st = db.prepare(sql); const o = { bind() { return o; }, async all() { return { results: st.all() }; } }; return o; } };
  const res = await mapPoints({ env: { DB: d1 } });
  const body = await res.json();
  ok(res.status === 200 && /public, max-age=3600/.test(res.headers.get('cache-control')) && body.w === W && body.h === H, 'GET /api/map is public JSON, cached for an hour, with the size of the drawing');
  ok(body.logos.map((l) => l[3]).join() === '/images/logos/feat.png,/images/logos/plain-high.png,/images/logos/plain-low.png', 'only live firms, a city\'s Featured firm first and then the best rated');
}

// ---- the page
const index = readFileSync('index.html', 'utf8');
ok(!/why-b|whyBH|Find your lawyer, faster/.test(index) && !/why-b/.test(readFileSync('home-wide.css', 'utf8')), 'the old "Why LawDB" band and its styles are gone');
ok(/<section class="hm" id="camap" aria-labelledby="hmTitle">/.test(index) && /<h2 id="hmTitle">Law firms across Canada<\/h2>/.test(index) && /id="hmMap"><img class="hm-bg" src="\/images\/ca-map\.svg" alt="Map of Canada[^"]*"/.test(index), 'the home page has the map section: heading, the drawing with a text alternative, the logo layer');
ok(/<p class="hm-foot"><a href="#cities">Browse firms by city<\/a>/.test(index) && /<section class="citystrip" id="cities">/.test(index), '"Browse firms by city" goes to the city list on the same page');
ok(index.indexOf('class="h5-stats"') < index.indexOf('class="hm"') && index.indexOf('class="hm"') < index.indexOf('class="top-c"'), 'it sits where the old band was: after the numbers, before the top-rated lawyers');
ok(index.includes('href="home-map.css?v=1"') && index.includes('src="home-map.js?v=1" defer') && existsSync('home-map.css') && existsSync('home-map.js'), 'its stylesheet and script are linked and exist');
const css = readFileSync('home-map.css', 'utf8');
ok(/aspect-ratio:1000\/443/.test(css) && /prefers-reduced-motion/.test(css) && /pointer-events:none/.test(css), 'the map is drawn at the drawing\'s own proportions, is still for people who ask for less motion, and cannot be clicked');
ok(/run_worker_first[\s\S]*"\/api\/\*"/.test(readFileSync('wrangler.jsonc', 'utf8')) && /route\('GET', '\/api\/map', mapPoints\)/.test(readFileSync('src/worker.js', 'utf8')), 'the Worker answers /api/map');

// ---- the script that lays the logos out (home-map.js, run against a small stand-in for the page)
async function lay(logos, sizes, { rootWidth = 1000, pin = 32, fail = false, scroller = null } = {}) {
  const made = [];
  const el = () => ({ className: '', style: {}, children: [], offsetWidth: pin, setAttribute() {}, appendChild(c) { this.children.push(c); }, });
  const root = { clientWidth: rootWidth, children: [], appendChild(c) { this.children.push(c); }, removeChild(c) { this.children = this.children.filter((x) => x !== c); } };
  class Img {
    constructor() { this.l = {}; this.naturalWidth = 0; this.naturalHeight = 0; }
    addEventListener(t, f) { this.l[t] = f; }
    set src(v) { this._src = v; setTimeout(() => { const s = sizes[v]; if (!s) { this.l.error && this.l.error(); return; } this.naturalWidth = s[0]; this.naturalHeight = s[1]; this.l.load && this.l.load(); }, 1); }
  }
  const sandbox = { document: { getElementById: (id) => (id === 'hmMap' ? root : id === 'hmScroll' ? scroller : null), createElement: () => { const e = el(); made.push(e); return e; } }, window: {}, Image: Img, setTimeout, fetch: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ ok: true, json: () => Promise.resolve({ w: W, h: H, logos }) })), console };
  vm.runInNewContext(readFileSync('home-map.js', 'utf8'), sandbox);
  await new Promise((r) => setTimeout(r, 400));
  return root.children;
}
{
  const logos = Array.from({ length: 40 }, (_, i) => ['ON|Toronto', 700, 330, `/images/logos/l${i}.png`]);
  logos.push(['ON|Ottawa', 800, 300, '/images/logos/wide.png'], ['ON|Ottawa', 800, 300, '/images/logos/tiny.png'], ['ON|Ottawa', 800, 300, '/images/logos/gone.png'], ['ON|Ottawa', 800, 300, '/images/logos/dark.png', '#2a2a2a'], ['BC|Corner', 1, 1, '/images/logos/corner.png']);
  const sizes = Object.fromEntries(logos.map((l) => [l[3], [120, 100]]));
  sizes['/images/logos/wide.png'] = [400, 60]; sizes['/images/logos/tiny.png'] = [10, 10]; delete sizes['/images/logos/gone.png'];
  const pins = await lay(logos, sizes);
  const pos = pins.map((p) => [parseFloat(p.style.left) / 100 * W, parseFloat(p.style.top) / 100 * H]);
  ok(pins.length === 42, `42 of 45 are placed: a wordmark too wide to read, a picture too small to see and a logo that does not load are left out (${pins.length})`);
  let near = 0; const D = 32 / 1000 * W * 0.96;
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) if (Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) < D - 0.5) near++;
  ok(near === 0, 'no logo sits on another one, even with 40 firms in one city');
  ok(pos.every((p) => p[0] >= 15 && p[0] <= W - 15 && p[1] >= 15 && p[1] <= H - 15), 'every logo is inside the drawing, even one whose city is at the very corner');
  const near2 = (c) => pos.filter((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 1).length;
  const darkAt = pos[pins.findIndex((p) => p.style.background === '#2a2a2a')];
  ok(near2([700, 330]) === 1 && Math.hypot(darkAt[0] - 800, darkAt[1] - 300) < 70 && pos.every((q) => [[700, 330], [800, 300], [1, 1]].some((c) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 160)), 'the first logo of a city sits on the city itself (or as near as there is room) and the rest gather around it');
  const dark = pins.find((p) => p.style.background === '#2a2a2a');
  ok(dark && /\bfull\b/.test(dark.className), 'a logo drawn on its own colour fills its circle with that colour');
  ok(pins.every((p) => /\bhm-pin\b/.test(p.className) && /^\d+(\.\d+)?%$/.test(p.style.left) && p.children.length === 1 && p.children[0].alt === ''), 'each pin is a circle with a picture that has no alt text (the map is only a picture)');
  ok((await lay([], {}, { fail: true })).length === 0, 'if the data cannot be fetched the plain map is left alone');
  const phone = await lay(logos.slice(0, 40), sizes, { rootWidth: 780, pin: 22 });
  ok(phone.length === 40, 'on a phone (780 px wide, 22 px logos) they all fit too');
  const strip = { scrollLeft: 0, scrollWidth: 780, clientWidth: 390 };
  await lay(logos.slice(0, 40), sizes, { rootWidth: 780, pin: 22, scroller: strip });
  ok(strip.scrollLeft > 0 && Math.abs(strip.scrollLeft + 195 - 700 / 1000 * 780) < 1, 'on a phone the strip starts scrolled so the firms (here around x = 700 of 1000) are in the middle of the screen, not British Columbia at the left edge');
  const wide = { scrollLeft: 0, scrollWidth: 1000, clientWidth: 1000 }, moved = { scrollLeft: 120, scrollWidth: 780, clientWidth: 390 };
  await lay(logos.slice(0, 5), sizes, { scroller: wide }); await lay(logos.slice(0, 5), sizes, { rootWidth: 780, pin: 22, scroller: moved });
  ok(wide.scrollLeft === 0 && moved.scrollLeft === 120, 'a screen the map fits on is left alone, and so is a visitor who has already scrolled');
}
{
  const js = readFileSync('home-map.js', 'utf8');
  ok(/IntersectionObserver/.test(js) && /credentials: 'omit'/.test(js) && !/referrerPolicy/.test(js) && !/innerHTML/.test(js), 'nothing is fetched until the map is about to scroll into view; no cookies sent; no markup built from data');
}

console.log(bad ? `\n${bad} check(s) failed` : '\nall home map checks passed');
process.exit(bad ? 1 : 0);
