import { renderReportPage } from '../render/report-page.js';

// GET /report-listing?firm=<slug>
export async function reportPage({ request, env }) {
  const slug = (new URL(request.url).searchParams.get('firm') || '').toLowerCase();
  let firm = null;
  if (/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) {
    try { firm = await env.DB.prepare("SELECT slug, name FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first(); } catch (err) { console.error('report page lookup failed', err); }
  }
  return new Response(renderReportPage({ slug: firm ? firm.slug : '', firmName: firm ? firm.name : '' }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
