// POST /api/a: the page's tiny traffic message (see src/lib/stats.js). Always answers 204 and never sets a cookie; counting must never get in the way of a page.
// GET /api/admin/traffic: the owner's report for the admin Traffic tab.
import { json, readJson, clampInt, NO_STORE } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { isBot, throttled, eventIncs, firmIncs, torontoDay, trafficReport } from '../lib/stats.js';
import { countInBackground } from '../lib/stats-buffer.js';

const done = () => new Response(null, { status: 204, headers: NO_STORE });

// A page of a firm is /firm/<handle>; the firm's own counts are kept under its slug, so the handle is turned into the slug first (looked up once, then remembered by this isolate).
const slugOfHandle = new Map();
export async function withFirmSlug(env, body) {
  const m = body && typeof body.p === 'string' ? /^\/firm\/([a-z0-9][a-z0-9-]{0,80})\/?(?:[?#].*)?$/i.exec(body.p) : null;
  if (!m) return body;
  const handle = m[1].toLowerCase();
  if (!slugOfHandle.has(handle)) {
    if (slugOfHandle.size > 3000) slugOfHandle.clear();
    const row = await env.DB.prepare('SELECT slug FROM firms WHERE handle = ?1 OR (handle IS NULL AND slug = ?1) LIMIT 1').bind(handle).first();
    slugOfHandle.set(handle, row ? row.slug : '');
  }
  const slug = slugOfHandle.get(handle);
  return slug ? { ...body, p: `/firms/${slug}` } : { ...body, p: '/firm' };
}

export async function collect({ request, env, exec }) {
  try {
    if (isBot(request.headers.get('user-agent')) || throttled(request.headers.get('cf-connecting-ip') || 'local')) return done();
    const body = await readJson(request, 600);
    const cf = request.cf || {};
    const geo = { country: cf.country, region: cf.regionCode };
    const incs = eventIncs(body, geo);
    // Counted twice on purpose: site-wide for the owner's Traffic tab, and per firm for the firm's own dashboard. Both are gathered and written in batches (stats-buffer.js).
    if (incs) countInBackground(env, exec, torontoDay(), incs, firmIncs(await withFirmSlug(env, body), geo));
  } catch { /* an odd message is simply not counted */ }
  return done();
}

export async function adminReport({ request, env, url }) {
  await requireAdmin(env, request);
  return json(await trafficReport(env, clampInt(url.searchParams.get('days'), 30, 1, 90)), 200, NO_STORE);
}
