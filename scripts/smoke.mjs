// End-to-end smoke test against a running dev server (npm run dev) seeded with data.
// Needs .dev.vars containing:  ADMIN_EMAILS=smoke-admin@example.com  and  DEV_ECHO_LINK=1
//   BASE=http://localhost:8799 npm run smoke
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const BASE = process.env.BASE || 'http://localhost:8799';
const ADMIN = process.env.SMOKE_ADMIN || 'smoke-admin@example.com';
let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed++;
};
let cookie = '';
const call = async (method, path, body, extraHeaders = {}) => {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000), // never hang forever on a dead server
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
};
const tokenFrom = (link) => link.split('#token=')[1];
const staticFile = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const getRaw = async (path) => {
  const res = await fetch(BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const inlineFirms = (html) => {
  const m = html.match(/^const firms = (\[.*\]);$/m);
  return m ? JSON.parse(m[1]) : null;
};

// --- public API still works
ok((await call('GET', '/api/health')).status === 200, 'health');
const firms = await call('GET', '/api/firms?limit=3');
ok(firms.status === 200 && firms.data.length === 3, 'public firms list');
ok((await call('GET', '/api/firms/does-not-exist')).status === 404, 'unknown firm is 404');
ok((await call('POST', '/api/health')).status === 405, 'wrong method is 405');

// --- public pages and data files are served from the database, identical to the static files
for (const f of ['firms_data.json', 'blog_data.json', 'firms_hours.json']) {
  const r = await getRaw('/' + f);
  ok(r.status === 200 && r.headers.get('x-lawdb-source') === 'database', `${f} comes from the database`);
  ok(isDeepStrictEqual(JSON.parse(r.text), staticFile(f)), `${f} is identical to the static file`);
}
const staticOrder = staticFile('firms_data.json').map((f) => f.slug);
ok(isDeepStrictEqual((JSON.parse((await getRaw('/firms_data.json')).text)).map((f) => f.slug), staticOrder), 'firm order is preserved');
for (const path of ['/find-lawyers', '/ontario/ottawa/', '/manitoba/', '/quebec/quebec-city/']) {
  const r = await getRaw(path);
  ok(r.status === 200 && r.headers.get('x-lawdb-source') === 'database', `${path} is rendered from the database`);
  ok(isDeepStrictEqual(inlineFirms(r.text), staticFile('firms_data.json')), `${path} carries the same firm list as before`);
}
const plain = await getRaw('/ontario/toronto/business-lawyers');
ok(plain.status === 200 && !plain.headers.get('x-lawdb-source'), 'pages without a firm list pass through untouched');
ok([301, 302, 307, 308].includes((await getRaw('/find-lawyers.html')).status), '.html URL still redirects to the clean URL');
ok((await getRaw('/images/favicon-192.png')).status === 200, 'static images unaffected');

// --- admin is locked by default
for (const p of ['/api/admin/stats', '/api/admin/leads', '/api/admin/firms', '/api/admin/audit']) {
  ok((await call('GET', p)).status === 401, `anonymous blocked: ${p}`);
}
ok((await call('PATCH', '/api/admin/firms/x', { featured: true })).status === 401, 'anonymous cannot edit');
ok((await call('POST', '/api/admin/firms', { name: 'x', city: 'x', province: 'ON', lat: 43, lng: -79 })).status === 401, 'anonymous cannot create a firm');
ok((await call('GET', '/api/auth/me')).data.user === null, 'me is null when signed out');

// --- sign-in links
const stranger = await call('POST', '/api/auth/request-link', { email: 'stranger@example.com' });
ok(stranger.status === 200 && !stranger.data.dev_link, 'unknown email: same OK response, no link issued');
ok((await call('POST', '/api/auth/request-link', { email: 'not-an-email' })).status === 422, 'bad email rejected');
const req = await call('POST', '/api/auth/request-link', { email: ADMIN });
ok(req.status === 200 && req.data.dev_link, 'admin email gets a link');
const token = tokenFrom(req.data.dev_link);
ok((await call('POST', '/api/auth/verify', { token: 'f'.repeat(64) })).status === 400, 'made-up token rejected');
ok((await call('GET', '/api/admin/stats')).status === 401, 'still locked before verify');
const v = await call('POST', '/api/auth/verify', { token });
ok(v.status === 200 && v.data.user.role === 'admin', 'valid token signs in as admin');
const setCookie = v.headers.get('set-cookie') || '';
ok(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), 'cookie is HttpOnly + SameSite=Lax');
const replay = await call('POST', '/api/auth/verify', { token }, { cookie: '' });
ok(replay.status === 400, 'token cannot be used twice');
ok((await call('GET', '/api/auth/me')).data.user?.email === ADMIN, 'me returns the admin');

// throttle: only 3 links per 15 minutes per email (1 used already above)
let issued = 1;
for (let i = 0; i < 4; i++) if ((await call('POST', '/api/auth/request-link', { email: ADMIN })).data.dev_link) issued++;
ok(issued === 3, `link throttle holds at 3 (issued ${issued})`);

// --- admin API
const st = await call('GET', '/api/admin/stats');
ok(st.status === 200 && st.data.firms > 300, 'stats');

const lead = await call('POST', '/api/leads', { form: 'contact', name: 'Smoke <b>Test</b>', email: `smoke-${Date.now()}@example.com`, message: '<script>1</script>' });
ok(lead.status === 201, 'visitor can submit a lead');
const leads = await call('GET', '/api/admin/leads?status=new&limit=5');
const mine = leads.data.leads.find((l) => l.name === 'Smoke <b>Test</b>');
ok(!!mine && mine.message === '<script>1</script>', 'admin sees the lead, text stored verbatim (UI must escape)');
ok((await call('PATCH', `/api/admin/leads/${mine.id}`, { status: 'bogus' })).status === 422, 'invalid lead status rejected');
ok((await call('PATCH', `/api/admin/leads/${mine.id}`, { status: 'spam' })).status === 200, 'lead status updated');
ok((await call('PATCH', '/api/admin/leads/999999999', { status: 'closed' })).status === 404, 'missing lead is 404');

const found = await call('GET', '/api/admin/firms?q=stikeman');
ok(found.data.firms.length > 0, 'firm search');
const slug = found.data.firms[0].slug;
const before = (await call('GET', `/api/admin/firms/${slug}`)).data.firm;
const edit = await call('PATCH', `/api/admin/firms/${slug}`, { blurb: 'Smoke test blurb', featured: !before.featured });
ok(edit.status === 200 && edit.data.changed.length === 2, 'firm edit applies');
ok((await call('GET', `/api/firms/${slug}`)).data.blurb === 'Smoke test blurb', 'public API reflects the edit');

{
  const find = (arr) => arr.find((f) => f.slug === slug)?.blurb;
  ok(find(JSON.parse((await getRaw('/firms_data.json')).text)) === 'Smoke test blurb', 'edit shows in /firms_data.json');
  ok(find(inlineFirms((await getRaw('/find-lawyers')).text)) === 'Smoke test blurb', 'edit shows on /find-lawyers');
  ok(find(inlineFirms((await getRaw('/ontario/ottawa/')).text)) === 'Smoke test blurb', 'edit shows on a city hub page');
}ok((await call('PATCH', `/api/admin/firms/${slug}`, { rating: 1 })).status === 422, 'non-editable field refused');
ok((await call('PATCH', `/api/admin/firms/${slug}`, { website: 'javascript:alert(1)' })).status === 422, 'unsafe website refused');
ok((await call('PATCH', `/api/admin/firms/${slug}`, { blurb: 'x'.repeat(501) })).status === 422, 'overlong text refused');
await call('PATCH', `/api/admin/firms/${slug}`, { blurb: before.blurb, featured: !!before.featured });
ok((await call('GET', `/api/firms/${slug}`)).data.blurb === before.blurb, 'edit reverted');
ok(isDeepStrictEqual(inlineFirms((await getRaw('/find-lawyers')).text), staticFile('firms_data.json')), 'public page returns to the original after reverting');

const log = await call('GET', '/api/admin/audit?limit=20');
const actions = log.data.entries.map((e) => e.action);
ok(['login', 'lead.status', 'firm.update'].every((a) => actions.includes(a)), 'audit log recorded login, lead and firm changes');
ok(actions.includes('login.throttled'), 'throttled sign-in requests are logged');

// --- profile pages rendered from the database
{
  const hostile = `Smoke <script>alert(1)</script> & Associates ${Date.now()}`;
  const body = {
    name: hostile, city: 'Toronto', province: 'ON', address: '1 Smoke St, Toronto, ON M5V 1A1', phone: '+14165550100',
    website: 'https://example.com', lat: 43.65, lng: -79.38, tags: ['Corporate Law', 'Mergers'], caseTypes: ['business'],
    about: 'About <b>us</b>\n\nSecond paragraph', hours: { 1: [['08:30', '17:00']], 2: [['08:30', '12:00'], ['13:00', '17:00']] },
  };
  ok((await call('POST', '/api/admin/firms', { ...body, province: 'ZZ' })).status === 422, 'create: bad province refused');
  ok((await call('POST', '/api/admin/firms', { ...body, lat: undefined })).status === 422, 'create: missing coordinates refused');
  ok((await call('POST', '/api/admin/firms', { ...body, caseTypes: ['nonsense'] })).status === 422, 'create: unknown category refused');
  ok((await call('POST', '/api/admin/firms', { ...body, hours: { 1: [['17:00', '08:00']] } })).status === 422, 'create: backwards hours refused');
  const made = await call('POST', '/api/admin/firms', body);
  ok(made.status === 201, 'create: firm created');
  const slug2 = made.data.slug;
  ok(/^[a-z0-9-]+$/.test(slug2), `create: safe address (${slug2.slice(0, 40)}...)`);

  const pg = await getRaw('/firms/' + slug2);
  ok(pg.status === 200 && pg.headers.get('x-lawdb-source') === 'database', 'new firm has a page rendered from the database');
  ok(!pg.text.includes('<script>alert(1)</script>') && pg.text.includes('Smoke &lt;script&gt;alert(1)&lt;/script&gt; &amp; Associates'), 'firm name is escaped in the page');
  ok(!pg.text.includes('About <b>us</b>') && pg.text.includes('About &lt;b&gt;us&lt;/b&gt;') && pg.text.includes('<br><br>Second paragraph'), 'about text is escaped and keeps paragraphs');
  const ld = pg.text.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
  let ldOk = false;
  try { const j = JSON.parse(ld[1]); ldOk = j['@type'] === 'LegalService' && j.name === hostile && !j.aggregateRating; } catch {}
  ok(ldOk, 'structured data is valid JSON and has no made-up rating');
  ok(pg.text.includes('8:30 am – 5 pm') && pg.text.includes('8:30 am – 12 pm, 1 pm – 5 pm') && /Saturday<\/span><span class="ht closed">Closed/.test(pg.text), 'opening hours card is rendered');
  ok(!JSON.stringify(JSON.parse((await getRaw('/firms_data.json')).text)).includes('Second paragraph'), 'about text stays out of the public firm list');
  ok(pg.text.includes('class="guide"') && pg.text.includes('class="lw-car"') && pg.text.includes('id="leadForm-' + slug2 + '"'), 'guidance, nearby firms and contact form are present');
  ok(!/from \d+ Google reviews/.test(pg.text), 'no review line for a firm without Google data');
  const redir = await getRaw(`/firms/${slug2}.html`);
  ok(redir.status === 307 && redir.headers.get('location').endsWith('/firms/' + slug2), '.html address redirects to the clean address');
  ok((await getRaw('/firms/no-such-firm-xyz')).status === 404, 'unknown firm is a 404');

  const list = JSON.parse((await getRaw('/firms_data.json')).text);
  ok(list.some((f) => f.slug === slug2 && f.rating === 0), 'new firm appears in the directory data');
  ok(inlineFirms((await getRaw('/find-lawyers')).text).some((f) => f.slug === slug2), 'new firm appears on the Find Lawyers page');

  // existing firms keep their original hand-built page until switched
  const orig = await getRaw('/firms/achkar-law');
  ok(orig.status === 200 && !orig.headers.get('x-lawdb-source') && orig.text.includes('Achkar Law'), 'existing firm still serves its original page');
  ok((await call('PATCH', '/api/admin/firms/achkar-law', { pageMode: 'dynamic' })).status === 200, 'switch an existing firm to the database page');
  const sw = await getRaw('/firms/achkar-law');
  ok(sw.headers.get('x-lawdb-source') === 'database' && sw.text.includes('Achkar Law') && sw.text.includes('is an employment law firm that acts for both employees and employers'), 'switched firm now renders from the database and keeps its written description');
  ok((await call('PATCH', '/api/admin/firms/achkar-law', { pageMode: 'static' })).status === 200, 'switch it back');
  ok(!(await getRaw('/firms/achkar-law')).headers.get('x-lawdb-source'), 'firm is back on its original page');
  ok((await call('PATCH', '/api/admin/firms/achkar-law', { pageMode: 'weird' })).status === 422, 'invalid page style refused');

  // owner-style edits show on the rendered page
  const patch = await call('PATCH', `/api/admin/firms/${slug2}`, { about: 'Updated about text', tags: ['Tax'], hours: null });
  ok(patch.status === 200, 'edit about, practice areas and clear hours');
  const pg2 = await getRaw('/firms/' + slug2);
  ok(pg2.text.includes('Updated about text') && pg2.text.includes('<li>Tax</li>') && !pg2.text.includes('class="hours-card"'), 'edits and cleared hours show on the page');
}

// --- cross-site requests are refused even with a valid session cookie
ok((await call('PATCH', `/api/admin/leads/${mine.id}`, { status: 'new' }, { origin: 'https://evil.example' })).status === 403, 'cross-origin write refused');
ok((await call('POST', '/api/leads', { name: 'x', email: 'a@b.co' }, { origin: 'https://evil.example' })).status === 403, 'cross-origin lead post refused');

// --- sign out really signs out
ok((await call('POST', '/api/auth/logout')).status === 200, 'logout');
ok((await call('GET', '/api/admin/stats')).status === 401, 'locked again after logout');

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
