// GET /api/map: a small, spread-out set of firm logos for the decorative map on the home page (home-map.js): [cityKey, x, y, logo, background?].
// x and y are where the logo goes on the drawing in images/ca-map.svg (src/lib/map-projection.js), so the page needs no map library and no layout of its own.
// The map is only a picture, so it shows a fixed number of logos per province (more in Ontario than Manitoba), taken one city at a time round-robin so every
// city in a province is represented before any city gets a second; inside a city the Featured firms come first, then the best rated.
// The logos are scattered over their province, not stacked around their city: each one goes to whichever of a few dozen random places on the province's land is furthest
// from the logos already put down (best-candidate sampling, so they are spread evenly with no clumps), always where its whole circle is on land and inside the firm's own
// province (src/lib/map-land.js): never out in the water, never across the border, never under the badge. The places are fixed (a seeded generator), so the picture is the
// same on every visit until the set of logos changes.
// ?small=1 is for phones, where the whole map is 390 pixels wide: fewer logos, and room for the bigger logos.
import { projection, W, H } from '../lib/map-projection.js';
import { inland, provinceAt } from '../lib/map-land.js';
import { cached } from '../lib/http.js';

const QUOTA = { ON: 42, QC: 30, BC: 26, AB: 20, MB: 14, SK: 14, NS: 3, NB: 3, NL: 5, PE: 1 }, QUOTA_OTHER = 6; // logos per province: about 160 in all (the drawing's Nova Scotia, New Brunswick and PEI are only 40 units wide: room for a few)
const QUOTA_SMALL = { ON: 12, QC: 9, BC: 8, AB: 6, MB: 5, SK: 5, NS: 2, NB: 2, NL: 2, PE: 1 }, QUOTA_SMALL_OTHER = 2; // for a phone: about 50 (that is about as many 20 pixel logos as the land holds without overlap)
// A logo's size in the drawing's units: on a computer a logo is 18 to 30 pixels on a map 1000 to 1180 wide; on a phone 20 pixels on a map 390 wide.
const SIZE = { radius: 13, badge: [190, 55, 575, 135] }, SIZE_SMALL = { radius: 26, badge: [25, 25, 700, 140] }; // radius of a logo; the badge's box (index.html .hm-badge) that no logo may touch
const STEP = 5;   // the places a logo may go: one in every 5 x 5 units of land, shifted a little at random
const TRIES = 80; // places looked at for each logo; the one furthest from the logos already down wins

// A small seeded random generator (mulberry32), so the same logos always land in the same places.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedOf = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);

// Only a picture that is our own is used: one of the logo files in the site, or a logo the firm uploaded. Never an address on somebody else's site.
export const logoOf = (src) => (typeof src === 'string' && /^images\/logos\/[A-Za-z0-9._-]{1,120}\.(?:png|jpe?g|webp|gif|svg)$/i.test(src) ? `/${src}`
  : typeof src === 'string' && /^img\/[0-9a-f]{24}$/.test(src) ? `/${src}` : '');
const bgOf = (v) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v.toLowerCase() : '');

// Every place a logo of radius r may go, by province: a point in each 5 x 5 unit cell of the drawing (moved a little at random) whose whole circle is inside the province,
// and clear of the badge. Worked out once per size and kept.
const landCache = new Map();
function land(size, r) {
  const key = `${size.radius}/${r}`;
  if (landCache.has(key)) return landCache.get(key);
  const rand = rng(20261122), by = new Map(), [bx0, by0, bx1, by1] = size.badge;
  for (let y = size.radius; y <= H - size.radius; y += STEP) {
    for (let x = size.radius; x <= W - size.radius; x += STEP) {
      const px = x + (rand() - 0.5) * STEP, py = y + (rand() - 0.5) * STEP;
      const pv = provinceAt(px, py);
      if (!pv || !inland(px, py, pv, r)) continue;
      if (px + size.radius > bx0 && px - size.radius < bx1 && py + size.radius > by0 && py - size.radius < by1) continue;
      if (!by.has(pv)) by.set(pv, []);
      by.get(pv).push([px, py]);
    }
  }
  landCache.set(key, by);
  return by;
}

// Where each chosen logo goes. First, of TRIES random places on its province's land, the one furthest from every logo already put down (in this province or the next
// one over). Then a few passes in which each logo looks at TRIES other places on its province and moves to one that gets it further from its nearest neighbour, so the
// logos spread out over the whole province instead of piling up around its cities, and crowded corners (the Atlantic provinces) loosen up. Each province has its own random
// sequence, so adding a firm in one province does not move the logos of another. A province too small for the room a logo needs (Prince Edward Island on a phone) takes
// the land its centre fits on, and failing that the firm's city.
const PASSES = 6;
function scatter(chosen, size) {
  const rands = new Map(), pos = [], pools = [];
  const nearest = (c, skip) => {
    let d = Infinity;
    for (let j = 0; j < pos.length; j++) { if (j === skip) continue; const dd = (c[0] - pos[j][0]) ** 2 + (c[1] - pos[j][1]) ** 2; if (dd < d) d = dd; }
    return d;
  };
  chosen.forEach((e) => {
    if (!rands.has(e.province)) rands.set(e.province, rng(seedOf(e.province)));
    const rand = rands.get(e.province);
    let places = land(size, size.radius).get(e.province);
    if (!places || !places.length) places = land(size, 0).get(e.province);
    let best = e.city, far = -1;
    if (places && places.length) {
      for (let t = 0; t < TRIES; t++) {
        const c = places[Math.floor(rand() * places.length)], d = nearest(c, -1);
        if (d > far) { far = d; best = c; }
      }
    }
    pools.push(places && places.length ? places : null);
    pos.push(best);
  });
  for (let pass = 0; pass < PASSES; pass++) {
    chosen.forEach((e, i) => {
      if (!pools[i]) return;
      const rand = rands.get(e.province);
      let far = nearest(pos[i], i);
      for (let t = 0; t < TRIES; t++) {
        const c = pools[i][Math.floor(rand() * pools[i].length)], d = nearest(c, i);
        if (d > far) { far = d; pos[i] = c; }
      }
    });
  }
  return pos;
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
  const spots = scatter(chosen, size);
  return chosen.map((e, i) => [e.key, Math.round(spots[i][0] * 10) / 10, Math.round(spots[i][1] * 10) / 10, e.logo, ...(e.bg ? [e.bg] : [])]);
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
