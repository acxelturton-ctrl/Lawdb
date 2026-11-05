// The "Firms to explore" strip on the home page, new every day.
//
// Each day (Toronto time) the Worker picks 12 firms from the best-looking, top-rated profiles and puts their cards into the home page, between the
// <!--more-firms--> markers. The pick is "random" but fixed for the day (seeded by the date), so every visitor and every server sees the same strip, and
// tomorrow's is different. The cards saved in index.html (data/home-firms.json) are only the fallback if the database cannot answer.
//
// Who can be in it (all of these):
//   - live, not Featured (Featured firms are shown in their own way), a Google rating of 4.8 or more from 50 or more reviews;
//   - in HOME_POOL: a cover photo and its own logo that really exist in the site's files, and a practice area (scripts/build-home-firms.mjs --pool);
//   - a real description (40 words or more, the same bar as the Google sitemap) and a phone number for the Call button.
// "Best-looking": the eligible profiles are ranked by rating weighted by number of reviews, plus how complete the profile is (profile strength:
// hours, tagline, social profiles, languages and so on). The day's pick is drawn at random from the top 120, with at most 2 firms per city,
// 3 per kind of practice and 4 per province, so the strip is a spread, not twelve Toronto injury firms.
import { HOME_POOL } from '../render/home-pool.generated.js';
import { homeFirmCard } from '../render/home-cards.js';
import { profileStrength } from '../lib/profile-strength.js';
import { isIndexable } from '../lib/indexing.js';
import { torontoDay } from '../lib/stats.js';

export const SHOWN = 12, TOP = 120, PER_CITY = 2, PER_KIND = 3, PER_PROVINCE = 4;
const POOL = new Set(HOME_POOL);

// rating weighted by how many reviews it rests on (4.5 is the prior, worth 50 reviews), plus up to 0.2 for a complete profile
export const lookScore = (f, strength) => (f.count * f.rating + 50 * 4.5) / (f.count + 50) + strength / 500;

// A small seeded random number generator, so one date always gives one order.
function seeded(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^ (h >>> 16)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// firms: [{ ...firm record, look }]. Returns the day's firms, in the order to show them.
export function pickDaily(firms, day, { shown = SHOWN, top = TOP } = {}) {
  const best = [...firms].sort((a, b) => b.look - a.look || (a.slug < b.slug ? -1 : 1)).slice(0, top);
  const rand = seeded(day);
  for (let i = best.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [best[i], best[j]] = [best[j], best[i]]; }
  const city = {}, kind = {}, prov = {}, out = [];
  const take = (f) => { out.push(f); city[`${f.city}|${f.province}`] = (city[`${f.city}|${f.province}`] || 0) + 1; kind[(f.tags || [])[0]] = (kind[(f.tags || [])[0]] || 0) + 1; prov[f.province] = (prov[f.province] || 0) + 1; };
  for (const f of best) {
    if (out.length >= shown) break;
    if ((city[`${f.city}|${f.province}`] || 0) >= PER_CITY || (kind[(f.tags || [])[0]] || 0) >= PER_KIND || (prov[f.province] || 0) >= PER_PROVINCE) continue;
    take(f);
  }
  for (const f of best) { if (out.length >= shown) break; if (!out.includes(f)) take(f); } // too few firms to keep every limit: fill up anyway
  return out;
}

// The eligible firms, from the database.
export async function eligibleFirms(env) {
  const { results } = await env.DB.prepare(
    "SELECT slug, data, hours, about FROM firms WHERE status = 'live' AND featured = 0 AND rating >= 4.8 AND review_count >= 50"
  ).all();
  const out = [];
  for (const r of results) {
    if (!POOL.has(r.slug) || !isIndexable(r.about)) continue;
    let f; try { f = JSON.parse(r.data); } catch { continue; }
    if (f.featured || f.type !== 'logo' || !f.src || !f.heroImage || !f.phone || !(f.tags || []).length) continue;
    const strength = profileStrength(f, { about: r.about, hours: r.hours }).score;
    out.push({ ...f, look: lookScore(f, strength) });
  }
  return out;
}

let memo = null; // { day, cards } kept by each server for the day, so the database is asked once a day, not once a visit
let failedAt = 0;

export async function dailyCards(env, day = torontoDay()) {
  if (memo && memo.day === day) return memo.cards;
  if (Date.now() - failedAt < 60000) return '';
  try {
    const picked = pickDaily(await eligibleFirms(env), day);
    if (picked.length < 4) return ''; // too few to be worth showing: keep the saved cards
    memo = { day, cards: picked.map(homeFirmCard).join('') };
    return memo.cards;
  } catch (err) { failedAt = Date.now(); console.error('daily firms failed, home page keeps its saved cards', err); return ''; }
}

// Swaps the saved cards for today's. Does nothing (and never fails the page) if there is no database answer or no markers.
export async function withDailyFirms(html, env) {
  if (!html.includes('<!--more-firms-->')) return html;
  const cards = await dailyCards(env);
  return cards ? html.replace(/<!--more-firms-->[\s\S]*<!--\/more-firms-->/, () => '<!--more-firms-->' + cards + '<!--/more-firms-->') : html;
}
