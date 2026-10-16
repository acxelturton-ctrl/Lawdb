// /sitemap-firms.xml: every live firm whose profile page is built from the database (the hand-built pages are in sitemap.xml).
// Lets Google find new listings the day they go live, with no file to edit.
export async function firmSitemap({ request, env }) {
  const origin = (env.SITE_ORIGIN || new URL(request.url).origin).replace(/\/+$/, '');
  try {
    const { results } = await env.DB.prepare(
      "SELECT slug, updated_at AS updatedAt FROM firms WHERE status = 'live' AND page_mode = 'dynamic' ORDER BY slug LIMIT 5000"
    ).all();
    const day = (d) => { const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : ''; };
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      results.map((r) => `  <url><loc>${origin}/firms/${encodeURIComponent(r.slug)}</loc>${day(r.updatedAt) ? `<lastmod>${day(r.updatedAt)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
    return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
  } catch (err) {
    console.error('firm sitemap failed', err);
    return new Response('Unavailable', { status: 503, headers: { 'retry-after': '60' } });
  }
}
