// A firm's public address: lawdb.ca/<handle>, like lawdb.ai/aanjlaw: letters and digits only, no dashes, nothing in front (not /firm/, not /lawyer/). Its Lawyers and Articles
// pages are /<handle>/lawyers and /<handle>/articles. A Featured lawyer's own page is lawdb.ca/<name> in the same way (src/lib/lawyer-address.js): firms and lawyers share one
// namespace, so no two have the same address, and none is a word the site itself uses (RESERVED).
// The handle is the slug without the city on the end and without dashes ("lawpoint-north-york" -> "lawpoint", "aitken-robertson-kingston" -> "aitkenrobertson"). It is kept apart
// from the slug (the firm's key in every table and data file) in the `handle` column and in the firm's JSON (data.handle). A firm without a handle yet is reachable at /<slug>.
// The old /firms/<slug> addresses redirect (301) to the handle. scripts/build-firm-handles.mjs gives every firm in the repository its handle (data/firm-handles.json,
// db/handles-updates.sql); a firm that lists itself later gets one here (uniqueHandleFor).

export const HANDLE_RE = /^[a-z0-9]+$/;
export const HANDLE_MIN = 3, HANDLE_MAX = 60;

// Every first part of an address the site itself answers: its pages, folders, files and routes, and words kept for later. A handle is never one of these (scripts/test-firm-addresses.mjs
// reads the site's folder and fails if a page or folder is missing here, so a page added later cannot be shadowed by a firm).
export const RESERVED = new Set(('about account admin ads ai-search alberta api app assets attorney attorneys badge blog blog_data book-a-call books british-columbia business-lawyers city-pages contact criminal-defence-lawyers ' +
  '_headers dashboard data db desktop docs email-previews employment-lawyers faq family-lawyers favicon find-lawyers firm firms firms_data firms_hours follow for-firms grow-your-practice help hero-anim home home-map home-wide ' +
  'how-it-works images img immigration-lawyers index join lawdb-map lawdb-places lawdb-search lawyer lawyer-claim lawyers legal list-your-firm litigation-lawyers locate login logout lw-app lwa mail manitoba map-style ' +
  'marketplace migrations new-firms news ontario package package-lock personal-injury-lawyers places plan-compare plans pricing privacy privacy-policy province-pages public quebec readme real-estate-lawyers refund-policy report-listing ' +
  'request-a-lawyer robots scripts search signin signup site sitemap sitemap-firms sitemap-news src static suggest terms traffic-ticket-lawyers wills-estate-lawyers wrangler www').split(' '));

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const noDashes = (s) => s.replace(/-/g, '');

// firms whose slug ends with a place that is no longer their city (Grillo Law moved from North York to Toronto, the slug kept the old name)
export const HANDLE_OVERRIDES = { 'grillo-law-personal-injury-lawyers-north-york': 'grillolawpersonalinjurylawyers' };

// the slug without its city and without dashes: "aitken-robertson-kingston" (city Kingston) -> "aitkenrobertson"; a slug that does not end with the city keeps all its words
export function candidateHandle(slug, city) {
  if (HANDLE_OVERRIDES[slug]) return HANDLE_OVERRIDES[slug];
  const cs = slugify(city);
  let base = slug;
  if (cs && slug.endsWith('-' + cs)) {
    const stripped = slug.slice(0, -(cs.length + 1));
    if (noDashes(stripped).length >= HANDLE_MIN) base = stripped;
  }
  return noDashes(base).slice(0, HANDLE_MAX);
}

// a word the site is not using: only then may it be a handle (a firm or a lawyer)
export const isFree = (h) => HANDLE_RE.test(h) && h.length >= HANDLE_MIN && h.length <= HANDLE_MAX && !RESERVED.has(h);

// The page address of a firm (or of one of its pages): /<handle>, or /<slug> when it has no handle yet. f needs `slug` and, once it has one, `handle`.
export const firmPath = (f, tab = '') => `/${f.handle || f.slug}${tab ? `/${tab}` : ''}`;

// What an address's first part may look like (a handle, or the slug of a firm that has no handle yet); the site's own words are not firms
export const ADDRESS_TOKEN = /^[a-z0-9][a-z0-9-]{1,79}$/;
export const couldBeFirm = (t) => ADDRESS_TOKEN.test(t) && !RESERVED.has(t);

// A handle for a firm that lists itself (or is added by an admin): the candidate, then 2, 3 ... when another firm (or a Featured lawyer's page) already has it.
export async function uniqueHandleFor(env, slug, city) {
  const base = candidateHandle(slug, city);
  for (let n = 1; n < 50; n++) {
    const h = n === 1 ? base : `${base}${n}`;
    if (!isFree(h)) continue;
    const clash = await env.DB.prepare('SELECT 1 FROM firms WHERE handle = ? OR (handle IS NULL AND slug = ? AND slug != ?)').bind(h, h, slug).first();
    if (!clash) return h;
  }
  return slug;
}

// The firm an address names: the firm with that handle, or (a firm that has no handle yet) with that slug.
export async function firmByToken(env, token) {
  return env.DB.prepare('SELECT slug, handle, data, hours, about, status, featured FROM firms WHERE handle = ?1 OR (handle IS NULL AND slug = ?1) ORDER BY handle IS NULL LIMIT 1').bind(token).first();
}

// Where the old address /firms/<token> now lives: { slug, handle, status } of the firm with that slug, or of the firm a renamed slug moved to (firm_redirects); null when nothing is listed there.
export async function currentAddress(env, token) {
  const row = await env.DB.prepare('SELECT slug, handle, status FROM firms WHERE slug = ?1 UNION ALL SELECT f.slug, f.handle, f.status FROM firm_redirects r JOIN firms f ON f.slug = r.new_slug WHERE r.old_slug = ?1 LIMIT 1').bind(token).first();
  return row || null;
}
