// The LawDB News feed on the home page: firms' blog articles, the firms with the strongest profiles and the best Google ratings first.
//
// Each article is ranked by its firm's strength (0 to 100) plus a freshness bonus (0 to 20, fading over four months), so a new article from a
// well-rated firm leads and an old one from a top firm still beats a new one from a firm with a thin profile. At most two articles per firm
// in the feed, and only articles that have a picture (it is a visual feed; News has the rest). Pure functions here, the query in loadCandidates.
import { PRACTICE } from './practice.js';
import { dedupeSameSite, isPlaceholderTitle } from './stories.js';

export const PER_FIRM = 2;
export const FRESH_DAYS = 120;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Strength of a firm's profile: 25 Featured, 35 Google rating, 15 how many reviews (300 or more is full marks), 8 a written description,
// 5 facts from its own site, 4 each for a logo, a cover picture and opening hours.
export function firmStrength(f) {
  const rating = clamp(Number(f.rating) || 0, 0, 5);
  const reviews = clamp(Math.log10((Number(f.reviewCount) || 0) + 1) / Math.log10(301), 0, 1);
  const aboutWords = Number(f.aboutWords) || 0;
  return (f.featured ? 25 : 0) + (rating / 5) * 35 + reviews * 15 + (aboutWords >= 60 ? 8 : aboutWords >= 40 ? 5 : 0) +
    (f.hasDetails ? 5 : 0) + (f.hasLogo ? 4 : 0) + (f.hasCover ? 4 : 0) + (f.hasHours ? 4 : 0);
}

export function freshness(publishedAt, now = Date.now()) {
  const t = Date.parse(String(publishedAt || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return 0;
  const days = (now - t) / 86400000;
  return clamp(20 * (1 - days / FRESH_DAYS), 0, 20);
}

// rows: [{ firmSlug, publishedAt, id, caseTypes: [...], ...firm fields for firmStrength }]. type: '' or a practice-area key.
export function rankPosts(rows, { type = '', now = Date.now() } = {}) {
  const scored = rows
    .filter((r) => !type || (r.caseTypes || []).includes(type))
    .map((r) => ({ ...r, score: firmStrength(r) + freshness(r.publishedAt, now) }))
    .sort((a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt)) || b.id - a.id);
  const per = new Map();
  return scored.filter((r) => {
    const n = (per.get(r.firmSlug) || 0) + 1;
    per.set(r.firmSlug, n);
    return n <= PER_FIRM;
  });
}

export const isPracticeType = (t) => Object.prototype.hasOwnProperty.call(PRACTICE, t);

// Every visible article that has a picture, newest 600, with what is needed to rank its firm. The same visibility rule as LawDB News.
export async function loadCandidates(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.firm_slug AS firmSlug, json_extract(f.data, '$.name') AS firmName, f.featured AS featured, ff.source AS source,
            p.title, p.url, p.published_at AS publishedAt, p.excerpt, p.image_url AS image, json_extract(f.data, '$.src') AS logo, json_extract(f.data, '$.website') AS website,
            f.rating AS rating, f.review_count AS reviewCount, f.about AS about,
            (json_extract(f.data, '$.details') IS NOT NULL) AS hasDetails, (json_extract(f.data, '$.src') IS NOT NULL) AS hasLogo,
            (json_extract(f.data, '$.heroImage') IS NOT NULL) AS hasCover, (f.hours IS NOT NULL) AS hasHours, json_extract(f.data, '$.caseTypes') AS ct
     FROM firm_posts p JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1
     JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live' AND (ff.page_only = 0 OR f.featured = 1)
     WHERE p.image_url IS NOT NULL AND p.image_url != ''
     ORDER BY p.published_at DESC, p.id DESC LIMIT 600`
  ).all();
  const seen = new Set();
  return dedupeSameSite(results)
    .filter((r) => !isPlaceholderTitle(r.title))
    .filter((r) => (seen.has(r.firmSlug + '|' + r.url) ? false : seen.add(r.firmSlug + '|' + r.url)))
    .map((r) => {
      let caseTypes = [];
      try { caseTypes = JSON.parse(r.ct || '[]'); } catch { /* none */ }
      return { ...r, featured: !!r.featured, caseTypes, aboutWords: String(r.about || '').trim().split(/\s+/).filter(Boolean).length, about: undefined, ct: undefined };
    });
}
