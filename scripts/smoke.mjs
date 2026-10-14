// End-to-end smoke test against a running dev server (npm run dev) seeded with data.
// Needs .dev.vars containing:  ADMIN_EMAILS=smoke-admin@example.com  and  DEV_ECHO_LINK=1
//   BASE=http://localhost:8799 npm run smoke
import { readFileSync, existsSync } from 'node:fs';
import { createPublicKey, createVerify } from 'node:crypto';
import zlib from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { emailMatch } from '../src/routes/admin.js';
import { checkOwnerText } from '../src/lib/content-rules.js';
import { parseFeed, parseWpPosts, fillWpMedia, plain as feedPlain, checkFeedUrl, cleanImageUrl, wpPostsUrlWithImages } from '../src/lib/feeds.js';
import http from 'node:http';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:8799';
const ADMIN = process.env.SMOKE_ADMIN || 'smoke-admin@example.com';
let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed++;
};
let cookie = '';
// Every request comes from a made-up address per run, so rate limits never interfere between reruns.
const RUN_IP = `192.0.2.${1 + Math.floor(Math.random() * 250)}`;
const call = async (method, path, body, extraHeaders = {}) => {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000), // never hang forever on a dead server
    headers: { 'cf-connecting-ip': RUN_IP, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
};

// --- tiny image builders for the picture tests (real PNG; JPEG/WebP carry valid headers with the stated size)
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
const makePng = (w, h, shade = 200) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, shade)]);
  const raw = Buffer.concat(Array.from({ length: Math.min(h, 400) }, () => row)); // enough rows to be a real file; header states the size
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
};
const makeJpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const makeWebp = (w, h) => { const b = Buffer.alloc(40); b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };
const rawCall = async (method, path, bytes, type, extraHeaders = {}) => {
  const res = await fetch(BASE + path, { method, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'cf-connecting-ip': RUN_IP, ...(type ? { 'content-type': type } : {}), ...(cookie ? { cookie } : {}), ...extraHeaders }, body: bytes });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
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
const health = await call('GET', '/api/health');
ok(health.status === 200 && health.data.db === true, 'health check reads the database');
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
{ const old = await getRaw('/find-lawyers.html'); ok(old.status === 301 && old.headers.get('location').endsWith('/find-lawyers'), 'an old .html address redirects to the clean address, permanently (301)'); }
{
  const check = async (from, to, label) => { const r = await getRaw(from); ok(r.status === 301 && r.headers.get('location').endsWith(to), label || `${from} moves permanently to ${to}`); };
  await check('/ontario/toronto/family-lawyers.html', '/ontario/toronto/family-lawyers');
  await check('/ontario/toronto/index.html', '/ontario/toronto/');
  await check('/index.html', '/');
  await check('/services/family', '/ontario/family-lawyers', 'the old Ontario practice-area page moved under /ontario/');
  await check('/services/bc-injury.html', '/british-columbia/personal-injury-lawyers');
  await check('/services/qc-traffic', '/quebec/traffic-ticket-lawyers');
  await check('/legal-news', '/news');
  await check('/legal-news.html?firm=x', '/news?firm=x', 'the old News address keeps its filter');
  await check('/legal-news/scc-berg-credibility-wd-2026.html', '/court-decisions/scc-berg-credibility-wd-2026');
  ok((await getRaw('/british-columbia/family-lawyers')).status === 200 && (await getRaw('/court-decisions/scc-berg-credibility-wd-2026')).status === 200 && (await getRaw('/news')).status === 200, 'the new addresses answer directly, with no redirect');
}
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
  ok(redir.status === 301 && redir.headers.get('location').endsWith('/firms/' + slug2), '.html address redirects to the clean address');
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
  ok((await call('POST', '/api/account/claims', { slug: 'achkar-law', acceptTerms: true })).status === 422, 'a claim needs a contact name');
  ok((await call('POST', '/api/account/claims', { slug: 'achkar-law', contactName: 'Pat Owner' })).status === 422, 'a claim needs the firm terms accepted');
  ok((await call('POST', '/api/account/claims', { slug: 'no-such-firm', contactName: 'Pat Owner', acceptTerms: true })).status === 404, 'claiming an unknown firm is refused');
  const claim = await call('POST', '/api/account/claims', { slug: 'achkar-law', contactName: 'Pat Owner', jobTitle: 'Partner', message: 'I run this firm', acceptTerms: true });
  ok(claim.status === 201 && claim.data.status === 'pending', 'owner asks to manage a firm');
  ok((await call('POST', '/api/account/claims', { slug: 'achkar-law', contactName: 'Pat Owner', acceptTerms: true })).status === 409, 'the same request twice is refused');
  ok((await call('GET', '/api/account/firms/achkar-law')).status === 403, 'a pending owner cannot open the firm yet');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'sneaky' })).status === 403, 'a pending owner cannot edit yet');
  ok((await call('GET', '/api/account/firms/achkar-law/leads')).status === 403, 'a pending owner cannot see its enquiries');

  // the admin sees it, and was told by email
  as(adminJar);
  const pend = (await call('GET', '/api/admin/members')).data.members;
  const pc = pend.find((m) => m.email === `owner1-${run}@example.com`);
  ok(pc && pc.firmName === 'Achkar Law' && pc.contactName === 'Pat Owner' && !pc.isNewListing, 'admin sees the claim with the claimant\'s details');
  ok(['mismatch', 'nosite'].includes(pc.emailMatch), 'a claimant whose email is not on the firm\'s domain is flagged for the admin');
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
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'Hello <script>alert(1)</script>' })).status === 422, 'an owner cannot enter HTML');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'See www.spam-site.com for deals' })).status === 422, 'an owner cannot put links in the description');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { about: 'We are the best lawyers in Ontario' })).status === 422, 'an owner cannot make prohibited advertising claims');
  ok((await call('PATCH', '/api/account/firms/achkar-law', { blurb: 'Guaranteed results' })).status === 422, 'the short description is checked too');
  const edit = await call('PATCH', '/api/account/firms/achkar-law', { about: 'Owner wrote this & that "quoted" text', phone: '613-555-0100' });
  ok(edit.status === 200 && edit.data.changed.includes('about'), 'an owner edits their own firm');
  const opage = await getRaw('/firms/achkar-law');
  ok(opage.text.includes('Owner wrote this &amp; that &quot;quoted&quot; text') && opage.text.includes('613-555-0100'), 'the owner\'s text is on the page and escaped');
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
  const hostile = `Birchwood & "Legal" ${run}`;
  const newBody = { name: hostile, city: 'Ottawa', province: 'ON', address: '1 Main St', phone: '613-555-0199', tags: ['Family Law'], caseTypes: ['family'], about: 'We help families.', hours: { 2: [['09:00', '17:00']] }, contactName: 'Sam Founder', acceptTerms: true, lat: 10, lng: 10 };
  ok((await call('POST', '/api/account/firms', { ...newBody, name: `Birchwood <b>Legal</b> ${run}` })).status === 422, 'HTML in a new firm\'s name is refused');
  ok((await call('POST', '/api/account/firms', { ...newBody, name: `Best Lawyers Ever ${run}` })).status === 422, 'a prohibited claim in a new firm\'s name is refused');
  ok((await call('POST', '/api/account/firms', { ...newBody, acceptTerms: false })).status === 422, 'a new firm needs the terms accepted');
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
  ok(live.status === 200 && live.headers.get('x-lawdb-source') === 'database' && live.text.includes('Birchwood &amp; &quot;Legal&quot;'), 'the approved firm has a public page, name escaped');
  ok((await call('GET', '/api/firms/' + nslug)).data.lat === 45.42, 'the approved firm is in the public API with its map position');
  ok(inlineFirms((await getRaw('/find-lawyers')).text).some((f) => f.slug === nslug), 'the approved firm appears on the Find Lawyers page');
  cookie = '';
  ok((await call('POST', '/api/account/firms', newBody)).status === 401, 'still needs sign-in');
  as(o2.jar);
  ok((await call('POST', '/api/account/firms', { ...newBody, name: hostile })).status === 409, 'listing a firm that already exists is refused');
  ok((await call('PATCH', `/api/account/firms/${nslug}`, { about: 'Edited after going live', hours: { 1: [['08:00', '16:30']] } })).status === 200, 'the owner of a new listing can edit it once live');
  cookie = '';
  ok(isDeepStrictEqual((await call('GET', '/api/firms/' + nslug)).data.hours, { 1: [['08:00', '16:30']] }), 'owner hours reach the public data');

  // blog cards: a firm's public feed becomes small cards (headline, short excerpt, link to the firm's own site)
  const days = (n) => new Date(Date.now() - n * 86400000).toUTCString();
  const longText = 'The roadside stop is only the beginning of a long process that affects licences insurance and records. '.repeat(12);
  let origin = '';
  const rss = () => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Blog</title><link>${origin}/</link>
<item><title>Charged With Impaired Driving: What Happens Next</title><link>${origin}/blog/impaired</link><guid>g1</guid><pubDate>${days(1)}</pubDate><description><![CDATA[<p>${longText}</p><p>The post Charged With Impaired Driving appeared first on Some Firm.</p>]]></description><media:content url="${origin}/img/a.jpg" medium="image" xmlns:media="http://search.yahoo.com/mrss/"/></item>
<item><title>Tom &amp; Jerry's Guide</title><link>${origin}/blog/guide</link><guid>g2</guid><pubDate>${days(2)}</pubDate><description><![CDATA[Short and sweet summary.<img src="${origin}/img/b.jpg" width="600" height="300">]]></description></item>
<item><title>Elsewhere</title><link>https://evil.example/steal</link><guid>g3</guid><pubDate>${days(3)}</pubDate><description>Off-site link.</description></item>
<item><title><![CDATA[<script>alert(1)</script>Scripted headline]]></title><link>${origin}/blog/script</link><guid>g4</guid><pubDate>${days(4)}</pubDate><description><![CDATA[Hello <img src="javascript:alert(1)" onerror=alert(1)> <img src="data:image/png;base64,AAAA"> world]]></description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><guid>g5</guid><pubDate>${days(5)}</pubDate><description>x</description></item>
<item><title>Older one</title><link>${origin}/blog/older</link><guid>g6</guid><pubDate>${days(20)}</pubDate><content:encoded><![CDATA[<p>${longText.repeat(6)}</p><img src="${origin}/img/same.jpg">]]></content:encoded></item>
<item><title>Oldest one</title><link>${origin}/blog/oldest</link><guid>g7</guid><pubDate>${days(40)}</pubDate><description><![CDATA[Oldest.<img src="${origin}/img/same.jpg">]]></description></item></channel></rss>`;
  let wpOn = false;
  let feedBroken = false;
  const wpJson = () => JSON.stringify([
    { id: 901, date: new Date(Date.now() - 3600000).toISOString().slice(0, 19), link: `${origin}/2026/news-one/`, title: { rendered: 'WordPress &#8211; Post One &amp; Co' }, _embedded: { 'wp:featuredmedia': [{ source_url: `${origin}/img/wp-full.jpg`, media_details: { width: 1600, sizes: { medium_large: { source_url: `${origin}/img/wp-768.jpg` } } } }] }, excerpt: { rendered: '<p>First WordPress excerpt about wills &hellip; and more text that goes on for a while so that it is long enough to expand into a longer preview on the card when somebody taps read more, which is what we want.</p>\n' } },
    { id: 902, date: new Date(Date.now() - 86400000).toISOString().slice(0, 19), link: `${origin}/2026/news-two/`, title: { rendered: 'Post Two' }, jetpack_featured_media_url: `${origin}/img/jp.jpg`, excerpt: { rendered: '' } },
    { id: 903, date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 19), link: 'https://evil.example/x', title: { rendered: 'Off-site' }, excerpt: { rendered: 'no' } },
    { id: 904, date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 19), link: `${origin}/2026/news-media/`, title: { rendered: 'Media Only' }, featured_media: 555, excerpt: { rendered: 'x' } },
    { id: 905, date: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 19), link: `${origin}/2026/news-yoast/`, title: { rendered: 'Yoast Picture' }, featured_media: 0, yoast_head_json: { og_image: [{ url: `${origin}/img/yoast.jpg`, width: 1600 }] }, excerpt: { rendered: 'y' } },
  ]);
  const fixtureServer = http.createServer((req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.url.startsWith('/wp-json/wp/v2/media')) return wpOn ? send(200, 'application/json', JSON.stringify([{ id: 555, source_url: `${origin}/img/m555.jpg`, media_details: { width: 1200, sizes: { medium_large: { source_url: `${origin}/img/m555-768.jpg` } } } }])) : send(404, 'application/json', '{}');
    if (req.url.startsWith('/wp-json/wp/v2/posts')) return wpOn ? send(200, 'application/json', wpJson()) : send(404, 'application/json', '{"code":"rest_no_route"}');
    if (req.url === '/feed.xml') return feedBroken ? send(500, 'text/plain', 'broken') : send(200, 'application/rss+xml', rss());
    if (req.url === '/site') return send(200, 'text/html', `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>Firm</body></html>`);
    if (req.url === '/boom') return send(500, 'text/plain', 'broken');
    if (req.url === '/html') return send(200, 'text/html', '<html><body>not a feed</body></html>');
    send(404, 'text/plain', 'nope');
  });
  await new Promise((r) => fixtureServer.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${fixtureServer.address().port}`;

  // the reader itself (unit): safe, short, text only, own-site links only
  const parsed = parseFeed(rss(), { feedUrl: origin + '/feed.xml', siteUrl: origin, allowLocal: true });
  ok(parsed.length === 5 && !parsed.some((x) => /evil|javascript/.test(x.url)), 'the reader keeps only posts that link to the firm\'s own site');
  ok(parsed[0].title.startsWith('Charged With Impaired Driving') && parsed.every((x, i) => !i || (parsed[i - 1].publishedAt || '') >= (x.publishedAt || '')), 'posts come newest first');
  ok(parsed.every((x) => x.excerpt.length <= 600 && !/[<>]/.test(x.title + x.excerpt)), 'excerpts are short plain text');
  ok(!/appeared first on/.test(parsed[0].excerpt) && parsed[0].excerpt.endsWith('...'), 'WordPress boilerplate is removed and long text is cut');
  ok(parsed.find((x) => x.guid === 'g2').title === "Tom & Jerry's Guide", 'entities in headlines are decoded to text');
  ok(parsed.find((x) => x.guid === 'g4').title === 'Scripted headline' && !/alert/.test(parsed.find((x) => x.guid === 'g4').excerpt), 'scripts and tags in feeds are stripped');
  ok(parsed.find((x) => x.guid === 'g6').excerpt.length <= 600, 'a feed that only gives full text is cut to a short excerpt');
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom post</title><link rel="alternate" href="https://www.firm.ca/blog/a"/><id>urn:1</id><updated>2026-09-01T10:00:00Z</updated><summary>An atom summary</summary></entry></feed>`;
  const ap = parseFeed(atom, { feedUrl: 'https://firm.ca/atom.xml', siteUrl: 'https://firm.ca' });
  ok(ap.length === 1 && ap[0].url === 'https://www.firm.ca/blog/a' && ap[0].excerpt === 'An atom summary', 'Atom feeds work too');
  const wpParsed = parseWpPosts(JSON.parse(wpJson()), { feedUrl: origin + '/wp-json/wp/v2/posts', siteUrl: origin, allowLocal: true });
  ok(wpParsed.length === 4 && !wpParsed.some((x) => /evil/.test(x.url)), 'WordPress posts: only the firm\'s own links are kept');
  ok(wpParsed[0].image === origin + '/img/wp-768.jpg' && wpParsed[1].image === origin + '/img/jp.jpg', 'WordPress posts: the featured picture is found (a good size first)');
  ok(wpParsed.find((x) => x.mediaId === 555) && wpParsed.find((x) => x.mediaId === 555).image === null && wpParsed.find((x) => x.guid === 'wp:905').image === origin + '/img/yoast.jpg', 'WordPress posts: the SEO plugin\'s share picture is used; a post with only a media id is remembered');
  wpOn = true;
  const filled = await fillWpMedia({ DEV_ECHO_LINK: '1' }, wpParsed.map((x) => ({ ...x })), origin + '/wp-json/wp/v2/posts', { allowLocal: true });
  wpOn = false;
  ok(filled.find((x) => x.mediaId === 555).image === origin + '/img/m555-768.jpg', 'a hidden featured picture is found through the media list');
  ok(parsed.find((x) => x.guid === 'g1').image === origin + '/img/a.jpg' && parsed.find((x) => x.guid === 'g2').image === origin + '/img/b.jpg', 'feeds: pictures come from media tags or the post\'s own first picture');
  ok(parsed.find((x) => x.guid === 'g4').image === null && parsed.find((x) => x.guid === 'g6').image === null && parsed.find((x) => x.guid === 'g7').image === null, 'script/data addresses and a picture repeated on several posts (a stand-in) are left out');
  ok(cleanImageUrl('http://firm.ca/a.jpg', 'https://firm.ca/') === 'https://firm.ca/a.jpg' && cleanImageUrl('/wp-content/a.png?x=1', 'https://firm.ca/blog/') === 'https://firm.ca/wp-content/a.png?x=1' && cleanImageUrl('//cdn.firm.ca/a.webp', 'https://firm.ca/') === 'https://cdn.firm.ca/a.webp', 'picture addresses are tidied: https, relative and protocol-relative forms work');
  ok(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://127.0.0.1/a.jpg', 'https://10.0.0.1/a.jpg', 'https://user:pw@firm.ca/a.jpg', 'https://firm.ca/a.svg', 'https://firm.ca/pixel.png', 'https://firm.ca:8443/a.jpg', '', null].every((u) => cleanImageUrl(u, 'https://firm.ca/') === null), 'unsafe or useless picture addresses are refused');
  ok(wpPostsUrlWithImages('https://firm.ca/wp-json/wp/v2/posts?per_page=6&_fields=id,date,link,title,excerpt').includes('_embed=wp%3Afeaturedmedia'), 'WordPress is asked for featured pictures');
  ok(wpParsed[0].title === 'WordPress \u2013 Post One & Co' && !/[<>]/.test(wpParsed[0].excerpt) && /wills/.test(wpParsed[0].excerpt), 'WordPress posts: headlines and excerpts are clean text');
  ok(parseWpPosts([{ id: 1, date: '2022-01-05T16:07:11', link: 'https://weaversimmons.com/a/', title: { rendered: 'T' } }], { feedUrl: 'https://www.weaversimmons.com/wp-json/wp/v2/posts', siteUrl: 'http://www.weaversimmons.com/' }).length === 1, 'a site with and without www is the same site');
  ok(parseWpPosts({ not: 'an array' }, { feedUrl: 'https://a.ca/x', siteUrl: 'https://a.ca' }).length === 0, 'a reply that is not a post list yields nothing');
  ok(['Hi &amp; bye', 'Hi & bye'].includes(feedPlain('<![CDATA[<b>Hi</b> &amp; bye]]>')), 'text extraction is tidy');
  const bad = (u) => { try { checkFeedUrl(u); return false; } catch { return true; } };
  ok(bad('http://firm.ca/feed') && bad('https://127.0.0.1/feed') && bad('https://10.0.0.5/feed') && bad('https://localhost/feed') && bad('https://intranet/feed') && bad('https://printer.local/feed') && bad('https://a.ca:8443/feed') && bad('https://user:pw@a.ca/feed') && bad('ftp://a.ca/feed') && bad('not a url'), 'unsafe feed addresses are refused');
  ok(!bad('https://www.firm.ca/blog/feed/'), 'a normal feed address is accepted');

  // featured, hand-built page: cards appear after "From the Firm"
  cookie = adminJar;
  const featSlug = 'daniel-brown-law-llp';
  const setFeed = await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { feedUrl: origin + '/feed.xml' });
  ok(setFeed.status === 200 && setFeed.data.feed.status === 'ok' && setFeed.data.posts.length === 5, 'the admin sets a firm\'s feed and it is read at once');
  const featPage = (await getRaw('/firms/' + featSlug)).text;
  const cardCount = (featPage.match(/<article class="lw-bc">/g) || []).length;
  ok(cardCount === 3 && featPage.indexOf('class="lw-blog"') > featPage.indexOf('class="from-firm"') && featPage.indexOf('class="lw-blog"') < featPage.indexOf('class="fine"'), 'three cards sit between "From the Firm" and the fine print');
  ok(featPage.includes('Charged With Impaired Driving') && featPage.includes('Tom &amp; Jerry&#x27;s Guide') && !featPage.includes('evil.example') && !featPage.includes('<script>alert') && !featPage.includes('onerror=alert'), 'card text is escaped and off-site links never appear');
  const storyHref = (/href="(\/news\/daniel-brown-law-llp\/charged-with-impaired-driving-what-happens-next-\d+)"/.exec(featPage) || [])[1];
  ok(!!storyHref && featPage.includes('data-story') && !featPage.includes(`href="${origin}/blog/impaired"`), 'each card opens the story\'s own LawDB page');
  const story = await getRaw(storyHref || '/news/none/x-1');
  ok(story.status === 200 && story.text.includes('<h1>Charged With Impaired Driving: What Happens Next</h1>') && story.text.includes(`href="${origin}/blog/impaired"`) && story.text.includes('Read the full article on 127.0.0.1') && story.text.includes(`rel="canonical" href="https://lawdb.ca${storyHref}"`) && story.text.includes('"@type":"BreadcrumbList"') && story.text.includes('href="/firms/daniel-brown-law-llp"') && !story.text.includes('<script>alert') && !story.text.includes('onerror=alert'), 'the story page shows the headline, the firm, the preview, a link to the full article, and a canonical address');
  ok(story.text.includes('This is a short preview') && !story.text.includes(longText.repeat(2)), 'the page carries only the short preview, never the full article');
  const part = await getRaw(storyHref + '?partial=1');
  ok(part.status === 200 && !/<html|<head/i.test(part.text) && part.text.includes('class="st"') && part.headers.get('x-robots-tag') === 'noindex', 'the expanded view is just the story (and is not indexed on its own)');
  const sid = storyHref.match(/-(\d+)$/)[1];
  const wrong = await getRaw(`/news/daniel-brown-law-llp/some-old-wording-${sid}`);
  ok(wrong.status === 301 && wrong.headers.get('location').endsWith(storyHref), 'a story address with old wording redirects to the right one');
  ok((await getRaw(`/news/achkar-law/x-${sid}`)).status === 404 && (await getRaw('/news/daniel-brown-law-llp/x-99999999')).status === 404 && (await getRaw('/news/daniel-brown-law-llp/garbage')).status === 404, 'wrong firm, unknown id and nonsense addresses are 404');
  const smap = await getRaw('/sitemap-news.xml');
  ok(smap.status === 200 && /xml/.test(smap.headers.get('content-type')) && smap.text.includes(`<loc>https://lawdb.ca${storyHref}</loc>`) && (smap.text.match(/<loc>/g) || []).length >= 5 && !smap.text.includes('evil.example'), 'the story sitemap lists every story page');
  ok(/Sitemap: https:\/\/lawdb.ca\/sitemap-news.xml/.test(readFileSync(new URL('../robots.txt', import.meta.url), 'utf8')), 'robots.txt announces the story sitemap');
  ok(featPage.includes(`<img src="${origin}/img/a.jpg"`) && featPage.includes('class="lw-bc-img"') && /referrerpolicy="no-referrer"/.test(featPage) && /loading="lazy"/.test(featPage) && !featPage.includes('javascript:alert') && !featPage.includes('data:image'), 'cards show the article picture (lazy, no referrer) and never an unsafe address');
  ok(!(await getRaw('/firms/torkin-manes-llp')).text.includes('class="lw-blog"'), 'other firms are not affected');
  ok((await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { enabled: false })).status === 200 && !(await getRaw('/firms/' + featSlug)).text.includes('class="lw-blog"'), 'switching a firm\'s cards off removes them');
  ok((await getRaw(storyHref)).status === 404 && !(await getRaw('/sitemap-news.xml')).text.includes(storyHref), 'a switched-off firm\'s story pages disappear too');
  ok((await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { enabled: true })).status === 200 && (await getRaw('/firms/' + featSlug)).text.includes('class="lw-blog"'), 'and back on');

  // bad feeds
  feedBroken = true; // the same feed starts failing, as a real site sometimes does
  const brokenFeed = await call('POST', `/api/admin/firms/${featSlug}/feed/refresh`);
  feedBroken = false;
  ok(brokenFeed.data.result.status === 'error' && brokenFeed.data.feed.status === 'error' && brokenFeed.data.posts.length === 5, 'a broken feed is reported and the earlier posts are kept');
  ok((await getRaw('/firms/' + featSlug)).text.includes('class="lw-blog"'), 'the page keeps showing the earlier cards');
  ok((await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { feedUrl: origin + '/html' })).data.feed.status === 'error', 'a page that is not a feed is reported');
  ok((await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { feedUrl: 'https://10.0.0.1/feed' })).status === 422 && (await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { feedUrl: 'http://example.com/feed' })).status === 422, 'unsafe addresses are refused when saving');
  ok((await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { colour: 'red' })).status === 422, 'unknown settings are refused');
  await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { feedUrl: origin + '/feed.xml' });

  // finding the feed automatically from the firm's website
  await call('PATCH', '/api/admin/firms/achkar-law', { website: origin + '/site' });
  await call('PATCH', '/api/admin/firms/achkar-law/feed', { feedUrl: '' });
  let found = null;
  for (let i = 0; i < 20 && !found; i++) { const f = (await call('GET', '/api/admin/firms/achkar-law/feed')).data; if (f.feed && f.feed.status === 'ok') found = f; else await new Promise((r) => setTimeout(r, 500)); }
  ok(found && found.feed.feedUrl === origin + '/feed.xml' && found.feed.source === 'auto' && found.feed.kind === 'rss', 'an RSS feed is found automatically from the firm\'s website');
  wpOn = true;
  await call('PATCH', '/api/admin/firms/achkar-law/feed', { feedUrl: '' });
  let foundWp = null;
  for (let i = 0; i < 20 && !foundWp; i++) { const f = (await call('GET', '/api/admin/firms/achkar-law/feed')).data; if (f.feed && f.feed.status === 'ok' && f.feed.kind === 'wp') foundWp = f; else await new Promise((r) => setTimeout(r, 500)); }
  ok(foundWp && /\/wp-json\/wp\/v2\/posts/.test(foundWp.feed.feedUrl) && foundWp.posts.some((x) => x.title.includes('Post One')), 'a WordPress blog is found automatically and read');
  wpOn = false;
  await call('PATCH', '/api/admin/firms/achkar-law', { website: origFirm.website || '' });

  // owners control their own firm's cards, and only theirs
  as(o2.jar);
  ok((await call('GET', '/api/account/firms/achkar-law/feed')).status === 403 && (await call('PATCH', '/api/account/firms/achkar-law/feed', { enabled: false })).status === 403, 'another owner cannot touch this firm\'s cards');
  as(o1.jar);
  ok((await getRaw('/firms/achkar-law')).text.includes('class="lw-blog"'), 'database-built pages show the cards too');
  ok((await call('GET', '/api/account/firms/achkar-law/feed')).data.posts.length >= 2, 'the owner sees their feed status');
  ok((await call('PATCH', '/api/account/firms/achkar-law/feed', { enabled: false })).status === 200 && !(await getRaw('/firms/achkar-law')).text.includes('class="lw-blog"'), 'an owner switches their cards off');
  ok((await call('PATCH', '/api/account/firms/achkar-law/feed', { enabled: true })).status === 200, 'and on again');
  ok((await call('POST', '/api/account/firms/achkar-law/feed/refresh')).status === 429, 'an owner cannot re-check within minutes of the last check');
  as(adminJar);
  ok((await call('POST', '/api/admin/firms/achkar-law/feed/refresh')).status === 200, 'an admin can always check');
  cookie = '';
  ok((await call('GET', '/api/admin/firms/achkar-law/feed')).status === 401 && (await call('GET', '/api/account/firms/achkar-law/feed')).status === 401, 'feed settings need sign-in');
  // leave the shared test firms as they were
  as(adminJar);
  for (const slug of ['achkar-law', featSlug]) await call('PATCH', `/api/admin/firms/${slug}/feed`, { enabled: false });
  // LawDB News: the page of firms' blog cards
  as(adminJar);
  await call('PATCH', `/api/admin/firms/${featSlug}/feed`, { enabled: true, feedUrl: origin + '/feed.xml' });
  await call('PATCH', '/api/admin/firms/achkar-law/feed', { enabled: true, feedUrl: origin + '/feed.xml' });
  cookie = '';
  const news = await getRaw('/news');
  ok(news.status === 200 && news.headers.get('x-lawdb-source') === 'database' && /<h1><span class="u">LawDB News<\/span><\/h1>/.test(news.text), 'LawDB News is built from the database');
  const nCards = (news.text.match(/<article class="lw-bc[ "]/g) || []).length;
  ok(nCards === 7 && news.text.includes('Daniel Brown Law LLP') && news.text.includes('Achkar Law'), 'it shows cards from every firm that has its blog switched on, with only a few that have no picture');
  const noPic = news.text.split(/<article class="lw-bc[ "]/).slice(1).filter((c) => !c.includes('class="lw-bc-img"')).length;
  ok(noPic === 3 && (news.text.match(/class="lw-bc-img"/g) || []).length === 4, 'every post with a picture is shown, and at most three without');
  ok(news.text.includes('class="lw-bc-grid lw-feed"') && news.text.includes('class="lw-bc-head"') && news.text.includes('/images/logos/daniel-brown-law-llp.jpg') && /class="lw-av">[A-Z]</.test(news.text), 'the News page is laid out as a feed with a post header: the firm logo, or its initial');
  ok((news.text.match(/class="lw-bc lw-hero"/g) || []).length === 1 && /<article class="lw-bc lw-hero"><div class="lw-bc-head">/.test(news.text), 'the newest story with a picture leads the page as one large card');
  ok(/<svg class="news-seal"[^>]*aria-hidden="true"/.test(news.text) && news.text.includes('class="news-drift" aria-hidden="true"') && (news.text.match(/class="news-card k\d"/g) || []).length === 4 && !/<image\b/.test(news.text.slice(news.text.indexOf('<header class="news-band">'), news.text.indexOf('</header>'))) && news.text.includes('prefers-reduced-motion'), 'the masthead has decorative artwork: a turning seal and four of the page\'s own stories drifting up (pure drawing, hidden from screen readers, still for reduced motion)');
  ok(/<header class="news-band">/.test(news.text) && news.text.includes('class="news-steps"') && news.text.includes('The firms writing here') && /<b>2<\/b><span>FIRMS WRITING/.test(news.text) && /<b>7<\/b><span>RECENT ARTICLES/.test(news.text), 'the page opens with a masthead, how it works, who is writing, and real counts (firms and articles)');
  ok(!news.text.includes('Back to results'), 'the News page header has no stray "Back to results" link');
  ok(/Daniel Brown Law LLP<\/a><span class="lw-ft">Featured<\/span>/.test(news.text) && !/Achkar Law<\/a><span class="lw-ft">/.test(news.text), 'only Featured firms carry the Featured badge');
  ok(news.text.includes('data-story') && news.text.includes('<dialog id="story-dlg"') && news.text.includes('partial=1') && /href="\/news\/daniel-brown-law-llp\/[a-z0-9-]+-\d+"/.test(news.text) && !news.text.includes(`href="${origin}/blog/impaired"`) && !news.text.includes('evil.example') && !news.text.includes('<script>alert') && !news.text.includes('onerror=alert'), 'cards open the story over the page (its own address, Back closes it), and nothing unsafe gets in');
  ok(news.text.includes(`<img src="${origin}/img/a.jpg"`) && news.text.includes('aspect-ratio:16/9'), 'LawDB News cards carry the article pictures');
  ok(news.text.includes('/news?firm=achkar-law') && news.text.includes('aria-current="true">All firms'), 'there are filters by firm');
  const only = await getRaw('/news?firm=achkar-law');
  ok((only.text.match(/<article class="lw-bc[ "]/g) || []).length === 5 && !only.text.includes('Daniel Brown Law LLP</a><span'), 'a firm filter shows only that firm\'s cards');
  as(adminJar);
  const nAdmin = await call('GET', '/api/admin/news');
  ok(nAdmin.status === 200 && nAdmin.data.featuredOnly === false && nAdmin.data.firms.some((f) => f.slug === featSlug && f.featured && f.enabled && f.status === 'ok' && f.posts === 5), 'the admin sees which firms are on the page, and their status');
  ok((await call('PATCH', '/api/admin/news', { featuredOnly: true })).status === 200, 'the admin limits the page to Featured members');
  cookie = '';
  const fOnly = (await getRaw('/news')).text;
  ok(fOnly.includes('Daniel Brown Law LLP') && !fOnly.includes('>Achkar Law<'), 'then only Featured firms\' blogs appear');
  as(adminJar);
  ok((await call('PATCH', '/api/admin/news', { featuredOnly: 'yes' })).status === 422, 'the setting must be true or false');
  await call('PATCH', '/api/admin/news', { featuredOnly: false });
  as(o1.jar);
  ok((await call('PATCH', '/api/admin/news', { featuredOnly: true })).status === 403 && (await call('GET', '/api/admin/news')).status === 403, 'owners cannot change the News settings');
  cookie = '';
  ok((await call('GET', '/api/admin/news')).status === 401, 'News settings need sign-in');
  as(adminJar);
  for (const slug of ['achkar-law', featSlug]) await call('PATCH', `/api/admin/firms/${slug}/feed`, { enabled: false });
  cookie = '';
  const emptyNews = await getRaw('/news');
  ok(emptyNews.status === 200 && emptyNews.text.includes('LawDB News is filling up'), 'with no blogs connected the page says it is filling up');

  // the court-decision explainers have their own page now
  const cd = await getRaw('/court-decisions');
  ok(cd.status === 200 && /<h1>Court Decisions Explained<\/h1>/.test(cd.text) && (cd.text.match(/href="\/court-decisions\/[^"]+"/g) || []).length === 12, 'the 12 court-decision articles are listed on their own page');
  ok(readFileSync(new URL('../court-decisions/scc-corbett-prior-convictions-2026.html', import.meta.url), 'utf8').includes('<a href="/court-decisions">Court Decisions</a>'), 'each article\'s breadcrumb leads back to that page');

  // menus: three items, one hub for firms, no duplicates
  const pageFile = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const navOf = (h) => (h.match(/<nav class="desktop-nav"[^>]*>(.*?)<\/nav>/s) || [])[1] || '';
  const drawerOf = (h) => (h.match(/<nav class="menu-drawer"[^>]*>(.*?)<\/nav>/s) || [])[1] || '';
  const labels = (h) => [...h.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
  for (const f of ['index.html', 'firms/torkin-manes-llp.html', 'ontario/toronto/family-lawyers.html', 'ontario/immigration-lawyers.html', 'for-firms.html']) {
    const h = pageFile(f);
    ok(isDeepStrictEqual(labels(navOf(h)), ['Find Your Lawyer', 'LawDB News', 'For Law Firms', 'Sign in', 'Request a Consultation']) && isDeepStrictEqual(labels(drawerOf(h)), ['Find Your Lawyer', 'LawDB News', 'For Law Firms', 'Sign in', 'Request a Consultation']), `${f}: the menu has three items, Sign in and the consultation button`);
    const firmsCol = (h.match(/<h4>For Law Firms<\/h4>\s*<ul>(.*?)<\/ul>/s) || [])[1] || '';
    ok(isDeepStrictEqual(labels(firmsCol), ['For Law Firms', 'List Your Firm (Free)', 'Get Featured', 'Manage Your Listing', 'Grow Your Practice']), `${f}: the footer's firms column has no repeats`);
    const clientsCol = (h.match(/<h4>For Clients<\/h4>\s*<ul>(.*?)<\/ul>/s) || [])[1] || '';
    ok(isDeepStrictEqual(labels(clientsCol), ['Find Your Lawyer', 'Browse by Case Type', 'LawDB News', 'Court Decisions Explained', 'Blog', 'How LawDB Works', 'Request a Consultation']), `${f}: the footer's clients column is complete`);
  }
  const hub = pageFile('for-firms.html');
  ok(['/list-your-firm"', '/list-your-firm?plan=featured"', '/account/"', '/grow-your-practice"'].every((l) => hub.slice(hub.indexOf('class="hub-grid"'), hub.indexOf('class="hub-grid"') + 2200).includes(l)), 'For Law Firms is the hub: list, Featured, manage, grow');
  ok(!/Advertise With Us|>Add Your Firm<\/a><a class="nav-cta"/.test(pageFile('index.html')), 'the old menu wording is gone');
  fixtureServer.close();
  // pictures: owners add a logo, cover and photos; everything is checked; admins can do it for any firm
  const base = '/api/account/firms/achkar-law/images';
  cookie = '';
  ok((await rawCall('POST', base + '?kind=logo', makePng(100, 100), 'image/png')).status === 401, 'uploading a picture needs sign-in');
  as(o2.jar);
  ok((await rawCall('POST', base + '?kind=logo', makePng(100, 100), 'image/png')).status === 403, 'another owner cannot upload pictures for this firm');
  as(o1.jar);
  const logo1 = await rawCall('POST', base + '?kind=logo', makePng(100, 100, 120), 'image/png');
  ok(logo1.status === 201 && /^\/img\/[0-9a-f]{24}$/.test(logo1.data.image.url), 'an owner uploads a logo');
  const got = await fetch(BASE + logo1.data.image.url);
  ok(got.status === 200 && got.headers.get('content-type') === 'image/png' && got.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(got.headers.get('content-security-policy') || ''), 'the picture is served with safe headers');
  ok(Buffer.from(await got.arrayBuffer()).equals(makePng(100, 100, 120)), 'the picture comes back byte for byte');
  const afterLogo = (await call('GET', '/api/firms/achkar-law')).data;
  ok(afterLogo.type === 'logo' && afterLogo.src === `img/${logo1.data.image.id}`, 'the logo is in the firm\'s public record');
  ok((await getRaw('/firms/achkar-law')).text.includes(`img/${logo1.data.image.id}`), 'the logo is on the firm\'s page');
  const logo2 = await rawCall('POST', base + '?kind=logo', makePng(120, 120, 80), 'image/png');
  ok(logo2.status === 201 && (await fetch(BASE + logo1.data.image.url)).status === 404, 'a new logo replaces the old one');
  ok((await call('GET', '/api/firms/achkar-law')).data.src === `img/${logo2.data.image.id}`, 'the public record points at the new logo');
  ok((await call('DELETE', `${base}/${logo2.data.image.id}`)).status === 200, 'the owner removes the logo');
  const reverted = (await call('GET', '/api/firms/achkar-law')).data;
  ok((reverted.src ?? null) === (origFirm.src ?? null) && reverted.type === origFirm.type, 'removing the logo restores what the firm had before');
  ok((await fetch(BASE + logo2.data.image.url)).status === 404, 'a removed picture is no longer served');

  // checks on what is uploaded
  const badUpload = async (bytes, type, kind = 'photo') => (await rawCall('POST', `${base}?kind=${kind}`, bytes, type)).status;
  ok((await badUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(60)), 'image/svg+xml')) === 415, 'SVG pictures are refused');
  ok((await badUpload(Buffer.from('GIF89a'.padEnd(64)), 'image/gif')) === 415, 'GIF is refused');
  ok((await badUpload(Buffer.from('this is just text, not a picture at all'), 'image/png')) === 415, 'a file claiming to be a PNG is checked by its content');
  ok((await badUpload(makePng(20, 20), 'image/png')) === 422, 'tiny pictures are refused');
  ok((await badUpload(makePng(9000, 9000), 'image/png')) === 422, 'enormous dimensions are refused');
  ok((await badUpload(Buffer.concat([makePng(100, 100), Buffer.alloc(3.2 * 1024 * 1024)]), 'image/png')) === 413, 'files over 3 MB are refused');
  ok((await rawCall('POST', `${base}?kind=banner`, makePng(100, 100), 'image/png')).status === 422, 'an unknown picture kind is refused');
  ok((await rawCall('POST', `${base}?kind=photo&alt=${encodeURIComponent('Visit www.spam-site.com')}`, makePng(100, 100), 'image/png')).status === 422, 'a link in a picture description is refused for owners');
  ok((await rawCall('POST', base + '?kind=logo', makePng(100, 100), 'image/png', { origin: 'https://evil.example' })).status === 403, 'cross-origin uploads are refused');
  ok((await fetch(BASE + '/img/not-an-id')).status === 404 && (await fetch(BASE + '/img/' + '0'.repeat(24))).status === 404, 'unknown pictures are 404');

  // cover and photos
  const cover = await rawCall('POST', base + '?kind=cover', makeJpeg(1200, 400), 'image/jpeg');
  ok(cover.status === 201, 'an owner uploads a cover picture (JPEG)');
  const coverPage = (await getRaw('/firms/achkar-law')).text;
  ok(coverPage.includes(`img/${cover.data.image.id}`) && coverPage.includes(`og:image" content="https://lawdb.ca/img/${cover.data.image.id}"`), 'the cover shows on the page and in its share preview');
  const photoIds = [];
  for (let i = 0; i < 6; i++) { const r = await rawCall('POST', `${base}?kind=photo&alt=${encodeURIComponent('Our office ' + i)}`, i % 2 ? makeWebp(800, 600) : makePng(200 + i, 150), i % 2 ? 'image/webp' : 'image/png'); if (r.status === 201) photoIds.push(r.data.image.id); }
  ok(photoIds.length === 6, 'an owner uploads six photos (PNG and WebP)');
  ok((await badUpload(makePng(100, 100), 'image/png')) === 409, 'a seventh photo is refused');
  const photoPage = (await getRaw('/firms/achkar-law')).text;
  ok(photoIds.every((id) => photoPage.includes(`/img/${id}`)) && photoPage.includes('alt="Our office 3"') && photoPage.includes('class="photo-grid"'), 'the photos show on the page with their descriptions');
  ok((await call('GET', base)).data.images.length === 7, 'the owner sees all their pictures');
  as(o2.jar);
  ok((await call('DELETE', `${base}/${photoIds[0]}`)).status === 403, 'another owner cannot remove these pictures');
  as(o1.jar);
  ok((await call('DELETE', `${base}/${photoIds[0]}`)).status === 200, 'the owner removes a photo');
  ok((await call('DELETE', `${base}/${photoIds[0]}`)).status === 404, 'removing it again is a 404');

  // an admin can manage any firm's pictures
  as(adminJar);
  const adminLogo = await rawCall('POST', '/api/admin/firms/torkin-manes-llp/images?kind=logo', makePng(100, 100, 50), 'image/png');
  ok(adminLogo.status === 201, 'an admin uploads a logo for any firm');
  ok((await call('GET', '/api/admin/firms/torkin-manes-llp/images')).data.images.length === 1, 'the admin lists a firm\'s pictures');
  ok((await call('DELETE', `/api/admin/firms/torkin-manes-llp/images/${adminLogo.data.image.id}`)).status === 200, 'the admin removes it');
  ok((await call('GET', '/api/admin/audit?limit=100')).data.entries.some((e) => e.action === 'image.add') , 'pictures are recorded in the activity log');
  for (const img of (await call('GET', '/api/admin/firms/achkar-law/images')).data.images) await call('DELETE', `/api/admin/firms/achkar-law/images/${img.id}`);
  ok((await call('GET', '/api/admin/firms/achkar-law/images')).data.images.length === 0, 'the admin cleared the test pictures');
  ok((await call('GET', '/api/firms/achkar-law')).data.heroImage === origFirm.heroImage || (origFirm.heroImage === undefined && (await call('GET', '/api/firms/achkar-law')).data.heroImage === undefined), 'removing the cover restores the firm\'s original');
  as(o1.jar);

  // Stripe: a signed payment makes a verified owner's firm Featured; the end of the subscription reverses it
  const WHSEC = process.env.SMOKE_STRIPE_SECRET || 'whsec_smoke_test_secret';
  const evId = () => 'evt_' + Math.random().toString(36).slice(2, 12);
  const mkEvent = (type, object, id = evId()) => ({ id, object: 'event', type, data: { object } });
  const stripePost = async (event, { secret = WHSEC, t = Math.floor(Date.now() / 1000), header, body = JSON.stringify(event) } = {}) => {
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const res = await fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': RUN_IP, ...(header === null ? {} : { 'stripe-signature': header ?? `t=${t},v1=${sig}` }) }, body });
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
  const checkout = (sub, { slug, email, mode = 'subscription', paid = 'paid', amount = 19900 } = {}) => mkEvent('checkout.session.completed', {
    id: 'cs_' + sub, mode, payment_status: paid, subscription: mode === 'subscription' ? sub : null, customer: 'cus_' + sub, amount_total: amount, currency: 'cad',
    client_reference_id: slug, customer_details: { email },
  });
  const subEvent = (type, sub, status, extra = {}) => mkEvent(type, { id: sub, customer: 'cus_' + sub, status, currency: 'cad', current_period_end: Math.floor(Date.now() / 1000) + 25 * 86400, cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 19900 }, quantity: 1 }] }, ...extra });
  const firmFeatured = async (slug) => (await call('GET', '/api/firms/' + slug)).data.featured;
  const planOf = async (jar, slug) => { as(jar); return call('GET', `/api/account/firms/${slug}/plan`); };
  const ownerEmail1 = `owner1-${run}@example.com`;
  const auditSubjects = async () => { as(adminJar); return (await call('GET', '/api/admin/audit?limit=200')).data.entries.filter((e) => e.action === 'mail.dev').map((e) => e.detail?.subject); };

  // the door is locked: only Stripe's signature gets in
  cookie = '';
  const goodEv = checkout('sub_x_' + run, { slug: 'achkar-law', email: ownerEmail1 });
  ok((await stripePost(goodEv, { header: null })).status === 400, 'a payment notice without a signature is refused');
  ok((await stripePost(goodEv, { secret: 'whsec_wrong' })).status === 400, 'a payment notice signed with the wrong secret is refused');
  ok((await stripePost(goodEv, { t: Math.floor(Date.now() / 1000) - 1000 })).status === 400, 'an old signed notice (replay) is refused');
  ok((await stripePost(goodEv, { body: JSON.stringify(goodEv) + ' ' , header: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` })).status === 400, 'a tampered notice is refused');
  ok((await stripePost(null, { body: 'not json' })).status === 400, 'a signed notice that is not JSON is refused');
  ok(!(await firmFeatured('achkar-law')), 'nothing became Featured from refused notices');

  // the owner's plan card
  as(o1.jar);
  const plan0 = (await call('GET', '/api/account/firms/achkar-law/plan')).data;
  const upUrl = new URL(plan0.upgradeUrl);
  ok(plan0.featured === false && plan0.price === '$199 / month' && upUrl.origin === 'https://buy.stripe.com' && upUrl.searchParams.get('client_reference_id') === 'achkar-law' && upUrl.searchParams.get('prefilled_email') === ownerEmail1 && plan0.portalUrl === null, 'a Basic firm\'s owner gets an upgrade link with the firm and email attached');
  as(o2.jar);
  ok((await call('GET', '/api/account/firms/achkar-law/plan')).status === 403, 'another owner cannot see this plan');
  cookie = '';
  ok((await call('GET', '/api/account/firms/achkar-law/plan')).status === 401, 'the plan needs sign-in');

  // a verified owner pays: Featured at once
  cookie = '';
  const subA = 'sub_a_' + run;
  const payA = checkout(subA, { slug: 'achkar-law', email: ownerEmail1.toUpperCase() });
  ok((await stripePost(payA)).status === 200 && await firmFeatured('achkar-law') === true, 'a verified owner\'s payment makes the firm Featured (email match ignores capitals)');
  ok((await stripePost(payA)).data.duplicate === true, 'the same notice delivered twice is applied once');
  ok(JSON.parse((await getRaw('/firms_data.json')).text).find((f) => f.slug === 'achkar-law').featured === true, 'the directory shows it as Featured');
  const planA = (await planOf(o1.jar, 'achkar-law')).data;
  ok(planA.featured && planA.subscription.status === 'active' && planA.upgradeUrl === null && /^https:\/\/billing\.stripe\.com/.test(planA.portalUrl), 'the owner now sees Featured and a manage-billing link');
  ok((await auditSubjects()).includes('Achkar Law is now Featured on LawDB'), 'the owner is emailed that they are Featured');
  cookie = '';
  ok((await stripePost(subEvent('customer.subscription.updated', subA, 'active', { cancel_at_period_end: true }))).status === 200, 'a renewal/cancel-at-period-end notice is accepted');
  const planB = (await planOf(o1.jar, 'achkar-law')).data;
  ok(planB.featured && planB.subscription.cancelAtPeriodEnd === true && !!planB.subscription.periodEnd, 'the plan card shows it will not renew, and until when');
  cookie = '';
  ok((await stripePost(subEvent('customer.subscription.updated', subA, 'past_due'))).status === 200 && await firmFeatured('achkar-law') === true, 'a failed card payment keeps the firm Featured while Stripe retries');
  ok((await planOf(o1.jar, 'achkar-law')).data.subscription.status === 'past_due', 'and the owner is told');
  ok((await auditSubjects()).includes('Payment problem for Achkar Law'), 'the owner and admin are emailed about the payment problem');
  cookie = '';
  ok((await stripePost(subEvent('customer.subscription.updated', subA, 'active'))).status === 200, 'the card works again');
  ok((await stripePost(subEvent('customer.subscription.deleted', subA, 'canceled'))).status === 200 && await firmFeatured('achkar-law') === false, 'when the subscription ends the firm goes back to Basic');
  ok((await planOf(o1.jar, 'achkar-law')).data.upgradeUrl !== null, 'and the owner can upgrade again');
  ok((await auditSubjects()).includes('Achkar Law: Featured listing ended'), 'the owner is emailed that it ended');

  // a payment we cannot match to an owner changes nothing and waits for the admin
  cookie = '';
  const subB = 'sub_b_' + run;
  ok((await stripePost(checkout(subB, { slug: 'achkar-law', email: `stranger-${run}@example.com` }))).status === 200 && await firmFeatured('achkar-law') === false, 'a payment from someone who is not the firm\'s owner changes nothing');
  as(adminJar);
  const pay1 = (await call('GET', '/api/admin/payments')).data;
  const waiting = pay1.needsReview.find((r) => r.id === subB);
  ok(waiting && waiting.slug === 'achkar-law' && waiting.payerEmail === `stranger-${run}@example.com` && waiting.owners.includes(ownerEmail1), 'the admin sees it with the payer and the firm\'s real owners');
  ok((await call('GET', '/api/admin/stats')).data.paymentsToReview >= 1, 'the overview counts payments to review');
  ok((await auditSubjects()).includes('A Featured payment needs your review'), 'the admin is emailed about it');
  ok((await call('POST', `/api/admin/payments/${subB}/assign`, { slug: 'no-such-firm' })).status === 422, 'assigning to an unknown firm is refused');
  ok((await call('POST', `/api/admin/payments/${subB}/assign`, { slug: 'achkar-law' })).status === 200 && await firmFeatured('achkar-law') === true, 'the admin approves it and the firm becomes Featured');
  ok((await call('POST', `/api/admin/payments/${subB}/assign`, { slug: 'achkar-law' })).status === 409, 'a payment cannot be assigned twice');
  const pay2 = (await call('GET', '/api/admin/payments')).data;
  ok(pay2.active.some((r) => r.id === subB) && pay2.totals.activeCount >= 1 && pay2.totals.monthlyCents >= 19900, 'the admin sees the subscription and the monthly total');
  cookie = '';
  await stripePost(subEvent('customer.subscription.deleted', subB, 'canceled'));
  ok(await firmFeatured('achkar-law') === false, 'cancelling it takes Featured away again');

  // a payment with no firm named, an out-of-order notice, and ones we ignore
  cookie = '';
  const subC = 'sub_c_' + run;
  await stripePost(checkout(subC, { slug: undefined, email: `nofirm-${run}@example.com` }));
  as(adminJar);
  ok((await call('GET', '/api/admin/payments')).data.needsReview.some((r) => r.id === subC && r.slug === null), 'a payment with no firm named waits for the admin');
  ok((await call('POST', `/api/admin/payments/${subC}/dismiss`)).status === 200 && (await call('POST', `/api/admin/payments/${subC}/dismiss`)).status === 409, 'the admin can dismiss it, once');
  cookie = '';
  const subD = 'sub_d_' + run;
  await stripePost(subEvent('customer.subscription.updated', subD, 'active')); // arrives before the checkout notice
  ok(await firmFeatured('achkar-law') === false, 'a subscription notice alone never makes anyone Featured');
  await stripePost(checkout(subD, { slug: 'achkar-law', email: ownerEmail1 }));
  ok(await firmFeatured('achkar-law') === true, 'notices arriving out of order still end up right');
  await stripePost(subEvent('customer.subscription.deleted', subD, 'canceled'));
  ok(await firmFeatured('achkar-law') === false, 'and cancelling works');
  const before = (await planOf(adminJar, 'achkar-law')).status; // admin is not an owner: 403 by design
  ok(before === 403, 'an admin who is not the firm\'s owner has no owner plan card');
  cookie = '';
  ok((await stripePost(checkout('sub_e_' + run, { slug: 'achkar-law', email: ownerEmail1, mode: 'payment' }))).status === 200 && await firmFeatured('achkar-law') === false, 'a one-off (non-subscription) payment is ignored');
  ok((await stripePost(checkout('sub_f_' + run, { slug: 'achkar-law', email: ownerEmail1, paid: 'unpaid' }))).status === 200 && await firmFeatured('achkar-law') === false, 'an unpaid checkout is ignored');
  ok((await stripePost(checkout('sub_g_' + run, { slug: '../../etc', email: ownerEmail1 }))).status === 200, 'a hostile firm name in a payment is harmless');
  ok((await stripePost(mkEvent('charge.refunded', { id: 'ch_1' }))).status === 200, 'events we do not use are acknowledged and ignored');

  // a firm that was already Featured by hand stays Featured when a subscription ends
  const manual = 'daniel-brown-law-llp';
  ok(await firmFeatured(manual) === true, 'the hand-featured firm starts Featured');
  const subH = 'sub_h_' + run;
  await stripePost(checkout(subH, { slug: undefined, email: `pays-${run}@example.com` }));
  as(adminJar);
  await call('POST', `/api/admin/payments/${subH}/assign`, { slug: manual });
  cookie = '';
  await stripePost(subEvent('customer.subscription.deleted', subH, 'canceled'));
  ok(await firmFeatured(manual) === true, 'a firm Featured by hand before it paid is never un-featured by a cancellation');
  as(adminJar);
  ok((await call('GET', '/api/admin/payments')).data.ended.some((r) => r.id === subH), 'the ended subscription is listed');
  as(o1.jar);
  ok((await call('GET', '/api/admin/payments')).status === 403, 'owners cannot see payments');
  cookie = '';
  ok((await call('GET', '/api/admin/payments')).status === 401, 'payments need sign-in');

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

  // an admin can undo an owner's edit from the activity log
  as(adminJar);
  const edits = (await call('GET', '/api/admin/audit?limit=200')).data.entries.filter((e) => e.action === 'firm.update' && e.entity_id === 'achkar-law' && e.actor_email === `owner1-${run}@example.com` && e.detail?.about);
  ok(edits.length >= 1, 'the owner\'s edit is in the activity log');
  const target = edits[edits.length - 1];
  const undone = await call('POST', `/api/admin/audit/${target.id}/revert`);
  ok(undone.status === 200 && undone.data.changed.includes('about'), 'the admin undoes the owner\'s edit');
  ok((await call('GET', '/api/admin/firms/achkar-law')).data.firm.about === (target.detail.about.from || ''), 'the earlier text is back');
  ok((await call('POST', '/api/admin/audit/999999/revert')).status === 404, 'undoing an unknown entry is refused');

  // ownership signal for the admin
  ok(emailMatch('lawyer@torkinmanes.com', 'https://www.torkinmanes.com') === 'match', 'email on the firm\'s domain is a match');
  ok(emailMatch('lawyer@mail.torkinmanes.com', 'https://torkinmanes.com/x') === 'match', 'a subdomain of the firm\'s domain is a match');
  ok(emailMatch('someone@gmail.com', 'https://torkinmanes.com') === 'free', 'a free email address proves nothing');
  ok(emailMatch('rival@otherfirm.ca', 'https://torkinmanes.com') === 'mismatch', 'an email on another domain is flagged');
  ok(emailMatch('a@firm.ca', '') === 'nosite', 'no website on file cannot be checked');

  // content rules (unit): normal wording passes, risky wording does not
  const blocked = (t) => { try { checkOwnerText('Text', t); return false; } catch { return true; } };
  ok(!blocked('We practise family law and help Ottawa families.') && !blocked('The best of care for every client.'), 'ordinary wording is allowed');
  ok(blocked('#1 firm') && blocked('Top-rated lawyers') && blocked('Our specialist team') && blocked('visit smith.law today') && blocked('<a href="x">x</a>'), 'risky wording is blocked');

  // reporting a listing
  cookie = '';
  const rp = await getRaw('/report-listing?firm=achkar-law');
  ok(rp.status === 200 && rp.text.includes('Report: Achkar Law') && rp.text.includes('value="achkar-law"'), 'the report page names the firm');
  ok(rp.text.indexOf('id="rp-out"') > rp.text.indexOf('</form>'), 'the report page\'s thank-you message is outside the form it hides');
  ok((await getRaw('/report-listing?firm=nope')).text.includes('Report a listing'), 'the report page works for an unknown firm');
  ok((await getRaw('/firms/achkar-law')).text.includes('/report-listing?firm=achkar-law'), 'profile pages link to the report page');
  const rep = await call('POST', '/api/leads', { name: 'Reporter', email: `reporter-${run}@example.com`, form: 'report-listing', reportedFirm: 'achkar-law', reason: 'inaccurate', message: 'The phone number is wrong' });
  ok(rep.status === 201, 'a visitor reports a listing');
  as(adminJar);
  const repLeads = (await call('GET', '/api/admin/leads?limit=50')).data.leads;
  ok(repLeads.some((l) => l.form === 'report-listing' && l.payload.reportedFirm === 'achkar-law'), 'the report reaches the admin as a lead');
  ok((await call('GET', '/api/admin/audit?limit=200')).data.entries.some((e) => e.action === 'mail.dev' && /^Listing reported/.test(e.detail?.subject || '')), 'the admin is emailed about a report');
  ok((await call('GET', '/api/admin/stats')).data.openReports >= 1, 'the overview counts open reports');
  as(o1.jar);
  ok(!(await call('GET', '/api/account/firms/achkar-law/leads')).data?.leads?.some((l) => l.email === `reporter-${run}@example.com`), 'a report is never shown to the firm it is about');

  // enquiry flood limit per requester address (the 16th within an hour is refused)
  cookie = '';
  const floodIp = { 'cf-connecting-ip': `198.18.0.${1 + Math.floor(Math.random() * 250)}` };
  const codes = [];
  for (let i = 0; i < 16; i++) codes.push((await call('POST', '/api/leads', { name: 'Bot', email: `bot${i}-${run}@example.com`, message: 'hello' }, floodIp)).status);
  ok(codes.slice(0, 15).every((c) => c === 201) && codes[15] === 429, 'a requester address is limited to 15 enquiries an hour');

  // sign out everywhere, and disabling a person
  const o3email = `owner3-${run}@example.com`;
  const s1 = await signUp(o3email), s2 = await signUp(o3email);
  ok(s1 && s2 && s1.jar !== s2.jar, 'the same person can be signed in on two devices');
  as(s1.jar);
  ok((await call('GET', '/api/account/me')).status === 200, 'the first device is signed in');
  ok((await call('POST', '/api/auth/logout-all')).status === 200, 'sign out everywhere');
  as(s1.jar);
  ok((await call('GET', '/api/account/me')).status === 401, 'the first device is signed out');
  as(s2.jar);
  ok((await call('GET', '/api/account/me')).status === 401, 'the second device is signed out too');
  const o4email = `owner4-${run}@example.com`;
  const d1 = await signUp(o4email);
  as(adminJar);
  const person = (await call('GET', `/api/admin/users?q=${encodeURIComponent(o4email)}`)).data.users[0];
  ok(person && person.email === o4email && person.disabled === false, 'the admin finds the person');
  ok((await call('PATCH', `/api/admin/users/${person.id}`, { disabled: true })).status === 200, 'the admin disables the person');
  as(d1.jar);
  ok((await call('GET', '/api/account/me')).status === 401, 'a disabled person is signed out at once');
  ok((await signUp(o4email)) === null, 'a disabled person cannot sign in again');
  as(adminJar);
  ok((await call('PATCH', `/api/admin/users/${person.id}`, { disabled: false })).status === 200, 'the admin can enable them again');
  ok((await call('PATCH', '/api/admin/users/1', { disabled: 'yes' })).status === 422, 'disable needs true or false');
  ok((await signUp(o4email)) !== null, 'an enabled person signs in again');
  as(o1.jar);
  ok((await call('GET', '/api/admin/users')).status === 403, 'owners cannot list people');
  ok((await call('POST', '/api/admin/backup')).status === 403, 'owners cannot run backups');

  // backups and nightly housekeeping
  as(adminJar);
  const bk = await call('POST', '/api/admin/backup');
  ok(bk.status === 200 && bk.data.rows.firms >= 370 && bk.data.rows.users >= 1 && 'firm_images' in bk.data.rows, 'the admin can back up now (picture records included)');
  ok(!!(await call('GET', '/api/admin/stats')).data.lastBackupAt, 'the overview shows when the last backup ran');
  cookie = '';
  const cron = await fetch(BASE + '/__scheduled?cron=17+7+*+*+*', { signal: AbortSignal.timeout(30000) });
  ok(cron.status === 200, 'the nightly job can be triggered');
  as(adminJar);
  let nightlyDone = false;
  for (let i = 0; i < 20 && !nightlyDone; i++) {
    const acts = (await call('GET', '/api/admin/audit?limit=30')).data.entries.map((e) => e.action);
    nightlyDone = acts.includes('housekeeping.ok') && acts.includes('backup.ok');
    if (!nightlyDone) await new Promise((r) => setTimeout(r, 500));
  }
  ok(nightlyDone, 'the nightly job ran housekeeping and a backup without errors');

  // Google Search Console: the site submits the sitemap and asks Google about pages (against a fake Google on this computer)
  const devVars = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : '';
  const pubB64 = /GSC_TEST_PUBLIC_KEY_B64=(\S+)/.exec(devVars)?.[1];
  if (!pubB64) console.log('SKIP  Search Console checks (run node scripts/gen-test-gsc.mjs first)');
  else {
    const pub = createPublicKey(Buffer.from(pubB64, 'base64').toString());
    const g = { tokens: 0, jwtOk: null, sitemapPuts: [], inspected: [], mode: 'ok', auth: [] };
    const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const google = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.url === '/token') {
          const jwt = new URLSearchParams(raw).get('assertion') || '';
          const [h64, c64, sig] = jwt.split('.');
          try {
            const head = JSON.parse(Buffer.from(h64, 'base64url')); const claims = JSON.parse(Buffer.from(c64, 'base64url'));
            const v = createVerify('RSA-SHA256'); v.update(`${h64}.${c64}`);
            g.jwtOk = head.alg === 'RS256' && claims.iss === 'lawdb-search@smoke-test.iam.gserviceaccount.com' && claims.scope === 'https://www.googleapis.com/auth/webmasters' && claims.aud === 'http://127.0.0.1:8798/token' && claims.exp - claims.iat === 3600 && v.verify(pub, Buffer.from(sig, 'base64url')) && new URLSearchParams(raw).get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer';
          } catch { g.jwtOk = false; }
          if (!g.jwtOk) return json(res, 400, { error: 'invalid_grant' });
          g.tokens++;
          return json(res, 200, { access_token: 'tok-123', expires_in: 3600 });
        }
        g.auth.push(req.headers.authorization);
        if (req.headers.authorization !== 'Bearer tok-123') return json(res, 401, { error: { message: 'no token' } });
        if (req.method === 'GET' && req.url === '/webmasters/v3/sites') return json(res, 200, { siteEntry: [{ siteUrl: 'https://other.example/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:lawdb.ca', permissionLevel: 'siteOwner' }] });
        const sm = /^\/webmasters\/v3\/sites\/([^/]+)\/sitemaps\/([^/]+)$/.exec(req.url);
        if (sm && req.method === 'PUT') { g.sitemapPuts.push([decodeURIComponent(sm[1]), decodeURIComponent(sm[2])]); res.writeHead(204); return res.end(); }
        if (sm && req.method === 'GET') return json(res, 200, { lastSubmitted: '2026-10-14T07:37:00Z', lastDownloaded: '2026-10-14T07:38:00Z', isPending: false, errors: '0', warnings: '2', contents: [{ type: 'web', submitted: '610', indexed: '0' }] });
        if (req.method === 'POST' && req.url === '/v1/urlInspection/index:inspect') {
          const body = JSON.parse(raw);
          g.inspected.push(body);
          if (g.mode === 'forbidden') return json(res, 403, { error: { message: 'User does not have sufficient permission' } });
          const u = body.inspectionUrl;
          const result = /find-lawyers/.test(u) ? { verdict: 'PASS', coverageState: 'Submitted and indexed', indexingState: 'INDEXING_ALLOWED', lastCrawlTime: '2026-10-10T12:00:00Z', googleCanonical: u }
            : /achkar/.test(u) ? { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' }
            : { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' };
          return json(res, 200, { inspectionResult: { indexStatusResult: result } });
        }
        json(res, 404, { error: { message: 'nope' } });
      });
    });
    await new Promise((r, rej) => { google.once('error', rej); google.listen(8798, '127.0.0.1', r); });

    cookie = '';
    ok((await call('GET', '/api/admin/search')).status === 401 && (await call('POST', '/api/admin/search/run', {})).status === 401, 'Search Console tools need an admin sign-in');
    as(o1.jar);
    ok((await call('GET', '/api/admin/search')).status === 403 && (await call('POST', '/api/admin/search/run', {})).status === 403 && (await call('POST', '/api/admin/search/inspect', { url: '/' })).status === 403, 'owners cannot use the Search Console tools');
    as(adminJar);
    const before = (await call('GET', '/api/admin/search')).data;
    ok(before.connected === true && before.clientEmail === 'lawdb-search@smoke-test.iam.gserviceaccount.com' && before.pagesChecked === 0 && before.sitemapPages > 500, 'the admin sees that Google is connected and how many pages the sitemap lists');
    ok(!JSON.stringify(before).includes('PRIVATE KEY'), 'the key never appears in an API reply');

    const run1 = await call('POST', '/api/admin/search/run', { part: 'all' });
    ok(run1.status === 200 && run1.data.ok === true && run1.data.inspect.checked === 40 && run1.data.inspect.failed === 0, 'a run sends the sitemap and checks 40 pages');
    ok(g.jwtOk === true && g.tokens === 1, 'the sign-in request to Google is a correctly signed token request');
    ok(g.sitemapPuts.length === 2 && g.sitemapPuts[1][1] === 'https://lawdb.ca/sitemap-news.xml' && g.sitemapPuts[0][0] === 'sc-domain:lawdb.ca' && g.sitemapPuts[0][1] === 'https://lawdb.ca/sitemap.xml', 'the sitemap is submitted for the right property (found automatically)');
    ok(g.auth.every((a) => a === 'Bearer tok-123') && g.inspected.every((b) => b.siteUrl === 'sc-domain:lawdb.ca' && /^https:\/\/lawdb\.ca\//.test(b.inspectionUrl)), 'every call carries the token and names lawdb.ca pages');
    const first = g.inspected.map((b) => b.inspectionUrl);
    ok(['/', '/find-lawyers', '/news', '/for-firms'].every((p) => first.includes('https://lawdb.ca' + p)) && new Set(first).size === 40, 'the key pages are always checked, with no repeats');
    const sum1 = run1.data.summary;
    ok(sum1.pagesChecked === 40 && sum1.onGoogle === 1 && sum1.states.some((s) => s.state === 'Submitted and indexed' && s.n === 1) && sum1.notOnGoogle === 39 && sum1.problems.length === 25 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(sum1.sitemap.at) && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(sum1.sitemap.lastDownloaded) && sum1.sitemap.warnings === 2 && sum1.sitemap.submitted === 610, 'the answers are stored and summarised: what is on Google, what is not, and the sitemap status');
    g.inspected.length = 0;
    const run2 = await call('POST', '/api/admin/search/run', { part: 'inspect' });
    const second = g.inspected.map((b) => b.inspectionUrl).filter((u) => !['/', '/find-lawyers', '/news', '/for-firms'].includes(new URL(u).pathname));
    ok(run2.data.ok && second.length === 36 && !second.some((u) => first.includes(u)), 'the next run moves on to different pages');
    ok(run2.data.summary.pagesChecked === 76 && g.sitemapPuts.length === 2, 'pages build up over runs; an inspect-only run does not resend the sitemap');
    ok((await call('POST', '/api/admin/search/run', { part: 'nonsense' })).status === 422, 'an unknown part is refused');

    const one = await call('POST', '/api/admin/search/inspect', { url: '/find-lawyers' });
    ok(one.status === 200 && one.data.page.verdict === 'PASS' && one.data.page.url === 'https://lawdb.ca/find-lawyers' && one.data.page.lastCrawlAt === '2026-10-10 12:00:00', 'one page can be checked on its own');
    ok((await call('POST', '/api/admin/search/inspect', { url: 'https://evil.example/x' })).status === 422 && (await call('POST', '/api/admin/search/inspect', { url: 'javascript:alert(1)' })).status === 422, 'only lawdb.ca pages can be checked');

    // Google refuses (the service account was not added in Search Console): one clear message, and it stops at once
    g.mode = 'forbidden'; g.inspected.length = 0;
    const bad = await call('POST', '/api/admin/search/run', { part: 'inspect' });
    ok(bad.status === 200 && bad.data.ok === false && /403/.test(bad.data.error) && /added as a user/.test(bad.data.error) && g.inspected.length <= 5, 'a refusal is explained and the run stops within the first few pages');
    ok((await call('GET', '/api/admin/search')).data.lastRun.ok === false, 'the admin screen shows the last run failed');
    g.mode = 'ok';

    // the nightly Search Console cron
    cookie = '';
    const cron2 = await fetch(BASE + '/__scheduled?cron=37+7+*+*+*', { signal: AbortSignal.timeout(60000) });
    ok(cron2.status === 200, 'the Search Console cron can be triggered');
    as(adminJar);
    let searchDone = false;
    for (let i = 0; i < 40 && !searchDone; i++) {
      searchDone = (await call('GET', '/api/admin/audit?limit=10')).data.entries.some((e) => e.action === 'search.ok');
      if (!searchDone) await new Promise((r) => setTimeout(r, 500));
    }
    ok(searchDone && g.sitemapPuts.length === 4, 'the nightly run sent the sitemap and recorded success');
    google.close();
  }

  // following firms, saving stories, and the feed
  {
    const F = 'daniel-brown-law-llp';
    cookie = '';
    const anon = await call('GET', `/api/social/status?slugs=${F},torys-llp&posts=1`);
    ok(anon.status === 200 && anon.data.signedIn === false && anon.data.follows[F].following === false && anon.data.follows[F].followers === 0, 'anyone can see follower counts; the status says nobody is signed in');
    ok((await call('POST', '/api/account/follow', { slug: F })).status === 401 && (await call('GET', '/api/account/feed')).status === 401 && (await call('GET', '/api/account/following')).status === 401 && (await call('POST', '/api/account/saved', { postId: 1 })).status === 401, 'following, the feed and saving need sign-in');
    as(adminJar);
    await call('PATCH', `/api/admin/firms/${F}/feed`, { enabled: true });
    as(o1.jar);
    const f1 = await call('POST', '/api/account/follow', { slug: F });
    ok(f1.status === 200 && f1.data.following === true && f1.data.followers === 1, 'a signed-in person can follow a firm');
    ok((await call('POST', '/api/account/follow', { slug: F })).data.followers === 1, 'following twice counts once');
    ok((await call('POST', '/api/account/follow', { slug: 'no-such-firm' })).status === 404 && (await call('POST', '/api/account/follow', { slug: '../x' })).status === 422 && (await call('POST', '/api/account/follow', {})).status === 422, 'unknown firms and odd names are refused');
    as(o2.jar);
    ok((await call('POST', '/api/account/follow', { slug: 'torys-llp' })).data.followers === 1 && (await call('POST', '/api/account/follow', { slug: F })).data.followers === 2, 'a second person follows too and the count goes up');
    ok((await call('GET', '/api/account/following')).data.firms.map((f) => f.slug).sort().join() === `${F},torys-llp`.split(',').sort().join(), 'each person sees their own follows');
    as(o1.jar);
    ok(isDeepStrictEqual((await call('GET', '/api/account/following')).data.firms.map((f) => f.slug), [F]), 'and not other people\'s');
    const st = await call('GET', `/api/social/status?slugs=${F},torys-llp`);
    ok(st.data.signedIn && st.data.follows[F].following && st.data.follows[F].followers === 2 && st.data.follows['torys-llp'].following === false && st.data.follows['torys-llp'].followers === 1, 'the buttons know who follows what, and the totals');
    const fd = await call('GET', '/api/account/feed');
    ok(fd.status === 200 && fd.data.stories.length >= 3 && fd.data.stories.every((x) => x.firm.slug === F && new RegExp(`^/news/${F}/[a-z0-9-]+-\\d+$`).test(x.href)), 'the feed holds the followed firm\'s stories, each with its own page address');
    const sid = fd.data.stories[0].id;
    ok((await call('POST', '/api/account/saved', { postId: sid })).data.saved === true && (await call('POST', '/api/account/saved', { postId: sid })).status === 200, 'a story can be saved (saving twice is fine)');
    ok((await call('GET', '/api/account/saved')).data.stories.some((x) => x.id === sid && x.saved) && (await call('GET', '/api/account/feed')).data.stories.find((x) => x.id === sid).saved === true && (await call('GET', `/api/social/status?posts=${sid}`)).data.saved[sid] === true, 'saved stories are listed and marked everywhere');
    as(o2.jar);
    ok((await call('GET', '/api/account/saved')).data.stories.length === 0, 'saved stories are private');
    as(o1.jar);
    ok((await call('POST', '/api/account/saved', { postId: 99999999 })).status === 404 && (await call('POST', '/api/account/saved', { postId: 'x' })).status === 422, 'unknown stories and odd input are refused');
    ok((await call('DELETE', `/api/account/saved/${sid}`)).data.saved === false && (await call('GET', '/api/account/saved')).data.stories.length === 0, 'a saved story can be removed');
    ok((await call('DELETE', `/api/account/follow/${F}`)).data.followers === 1 && (await call('GET', '/api/account/feed')).data.stories.length === 0, 'unfollowing lowers the count and empties the feed');
    ok((await call('POST', '/api/account/follow', { slug: F }, { origin: 'https://evil.example' })).status === 403, 'follow actions from other sites are refused');
    cookie = '';
    const fp = (await getRaw('/firms/torys-llp')).text;
    ok(fp.includes('data-follow="torys-llp"') && fp.includes('<script src="/follow.js" defer></script>'), 'a hand-built firm page carries the Follow button');
    as(adminJar);
    await call('PATCH', '/api/admin/firms/achkar-law', { pageMode: 'dynamic' });
    cookie = '';
    const dp = await getRaw('/firms/achkar-law');
    ok(dp.headers.get('x-lawdb-source') === 'database' && dp.text.includes('data-follow="achkar-law"') && dp.text.includes('/follow.js'), 'a database-built firm page carries it too');
    as(adminJar);
    await call('PATCH', '/api/admin/firms/achkar-law', { pageMode: 'static' });
    cookie = '';
    const jsf = await getRaw('/follow.js');
    ok(jsf.status === 200 && /javascript/.test(jsf.headers.get('content-type') || '') && !/eval\(|document\.write|innerHTML/.test(jsf.text), 'the Follow script is plain and never builds markup from data');
    const nw = (await getRaw('/news')).text;
    ok(nw.includes(`data-follow="${F}"`) && /data-save="\d+"/.test(nw) && nw.includes('/follow.js'), 'LawDB News cards carry Follow and Save');
    const sp = (await getRaw(fd.data.stories[0].href)).text;
    ok(sp.includes(`data-follow="${F}"`) && sp.includes(`data-save="${sid}"`), 'story pages carry Follow and Save');
    // limits: a new person cannot follow endlessly
    const robot = await signUp(`social-${run}@example.com`, `203.0.113.${1 + Math.floor(Math.random() * 250)}`);
    as(adminJar);
    const many = (await call('GET', '/api/admin/firms?limit=100')).data.firms.map((x) => x.slug).filter((x) => x !== F).slice(0, 62);
    as(robot.jar);
    let okCount = 0; let limited = 0;
    for (const slug of many) { const r = await call('POST', '/api/account/follow', { slug }); if (r.status === 200) okCount++; else if (r.status === 429) limited++; }
    ok(okCount === 60 && limited === many.length - 60, 'following is limited to 60 new firms an hour per person');
  }

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
