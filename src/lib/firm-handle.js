// A firm's public address: lawdb.ca/firm/<handle>, its Lawyers and Articles pages /firm/<handle>/lawyers and /firm/<handle>/articles, and a lawyer's own page /lawyer/<name>.
// The handle is the slug without the city on the end ("lawpoint-north-york" -> "lawpoint"). It is kept apart from the slug (the firm's key in every table and data file) in the
// `handle` column and in the firm's JSON (data.handle). A firm without a handle yet is reachable at /firm/<slug>. The old /firms/<slug> addresses redirect (301) to the handle.
// scripts/build-firm-handles.mjs gives every firm in the repository its handle (data/firm-handles.json, db/handles-updates.sql); a firm that lists itself later gets one here (uniqueHandleFor).

export const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HANDLE_MIN = 3, HANDLE_MAX = 80;

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// firms whose slug ends with a place that is no longer their city (Grillo Law moved from North York to Toronto, the slug kept the old name)
export const HANDLE_OVERRIDES = { 'grillo-law-personal-injury-lawyers-north-york': 'grillo-law-personal-injury-lawyers' };

// the slug without its city: "aitken-robertson-kingston" (city Kingston) -> "aitken-robertson"; a slug that does not end with the city stays as it is
export function candidateHandle(slug, city) {
  if (HANDLE_OVERRIDES[slug]) return HANDLE_OVERRIDES[slug];
  const cs = slugify(city);
  if (cs && slug.endsWith('-' + cs)) {
    const stripped = slug.slice(0, -(cs.length + 1));
    if (stripped.length >= HANDLE_MIN && HANDLE_RE.test(stripped)) return stripped;
  }
  return slug;
}

// The page address of a firm (or of one of its pages): /firm/<handle>, or /firm/<slug> when it has no handle yet. f needs `slug` and, once it has one, `handle`.
export const firmPath = (f, tab = '') => `/firm/${f.handle || f.slug}${tab ? `/${tab}` : ''}`;

// A handle for a firm that lists itself (or is added by an admin): the candidate, then -2, -3 ... when another firm already has it.
export async function uniqueHandleFor(env, slug, city) {
  const base = candidateHandle(slug, city);
  for (let n = 1; n < 50; n++) {
    const h = n === 1 ? base : `${base}-${n}`;
    const clash = await env.DB.prepare('SELECT 1 FROM firms WHERE handle = ? OR (handle IS NULL AND slug = ? AND slug != ?)').bind(h, h, slug).first();
    if (!clash) return h;
  }
  return slug;
}

// The firm a /firm/<token> address names: the firm with that handle, or (a firm that has no handle yet) with that slug.
export async function firmByToken(env, token) {
  return env.DB.prepare('SELECT slug, handle, data, hours, about, status, featured FROM firms WHERE handle = ?1 OR (handle IS NULL AND slug = ?1) ORDER BY handle IS NULL LIMIT 1').bind(token).first();
}

// Where the old address /firms/<token> now lives: { slug, handle } of the firm with that slug, or of the firm a renamed slug moved to (firm_redirects); null when nothing is listed there.
export async function currentAddress(env, token) {
  const row = await env.DB.prepare('SELECT slug, handle FROM firms WHERE slug = ?1 UNION ALL SELECT f.slug, f.handle FROM firm_redirects r JOIN firms f ON f.slug = r.new_slug WHERE r.old_slug = ?1 LIMIT 1').bind(token).first();
  return row || null;
}
