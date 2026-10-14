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

// --- firm owners: sign-up, claims, approval, editing, enquiries
{
  const run = Math.random().toString(36).slice(2, 8);
  const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`; // a made-up requester address, so reruns never trip the sign-up limit
  const adminJar = cookie;
  const origFirm = (await call('GET', '/api/admin/firms/achkar-law')).data.firm; // restored at the end, so reruns see the original
  const signUp = async (email, address = ip) => {
    cookie = '';
    const r = await call('POST', '/api/auth/request-link', { email, signup: true }, { 'cf-connecting-ip': address });
    if (!r.data?.dev_link) return null;
    const v = await call('POST', '/api/auth/verify', { token: tokenFrom(r.data.dev_link) });
    return v.status === 200 ? { jar: cookie, role: v.data.user.role } : null;
  };
  const as = (jar) => { cookie = jar; };

  // sign-up is only open to the owner form, and creates a plain member
  cookie = '';
  ok(!(await call('POST', '/api/auth/request-link', { email: `nobody-${run}@example.com` })).data.dev_link, 'a stranger signing in (no sign-up) still gets no link');
  const o1 = await signUp(`owner1-${run}@example.com`);
  ok(o1 && o1.role === 'member', 'a firm owner can create an account and is a plain member');
  as(o1.jar);
  ok((await call('GET', '/api/admin/stats')).status === 403, 'an owner cannot use admin APIs');
  ok((await call('GET', '/api/admin/members')).status === 403, 'an owner cannot see the approvals list');
  ok((await call('GET', '/api/account/me')).data.memberships.length === 0, 'a new owner manages no firms');

  // claim a firm
  ok((await call('POST', '/api/account/claims', { slug: 'achkar-law' })).status === 422, 'a claim needs a contact name');
  ok((await call('POST', '/api/account/claims', { slug: 'no-such-firm', contactName: 'Pat Owner' })).status === 404, 'claiming an unknown firm is refused');
  const claim = await call('POST', '/api/account/claims', { slug: 'achkar-law', contactName: 'Pat Owner', jobTitle: 'Partner', message: 'I run this firm' });
  ok(claim.status === 201 && claim.data.status === 'pending', 'owner asks to manage a firm');
  ok((await call('POST', '/api/account/claims', { slug: 'achkar-law', contactName: 'Pat Owner' })).status === 409, 'the same request twice is refused');
  ok((await call('GET', '/api/account/firms/achkar-law')).status === 403, 'a pending owner cannot open the firm yet');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'sneaky' })).status === 403, 'a pending owner cannot edit yet');
  ok((await call('GET', '/api/account/firms/achkar-law/leads')).status === 403, 'a pending owner cannot see its enquiries');

  // the admin sees it, and was told by email
  as(adminJar);
  const pend = (await call('GET', '/api/admin/members')).data.members;
  const pc = pend.find((m) => m.email === `owner1-${run}@example.com`);
  ok(pc && pc.firmName === 'Achkar Law' && pc.contactName === 'Pat Owner' && !pc.isNewListing, 'admin sees the claim with the claimant\'s details');
  ok((await call('GET', '/api/admin/stats')).data.pendingApprovals >= 1, 'the overview counts pending approvals');
  const audit1 = (await call('GET', '/api/admin/audit?limit=200')).data.entries;
  ok(audit1.some((e) => e.action === 'mail.dev' && e.detail?.subject === 'Approval needed: Achkar Law'), 'the admin is emailed when a claim arrives');

  // approve (and show the owner's edits on the page)
  ok((await call('PATCH', `/api/admin/members/${pc.id}`, { status: 'maybe' })).status === 422, 'approval status is validated');
  ok((await call('PATCH', `/api/admin/members/${pc.id}`, { status: 'approved', switchPage: true })).status === 200, 'admin approves the owner');
  ok((await getRaw('/firms/achkar-law')).headers.get('x-lawdb-source') === 'database', 'approval switched the firm to the database page');
  const audit2 = (await call('GET', '/api/admin/audit?limit=200')).data.entries;
  ok(audit2.some((e) => e.action === 'mail.dev' && e.detail?.subject === 'You can now manage Achkar Law on LawDB'), 'the owner is emailed when approved');

  // the owner edits their firm
  as(o1.jar);
  const mine = await call('GET', '/api/account/firms/achkar-law');
  ok(mine.status === 200 && mine.data.firm.name === 'Achkar Law', 'an approved owner can open their firm');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { featured: true })).status === 422, 'an owner cannot make themselves featured');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { pageMode: 'static' })).status === 422, 'an owner cannot change the page style');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { rating: 5 })).status === 422, 'an owner cannot change the rating');
  const edit = await call('PATCH', '/api/account/firms/achkar-law', { about: 'Owner wrote this <script>alert(1)</script> text', phone: '613-555-0100' });
  ok(edit.status === 200 && edit.data.changed.includes('about'), 'an owner edits their own firm');
  const opage = await getRaw('/firms/achkar-law');
  ok(opage.text.includes('Owner wrote this &lt;script&gt;') && !opage.text.includes('Owner wrote this <script>') && opage.text.includes('613-555-0100'), 'the owner\'s text is on the page and escaped');
  const featuredBefore = (await call('GET', '/api/firms/achkar-law')).data.featured;
  ok(featuredBefore === false, 'the firm is still not featured');

  // a second, unrelated owner has no access to it
  const o2 = await signUp(`owner2-${run}@example.com`);
  as(o2.jar);
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'hijack' })).status === 403, 'another owner cannot edit someone else\'s firm');
  ok((await call('GET', '/api/account/firms/achkar-law/leads')).status === 403, 'another owner cannot read its enquiries');

  // enquiries from the firm's page reach the owner right away
  cookie = '';
  const note1 = `Please call me about my case ${run}`;
  ok((await call('POST', '/api/leads', { name: 'Client One', email: `client-${run}@example.com`, phone: '613 555 0111', message: note1, form: 'firm-profile', firm: 'achkar-law', firmName: 'Achkar Law' })).status === 201, 'a visitor sends an enquiry from the firm\'s page');
  ok((await call('POST', '/api/leads', { name: 'Stray', email: `stray-${run}@example.com`, form: 'firm-profile', firm: 'no-such-firm' })).status === 201, 'an enquiry naming an unknown firm is still saved');
  as(o1.jar);
  const leads = await call('GET', '/api/account/firms/achkar-law/leads');
  const lead = leads.data.leads.find((l) => l.message === note1);
  ok(lead && lead.email === `client-${run}@example.com` && lead.phone === '613 555 0111', 'the owner sees the enquiry in their dashboard');
  ok(!leads.data.leads.some((l) => l.email === `stray-${run}@example.com`), 'the owner sees only their own firm\'s enquiries');
  ok((await call('PATCH', `/api/account/leads/${lead.id}`, { status: 'contacted' })).status === 200, 'the owner marks an enquiry contacted');
  ok((await call('PATCH', `/api/account/leads/${lead.id}`, { status: 'bogus' })).status === 422, 'bad enquiry status refused');
  as(o2.jar);
  ok((await call('PATCH', `/api/account/leads/${lead.id}`, { status: 'closed' })).status === 403, 'another owner cannot change this enquiry');
  as(adminJar);
  const audit3 = (await call('GET', '/api/admin/audit?limit=200')).data.entries;
  ok(audit3.some((e) => e.action === 'mail.dev' && e.entity_id === `owner1-${run}@example.com` && e.detail?.subject === 'New enquiry for Achkar Law'), 'the owner is emailed about the enquiry');

  // a firm that is not listed yet stays hidden until approved
  as(o2.jar);
  const hostile = `Birchwood <b>Legal</b> ${run}`;
  const newBody = { name: hostile, city: 'Ottawa', province: 'ON', address: '1 Main St', phone: '613-555-0199', tags: ['Family Law'], caseTypes: ['family'], about: 'We help families.', hours: { 2: [['09:00', '17:00']] }, contactName: 'Sam Founder', lat: 10, lng: 10 };
  const made = await call('POST', '/api/account/firms', newBody);
  ok(made.status === 201 && made.data.status === 'pending', 'an owner submits a new firm for approval');
  const nslug = made.data.slug;
  ok((await call('GET', '/api/account/me')).data.memberships.some((m) => m.slug === nslug && m.status === 'pending' && m.firmStatus === 'pending'), 'the new firm shows as waiting');
  cookie = '';
  ok((await call('GET', '/api/firms/' + nslug)).status === 404, 'a pending firm is not in the public API');
  ok(!(await call('GET', '/api/firms?limit=500')).data.some((f) => f.slug === nslug), 'a pending firm is not in the public list');
  ok(!(await getRaw('/firms_data.json')).text.includes(nslug), 'a pending firm is not in the data file');
  ok(!(await getRaw('/find-lawyers')).text.includes(nslug), 'a pending firm is not on the Find Lawyers page');
  ok((await getRaw('/firms/' + nslug)).status === 404, 'a pending firm\'s page is not public');
  ok((await call('POST', '/api/account/firms', newBody)).status === 401, 'creating a listing needs sign-in');
  as(o2.jar);
  ok((await call('POST', '/api/account/firms', { ...newBody, name: 'Other Firm ' + run })).status === 201, 'a second pending request is allowed');
  ok((await call('POST', '/api/account/firms', { ...newBody, name: 'Third Firm ' + run })).status === 201, 'a third pending request is allowed');
  ok((await call('POST', '/api/account/firms', { ...newBody, name: 'Fourth Firm ' + run })).status === 429, 'a fourth waiting request is refused');

  as(adminJar);
  const nm = (await call('GET', '/api/admin/members')).data.members.find((m) => m.slug === nslug);
  ok(nm && nm.isNewListing && nm.hasCoordinates === false, 'admin sees the new listing, flagged as new, without map coordinates');
  ok((await call('PATCH', `/api/admin/members/${nm.id}`, { status: 'approved' })).status === 422, 'a new listing cannot go live without coordinates');
  ok((await call('PATCH', `/api/admin/members/${nm.id}`, { status: 'approved', lat: 0, lng: 0 })).status === 422, 'coordinates outside Canada are refused');
  ok((await call('PATCH', `/api/admin/members/${nm.id}`, { status: 'approved', lat: 45.42, lng: -75.69 })).status === 200, 'admin approves and publishes the new listing');
  const live = await getRaw('/firms/' + nslug);
  ok(live.status === 200 && live.headers.get('x-lawdb-source') === 'database' && live.text.includes('Birchwood &lt;b&gt;Legal&lt;/b&gt;') && !live.text.includes('<b>Legal</b>'), 'the approved firm has a public page, name escaped');
  ok((await call('GET', '/api/firms/' + nslug)).data.lat === 45.42, 'the approved firm is in the public API with its map position');
  ok(inlineFirms((await getRaw('/find-lawyers')).text).some((f) => f.slug === nslug), 'the approved firm appears on the Find Lawyers page');
  cookie = '';
  ok((await call('POST', '/api/account/firms', newBody)).status === 401, 'still needs sign-in');
  as(o2.jar);
  ok((await call('POST', '/api/account/firms', { ...newBody, name: hostile })).status === 409, 'listing a firm that already exists is refused');
  ok((await call('PATCH', `/api/account/firms/${nslug}`, { about: 'Edited after going live', hours: { 1: [['08:00', '16:30']] } })).status === 200, 'the owner of a new listing can edit it once live');
  cookie = '';
  ok(isDeepStrictEqual((await call('GET', '/api/firms/' + nslug)).data.hours, { 1: [['08:00', '16:30']] }), 'owner hours reach the public data');

  // removing access takes effect immediately
  as(adminJar);
  const owner1Row = (await call('GET', '/api/admin/members?decided=1')).data.members.find((m) => m.email === `owner1-${run}@example.com`);
  ok(owner1Row && owner1Row.status === 'approved', 'admin sees the approved owner in recent decisions');
  ok((await call('PATCH', `/api/admin/members/${owner1Row.id}`, { status: 'rejected' })).status === 200, 'admin removes an owner\'s access');
  as(o1.jar);
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'still here?' })).status === 403, 'a removed owner can no longer edit');
  ok((await call('GET', '/api/account/firms/achkar-law/leads')).status === 403, 'a removed owner no longer receives enquiries');
  cookie = '';
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'x' }, { origin: 'https://evil.example' })).status === 403, 'cross-origin owner write refused');

  // put the shared test firm back as it was
  as(adminJar);
  await call('PATCH', '/api/admin/firms/achkar-law', { pageMode: 'static', phone: origFirm.phone || '', about: origFirm.about || '' });

  // sign-up has its own brake, so strangers cannot use us to send mail
  const flood = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
  let linked = 0;
  for (let i = 0; i < 8; i++) if (await signUp(`flood${i}-${run}@example.com`, flood)) linked++;
  ok(linked === 6, 'sign-up links are limited per requester (6 an hour)');
  as(adminJar);
  ok((await call('GET', '/api/admin/audit?limit=100')).data.entries.some((e) => e.action === 'signup.throttled'), 'a throttled sign-up leaves a trace');
}

// --- cross-site requests are refused even with a valid session cookie
ok((await call('PATCH', `/api/admin/leads/${mine.id}`, { status: 'new' }, { origin: 'https://evil.example' })).status === 403, 'cross-origin write refused');
ok((await call('POST', '/api/leads', { name: 'x', email: 'a@b.co' }, { origin: 'https://evil.example' })).status === 403, 'cross-origin lead post refused');

// --- sign out really signs out
ok((await call('POST', '/api/auth/logout')).status === 200, 'logout');
ok((await call('GET', '/api/admin/stats')).status === 401, 'locked again after logout');

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
