// GET /api/map: a small, spread-out set of firm logos for the decorative map on the home page (home-map.js): [cityKey, x, y, logo, background?].
// x and y are already projected onto the drawing in images/ca-map.svg (src/lib/map-projection.js), so the page needs no map library.
// The map is only a picture, so it shows a fixed number of logos per province (more in Ontario than Manitoba), taken one city at a time round-robin so every
// city in a province is represented before any city gets a second; inside a city the Featured firms come first, then the best rated. More logos are sent than
// the page shows (CANDIDATES): the page leaves out a logo that is too wide to read in a small circle and fills the place from the next one.
import { projection, W, H } from '../lib/map-projection.js';
import { cached } from '../lib/http.js';

const QUOTA = { ON: 44, BC: 24, AB: 20, QC: 22, MB: 10 }, QUOTA_OTHER = 8; // logos per province, with the spares

// Only a picture that is our own is used: one of the logo files in the site, or a logo the firm uploaded. Never an address on somebody else's site.
export const logoOf = (src) => (typeof src === 'string' && /^images\/logos\/[A-Za-z0-9._-]{1,120}\.(?:png|jpe?g|webp|gif|svg)$/i.test(src) ? `/${src}`
  : typeof src === 'string' && /^img\/[0-9a-f]{24}$/.test(src) ? `/${src}` : '');
const bgOf = (v) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v.toLowerCase() : '');

export function pickLogos(rows) {
  const proj = projection();
  const byCity = new Map();
  for (const r of rows) {
    const lat = Number(r.lat), lng = Number(r.lng), logo = r.type === 'logo' ? logoOf(r.src) : '';
    if (!logo || !r.lat || !r.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const p = proj([lng, lat]);
    if (!p || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue; // not on the drawing
    const key = `${r.province}|${r.city}`;
    if (!byCity.has(key)) byCity.set(key, []);
    const bg = bgOf(r.logoBg);
    byCity.get(key).push([key, Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, logo, ...(bg ? [bg] : [])]);
  }
  const provinces = new Map();
  for (const [key, list] of byCity) {
    const pv = key.split('|')[0];
    if (!provinces.has(pv)) provinces.set(pv, []);
    provinces.get(pv).push(list);
  }
  const logos = [];
  for (const [pv, lists] of [...provinces].sort((a, b) => a[0].localeCompare(b[0]))) {
    const max = QUOTA[pv] ?? QUOTA_OTHER;
    let n = 0;
    for (let i = 0; n < max && lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (i < l.length && n < max) { logos.push(l[i]); n++; }
    }
  }
  return logos;
}

export async function mapPoints({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT slug, city, province, json_extract(data, '$.lat') AS lat, json_extract(data, '$.lng') AS lng, json_extract(data, '$.type') AS type,
            json_extract(data, '$.src') AS src, json_extract(data, '$.logoBg') AS logoBg
       FROM firms WHERE status = 'live' ORDER BY province, city, featured DESC, rating DESC, review_count DESC, slug LIMIT 5000`
  ).all();
  return cached({ w: W, h: H, logos: pickLogos(results) }, 3600);
}
