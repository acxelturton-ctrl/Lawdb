// POST /api/a: the page's tiny traffic message (see src/lib/stats.js). Always answers 204 and never sets a cookie; counting must never get in the way of a page.
// GET /api/admin/traffic: the owner's report for the admin Traffic tab.
import { json, readJson, clampInt, NO_STORE } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { isBot, throttled, eventIncs, record, torontoDay, trafficReport } from '../lib/stats.js';

const done = () => new Response(null, { status: 204, headers: NO_STORE });

export async function collect({ request, env, exec }) {
  try {
    if (isBot(request.headers.get('user-agent')) || throttled(request.headers.get('cf-connecting-ip') || 'local')) return done();
    const body = await readJson(request, 600);
    const cf = request.cf || {};
    const incs = eventIncs(body, { country: cf.country, region: cf.regionCode });
    if (incs) exec(record(env, torontoDay(), incs).catch((err) => console.error('stats write failed', err)));
  } catch { /* an odd message is simply not counted */ }
  return done();
}

export async function adminReport({ request, env, url }) {
  await requireAdmin(env, request);
  return json(await trafficReport(env, clampInt(url.searchParams.get('days'), 30, 1, 90)), 200, NO_STORE);
}
