// GET /api/map: a small, spread-out set of firm logos for the decorative map on the home page (home-map.js): [cityKey, x, y, logo, background?].
// x and y are where the logo goes on the drawing in images/ca-map.svg (src/lib/map-projection.js), so the page needs no map library and no layout of its own.
// The map is only a picture, so it shows a fixed number of logos per province (more in Ontario than Manitoba), taken one city at a time round-robin so every
// city in a province is represented before any city gets a second; inside a city the Featured firms come first, then the best rated.
// The logos of one city make a ring around it (a sunflower spiral, as on lawdb.ai), but a logo is only put where its whole circle is on land and inside the firm's own
// province (src/lib/map-land.js): never out in the water, never across the border. A city on the coast gets its ring on the land side.
// ?small=1 is for phones, where the whole map is 390 pixels wide: fewer logos, and rings wide enough for the bigger logos.
import { projection, W, H } from '../lib/map-projection.js';
import { inland } from '../lib/map-land.js';
import { cached } from '../lib/http.js';

const QUOTA = { ON: 40, BC: 20, AB: 16, QC: 16, MB: 8 }, QUOTA_OTHER = 6;              // logos per province: about 100 in all, as on lawdb.ai
const QUOTA_SMALL = { ON: 22, BC: 11, AB: 9, QC: 9, MB: 5 }, QUOTA_SMALL_OTHER = 3;     // for a phone: about 55
// A logo's size in the drawing's units: on a computer a logo is 18 to 30 pixels on a map 1000 to 1180 wide; on a phone 20 pixels on a map 390 wide.
const SIZE = { radius: 13, ring: 10 }, SIZE_SMALL = { radius: 26, ring: 18 };          // radius of a logo; the ring grows by this much * the square root of the logo's number
const TRIES = 800; // how far along the spiral to look for a place on land

// Only a picture that is our own is used: one of the logo files in the site, or a logo the firm uploaded. Never an address on somebody else's site.
export const logoOf = (src) => (typeof src === 'string' && /^images\/logos\/[A-Za-z0-9._-]{1,120}\.(?:png|jpe?g|webp|gif|svg)$/i.test(src) ? `/${src}`
  : typeof src === 'string' && /^img\/[0-9a-f]{24}$/.test(src) ? `/${src}` : '');
const bgOf = (v) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v.toLowerCase() : '');

// The next place for a city's logo: along the spiral from where the last one stopped, the first whose whole circle is inside the province (then, failing that, whose
// centre is), kept off the edge of the drawing. Every logo of a city takes the next place along the same spiral, so they never share one.
function spot(city, province, state, size) {
  const edge = size.radius;
  for (const r of [size.radius, 0]) {
    for (let k = state.k; k < state.k + TRIES; k++) {
      const a = k * 2.4, d = k ? size.ring * Math.sqrt(k) : 0;
      const x = city[0] + d * Math.cos(a), y = city[1] + d * Math.sin(a);
      if (x < edge || x > W - edge || y < edge || y > H - edge) continue;
      if (inland(x, y, province, r)) { state.k = k + 1; return [x, y]; }
    }
  }
  return city; // nowhere on land near this city (a province too small for the drawing): the city's own point
}

export function pickLogos(rows, { small = false } = {}) {
  const proj = projection();
  const quota = small ? QUOTA_SMALL : QUOTA, other = small ? QUOTA_SMALL_OTHER : QUOTA_OTHER, size = small ? SIZE_SMALL : SIZE;
  const byCity = new Map();
  for (const r of rows) {
    const lat = Number(r.lat), lng = Number(r.lng), logo = r.type === 'logo' ? logoOf(r.src) : '';
    if (!logo || !r.lat || !r.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const p = proj([lng, lat]);
    if (!p || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue; // not on the drawing
    const key = `${r.province}|${r.city}`;
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push({ key, province: r.province, city: p, logo, bg: bgOf(r.logoBg) });
  }
  const provinces = new Map();
  for (const [key, list] of byCity) {
    const pv = key.split('|')[0];
    if (!provinces.has(pv)) provinces.set(pv, []);
    provinces.get(pv).push(list);
  }
  const chosen = [];
  for (const [pv, lists] of [...provinces].sort((a, b) => a[0].localeCompare(b[0]))) {
    const max = quota[pv] ?? other;
    let n = 0;
    for (let i = 0; n < max && lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (i < l.length && n < max) { chosen.push(l[i]); n++; }
    }
  }
  const state = new Map();
  return chosen.map((e) => {
    if (!state.has(e.key)) state.set(e.key, { k: 0 });
    const [x, y] = spot(e.city, e.province, state.get(e.key), size);
    return [e.key, Math.round(x * 10) / 10, Math.round(y * 10) / 10, e.logo, ...(e.bg ? [e.bg] : [])];
  });
}

export async function mapPoints({ request, env }) {
  const small = new URL(request.url).searchParams.get('small') === '1';
  const { results } = await env.DB.prepare(
    `SELECT slug, city, province, json_extract(data, '$.lat') AS lat, json_extract(data, '$.lng') AS lng, json_extract(data, '$.type') AS type,
            json_extract(data, '$.src') AS src, json_extract(data, '$.logoBg') AS logoBg
       FROM firms WHERE status = 'live' ORDER BY province, city, featured DESC, rating DESC, review_count DESC, slug LIMIT 5000`
  ).all();
  return cached({ w: W, h: H, logos: pickLogos(results, { small }) }, 3600);
}
