// /sitemap-firms.xml: every live firm with a real description (a page with only a two-line stub stays out until it has one).
// Lets Google find new listings the day they go live, with no file to edit.
// Profiles without a real description yet (see src/lib/indexing.js) are left out and carry a noindex tag.
import { isIndexable } from '../lib/indexing.js';

// One sitemap file may hold 50,000 addresses; we stop well short of that. If the table ever reaches the limit the file says so in a header and the log,
// and the answer is a sitemap index (see docs/ARCHITECTURE.md, "Search engines").
export const FIRM_SITEMAP_LIMIT = 15000;

export async function firmSitemap({ request, env }) {
  const origin = (env.SITE_ORIGIN || new URL(request.url).origin).replace(/\/+$/, '');
  try {
    const { results } = await env.DB.prepare(
      `SELECT slug, updated_at AS updatedAt, about FROM firms WHERE status = 'live' ORDER BY slug LIMIT ${FIRM_SITEMAP_LIMIT}`
    ).all();
    const truncated = results.length >= FIRM_SITEMAP_LIMIT;
    if (truncated) console.error(`firm sitemap reached its limit of ${FIRM_SITEMAP_LIMIT} firms: some firms are missing from it; split it into a sitemap index`);
    const listed = results.filter((r) => isIndexable(r.about));
    const day = (d) => { const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : ''; };
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      listed.map((r) => `  <url><loc>${origin}/firms/${encodeURIComponent(r.slug)}</loc>${day(r.updatedAt) ? `<lastmod>${day(r.updatedAt)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
    return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600', ...(truncated ? { 'x-sitemap-truncated': '1' } : {}) } });
  } catch (err) {
    console.error('firm sitemap failed', err);
    return new Response('Unavailable', { status: 503, headers: { 'retry-after': '60' } });
  }
}
