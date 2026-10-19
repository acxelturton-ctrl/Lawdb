// Which firm profile pages Google is invited to index.
// A profile built only from the public listing (address, phone, rating) with no real description is the thin kind of page that can
// pull a whole directory down, so it stays out of the sitemap and carries a noindex tag until the firm (or an admin) writes a description.
// Everything else about the page is unchanged: it still loads, still appears in search on lawdb.ca and still links onward.
// 40 words: a real written profile (what the firm does, where, for whom) clears it; a listing with only an address, phone and rating does not.
export const MIN_ABOUT_WORDS = 40;

export const aboutWords = (about) => String(about || '').trim().split(/\s+/).filter(Boolean).length;
export const isIndexable = (about) => aboutWords(about) >= MIN_ABOUT_WORDS;

// Database-built firms that are live but held back from Google, with the first few for the admin screen.
export async function heldBack(env, sample = 12) {
  const { results } = await env.DB.prepare("SELECT slug, name, about FROM firms WHERE status = 'live' AND page_mode = 'dynamic' ORDER BY name").all();
  const held = results.filter((r) => !isIndexable(r.about));
  return { count: held.length, of: results.length, minWords: MIN_ABOUT_WORDS, sample: held.slice(0, sample).map((r) => ({ slug: r.slug, name: r.name, words: aboutWords(r.about) })) };
}
