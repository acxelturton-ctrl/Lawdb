// What a firm's profile says about where it stands: its rank among the firms LawDB lists in its city, and the practice-area pages
// it can send a visitor to. Worked out from the database each time the page is built (the page is cached for a minute), so the
// numbers move as firms are added, never go stale the way figures typed into a page do.
import { PRACTICE, practicePath, PROVINCE_PATH } from './practice.js';

export const MIN_RANKED = 5; // a ranking among fewer firms says nothing

const rankOrder = (a, b) => b.rating - a.rating || b.count - a.count || String(a.slug).localeCompare(String(b.slug));
const one = (n) => Math.round(n * 10) / 10;

// rows: every live firm in the city [{ slug, rating, count, caseTypes }]; provAvgReviews: the average review count in the province.
export function computeRank(rows, slug, provAvgReviews) {
  const rated = rows.filter((r) => r.rating > 0).sort(rankOrder);
  const i = rated.findIndex((r) => r.slug === slug);
  if (i < 0 || rated.length < MIN_RANKED) return null;
  const me = rated[i];
  const avg = rated.reduce((s, r) => s + r.rating, 0) / rated.length;
  const diff = me.rating - avg;
  const delta = diff >= 0.15 ? { text: `▲ ${one(diff).toFixed(1)} above average`, tone: 'up' } : diff <= -0.15 ? { text: `▼ ${one(-diff).toFixed(1)} below average`, tone: 'down' } : { text: 'About the area average', tone: 'neutral' };
  const ratio = provAvgReviews > 0 ? me.count / provAvgReviews : 1;
  const reviews = ratio > 1.15 ? 'Above the provincial average' : ratio < 0.85 ? 'Below the provincial average' : 'About the provincial average';
  let byType = null;
  const ct = (me.caseTypes || []).find((t) => PRACTICE[t]);
  if (ct) {
    const peers = rated.filter((r) => (r.caseTypes || []).includes(ct));
    if (peers.length >= 3) byType = { rank: peers.findIndex((r) => r.slug === slug) + 1, of: peers.length, label: PRACTICE[ct][1].toLowerCase() };
  }
  return { rank: i + 1, of: rated.length, rating: me.rating, avg: one(avg), delta, count: me.count, reviews, byType };
}

// counts: { caseType: number of live firms in the province with it }; at most four cards, only to pages that exist.
export function practiceCards(province, caseTypes, counts) {
  const out = [];
  for (const t of caseTypes || []) {
    const href = practicePath(province, t);
    if (href && !out.some((c) => c.href === href)) out.push({ href, label: PRACTICE[t][1], count: counts[t] || 0 });
    if (out.length === 4) break;
  }
  return out;
}

export async function firmStats(env, f) {
  try {
    const [{ results: rows }, avg, { results: kinds }] = await Promise.all([
      env.DB.prepare("SELECT slug, rating, review_count AS count, json_extract(data, '$.caseTypes') AS ct FROM firms WHERE status = 'live' AND city = ? AND province = ?").bind(f.city, f.province).all(),
      env.DB.prepare("SELECT AVG(review_count) AS a FROM firms WHERE status = 'live' AND province = ? AND review_count > 0").bind(f.province).first(),
      env.DB.prepare("SELECT j.value AS t, COUNT(*) AS c FROM firms m, json_each(m.data, '$.caseTypes') j WHERE m.status = 'live' AND m.province = ? GROUP BY j.value").bind(f.province).all(),
    ]);
    const cityRows = rows.map((r) => { let ct = []; try { ct = JSON.parse(r.ct || '[]'); } catch { /* none */ } return { slug: r.slug, rating: Number(r.rating) || 0, count: Number(r.count) || 0, caseTypes: ct }; });
    const counts = Object.fromEntries(kinds.map((k) => [k.t, k.c]));
    return { rank: computeRank(cityRows, f.slug, Number(avg?.a) || 0), practice: practiceCards(f.province, f.caseTypes, counts), city: f.city };
  } catch (err) {
    console.error('profile stats failed', f.slug, err);
    return { rank: null, practice: [], city: f.city }; // the page always works without them
  }
}
