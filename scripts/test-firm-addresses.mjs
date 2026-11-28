// The addresses of firm and lawyer pages:  node --no-warnings scripts/test-firm-addresses.mjs
//   a firm is lawdb.ca/<handle> (letters and digits, no dashes, nothing in front, like lawdb.ai/aanjlaw), its Lawyers and Articles pages /<handle>/lawyers and /<handle>/articles,
//   a Featured lawyer's own page lawdb.ca/<name>, the old /firms/<slug> goes there with a 301, and no city is ever added to an address. Runs against a real in-memory SQLite
//   database built from the migrations (the same SQL as the Worker's D1).
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { candidateHandle, assignHandles, loadHandles } from './lib/firm-handles.mjs';
import { firmPath, uniqueHandleFor, currentAddress, firmByToken, isFree, couldBeFirm, RESERVED } from '../src/lib/firm-handle.js';
import { lawyerDirectory } from '../src/lib/lawyer-address.js';
import { firmPage } from '../src/routes/firm-page.js';
import { firmSitemap } from '../src/routes/firm-sitemap.js';
import { withFirmSlug } from '../src/routes/stats.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the rule: the slug without its city and without dashes, never a city on the end
ok(candidateHandle('lawpoint-north-york', 'North York') === 'lawpoint' && candidateHandle('aitken-robertson-kingston', 'Kingston') === 'aitkenrobertson' && candidateHandle('fasken', 'Toronto') === 'fasken', 'the city is taken off the end of a slug and the dashes go: lawdb.ca/aitkenrobertson');
ok(candidateHandle('grillo-law-personal-injury-lawyers-north-york', 'Toronto') === 'grillolawpersonalinjurylawyers', 'a firm that moved to another city loses its old place name too (Grillo Law)');
ok(candidateHandle('ab-toronto', 'Toronto') === 'abtoronto' && candidateHandle('a-circelli-law-guelph', 'Guelph') === 'acircellilaw', 'a handle never gets shorter than three characters');
const firms = [
  { slug: 'stikeman-elliott-llp', city: 'Toronto', count: 39 }, { slug: 'stikeman-elliott-llp-calgary', city: 'Calgary', count: 80 },
  { slug: 'smith-law-toronto', city: 'Toronto', count: 10 }, { slug: 'smith-law-calgary', city: 'Calgary', count: 90 }, { slug: 'smith-law-halifax', city: 'Halifax', count: 5 },
  { slug: 'news-toronto', city: 'Toronto', count: 5 },
];
const given = assignHandles(firms);
ok(given['stikeman-elliott-llp'] === 'stikemanelliottllp' && given['stikeman-elliott-llp-calgary'] === 'stikemanelliottllp2', 'the firm whose slug is already the handle keeps it; its other office gets a 2 on the end, not "calgary" and not a dash');
ok(given['smith-law-calgary'] === 'smithlaw' && given['smith-law-toronto'] === 'smithlaw2' && given['smith-law-halifax'] === 'smithlaw3', 'two firms with one name: more Google reviews first, then 2, 3');
ok(given['news-toronto'] === 'news2' && isFree('news2') && !isFree('news') && !isFree('contact') && !isFree('ontario') && !isFree('ab') && !isFree('has-dash') && !isFree('x'.repeat(61)), 'a word the site uses (news, contact, ontario...) is never a handle: the firm gets news2');
ok(eq(assignHandles(firms, given), {}) && assignHandles([{ slug: 'new-firm-ottawa', city: 'Ottawa' }], given)['new-firm-ottawa'] === 'newfirm', 'a handle already given never changes; a new firm gets one');

// ---- the site's own words: every page, folder and route the site answers is reserved, so no firm can ever take its address
const root = readdirSync('.', { withFileTypes: true }).filter((d) => !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => d.name.replace(/\.[a-z0-9]+$/, ''));
const notReserved = root.filter((n) => !RESERVED.has(n.toLowerCase()));
ok(notReserved.length === 0, `every page, file and folder in the site's folder is a reserved word${notReserved.length ? ` (missing: ${notReserved.join(', ')})` : ` (${root.length} checked)`}`);
const worker = readFileSync('src/worker.js', 'utf8');
const firstWords = [...new Set([...worker.matchAll(/(?:'|")\/([a-z][a-z0-9_-]*)(?:[/'"])/g)].map((m) => m[1]))].filter((w) => !w.includes('_') || RESERVED.has(w));
const missingRoutes = firstWords.filter((w) => !RESERVED.has(w) && !/^(?:feed|health)$/.test(w));
ok(missingRoutes.length === 0, `every first part of an address in the Worker's routes is reserved${missingRoutes.length ? ` (missing: ${missingRoutes.join(', ')})` : ''}`);

// ---- the real list
const all = loadHandles();
const renamed = JSON.parse(readFileSync('data/firm-renames.json', 'utf8')); // a firm renamed in the live database: its old slug is an alias of the new one's handle
const slugs = Object.keys(all), values = Object.entries(all).filter(([slug]) => !renamed[slug]).map(([, h]) => h);
ok(slugs.length > 1800 && new Set(values).size === values.length && values.every(isFree), `${slugs.length} firms have a handle; every handle is unique, letters and digits only, and not a word the site uses`);
ok(values.every((h) => !h.includes('-')) && all.lawpoint === 'lawpoint' && all['lawpoint-north-york'] === 'lawpoint' && all['grillo-law-personal-injury-lawyers-north-york'] === 'grillolawpersonalinjurylawyers', 'no dashes anywhere: lawdb.ca/lawpoint, lawdb.ca/grillolawpersonalinjurylawyers');
ok(slugs.filter((s) => all[s] !== s.replace(/-/g, '')).length > 1400, 'about 1,500 firms lost the city that was on the end of their slug');

// ---- a database like the Worker's, built from the migrations
const db = new DatabaseSync(':memory:');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
const d1 = { prepare(sql) { const st = db.prepare(sql); let args = []; const o = { bind(...a) { args = a; return o; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { st.run(...args); return {}; } }; return o; } };
globalThis.caches = { default: { async match() { return undefined; }, async put() {}, async delete() { return true; } } };
globalThis.HTMLRewriter = class { on() { return this; } transform(res) { return res; } };
const ABOUT = 'Plain words about the firm and what it does for people. '.repeat(8);
const lawyers = (names) => names.map((n, i) => ({ name: n, slug: n.toLowerCase().replace(/[^a-z]+/g, '-'), title: 'Partner', callYear: 2000 + i, confirmed: true, featured: true }));
const put = (slug, { handle = null, name = slug, city = 'Toronto', featured = 0, status = 'live', lw = [] } = {}) => {
  const data = { slug, name, city, province: 'ON', featured: !!featured, caseTypes: ['family'], phone: '+14165551234', address: '1 Main St, Toronto, ON', ...(handle ? { handle } : {}), ...(lw.length ? { lawyers: lw } : {}) };
  db.prepare('INSERT INTO firms (slug, name, city, province, region, featured, data, about, status, handle) VALUES (?,?,?,?,?,?,?,?,?,?)').run(slug, name, city, 'ON', 'toronto', featured, JSON.stringify(data), ABOUT, status, handle);
};
put('aitken-robertson-kingston', { handle: 'aitkenrobertson', name: 'Aitken Robertson', city: 'Kingston' });
put('aitken-robertson-peterborough', { handle: 'aitkenrobertson2', name: 'Aitken Robertson', city: 'Peterborough' });
put('lawpoint', { handle: 'lawpoint', name: 'Lawpoint', city: 'North York' });
put('no-handle-yet', { name: 'No Handle Yet' });
put('hidden-firm-toronto', { handle: 'hiddenfirm', status: 'hidden' });
put('big-firm-toronto', { handle: 'bigfirm', name: 'Big Firm', featured: 1, lw: lawyers(['Ann Lee', 'Bo Chan', 'Cy Diaz']) });
put('other-firm-calgary', { handle: 'otherfirm', name: 'Other Firm', city: 'Calgary', featured: 1, lw: lawyers(['Ann Lee', 'Dee Evans', 'Contact Smith']) });
put('annlee-law', { handle: 'annlee', name: 'Ann Lee', city: 'Ottawa' }); // a firm that already has the address a lawyer's page would take
db.prepare("INSERT INTO firm_redirects (old_slug, new_slug) VALUES ('lawpoint-north-york', 'lawpoint')").run();
const env = { DB: d1, PUBLIC_CACHE_TTL: '0', SITE_ORIGIN: 'https://lawdb.ca', ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
const ctx = { waitUntil() {} };
const get = (path) => firmPage({ request: new Request(`https://lawdb.ca${path}`), env, ctx });
const moved = async (path) => { const r = await get(path); return [r.status, r.headers.get('location')]; };
const canon = (html) => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];

// the address helpers
ok(firmPath({ slug: 'a-b', handle: 'ab' }) === '/ab' && firmPath({ slug: 'a-b' }) === '/a-b' && firmPath({ slug: 'a-b', handle: 'ab' }, 'lawyers') === '/ab/lawyers', 'firmPath: /<handle>, /<slug> when there is no handle yet, and a tab');
ok(couldBeFirm('lawpoint') && !couldBeFirm('news') && !couldBeFirm('find-lawyers') && !couldBeFirm('ontario') && !couldBeFirm('a') && !couldBeFirm('has.dot'), 'the Worker never takes the site\'s own words, or something that is not an address, for a firm');
ok((await firmByToken(env, 'aitkenrobertson')).slug === 'aitken-robertson-kingston' && (await firmByToken(env, 'aitkenrobertson2')).slug === 'aitken-robertson-peterborough' && (await firmByToken(env, 'no-handle-yet')).slug === 'no-handle-yet' && !(await firmByToken(env, 'aitken-robertson-kingston')), 'a handle finds its firm; a slug finds only a firm that has no handle yet');
ok((await uniqueHandleFor(env, 'brand-new-ottawa', 'Ottawa')) === 'brandnew' && (await uniqueHandleFor(env, 'aitken-robertson-ottawa', 'Ottawa')) === 'aitkenrobertson3' && (await uniqueHandleFor(env, 'news-ottawa', 'Ottawa')) === 'news2' && (await uniqueHandleFor(env, 'lawpoint-north-york', 'North York')) === 'lawpoint2', 'a firm that lists itself gets a handle without its city and dashes, numbered when taken, never a word the site uses');
const cur = await currentAddress(env, 'lawpoint-north-york');
ok(cur && cur.slug === 'lawpoint' && cur.handle === 'lawpoint' && (await currentAddress(env, 'aitken-robertson-kingston')).handle === 'aitkenrobertson' && (await currentAddress(env, 'nobody')) === null, 'an old slug (even one renamed before) leads to the firm\'s handle in one step');

// the pages
const page = await get('/aitkenrobertson');
const html = await page.text();
ok(page.status === 200 && canon(html) === 'https://lawdb.ca/aitkenrobertson' && html.includes('<meta property="og:url" content="https://lawdb.ca/aitkenrobertson">'), 'lawdb.ca/<handle> is the page, its own canonical and og:url');
const second = await (await get('/aitkenrobertson2')).text();
ok(second.includes('Peterborough') && canon(second) === 'https://lawdb.ca/aitkenrobertson2', 'the other office of the same firm has its own address (a 2, no city, no dash)');
const nh = await get('/no-handle-yet');
ok(nh.status === 200 && canon(await nh.text()) === 'https://lawdb.ca/no-handle-yet', 'a firm that has no handle yet is at /<slug>');
ok(eq(await moved('/aitken-robertson-kingston'), [301, '/aitkenrobertson']) && eq(await moved('/lawpoint-north-york'), [301, '/lawpoint']), 'the slug of a firm that has a handle, or an address it used to have, goes to /<handle> (301), so it is never a second page');
ok((await get('/hiddenfirm')).status === 404 && (await get('/nobodyhere')).status === 404, 'a firm switched off, or one that does not exist, has no page');
ok(eq(await moved('/aitkenrobertson/'), [301, '/aitkenrobertson']), 'a trailing slash goes to the one address');
const seen = []; env.ASSETS.fetch = async (r) => { seen.push(new URL(r.url).pathname); return new Response('x', { status: 404 }); };
await get('/news'); await get('/find-lawyers'); await get('/ontario');
ok(seen.length === 3 && seen.every((p) => ['/news', '/find-lawyers', '/ontario'].includes(p)), 'the site\'s own addresses are never looked up as firms');
env.ASSETS.fetch = async () => new Response('not found', { status: 404 });

// the old addresses
ok(eq(await moved('/firms/aitken-robertson-kingston'), [301, '/aitkenrobertson']), '/firms/<slug> goes to /<handle> with a 301');
ok(eq(await moved('/firms/aitken-robertson-peterborough?utm=x'), [301, '/aitkenrobertson2?utm=x']), 'the question-mark part of an address is kept');
ok(eq(await moved('/firms/lawpoint-north-york'), [301, '/lawpoint']) && eq(await moved('/firms/lawpoint'), [301, '/lawpoint']), 'an address a firm used to have goes to the new one in one step');
ok(eq(await moved('/firms/big-firm-toronto/lawyers'), [301, '/bigfirm/lawyers']) && eq(await moved('/firms/big-firm-toronto/articles'), [301, '/bigfirm/articles']), 'the Lawyers and Articles pages move the same way');
ok(eq(await moved('/firms/no-handle-yet'), [301, '/no-handle-yet']), 'a firm with no handle redirects to /<slug>');
ok(eq(await moved('/firms/big-firm-toronto/lawyers/bo-chan'), [301, '/bochan']), 'a Featured lawyer\'s old page address goes to lawdb.ca/<name>');
ok(eq(await moved('/firms/big-firm-toronto/lawyers/nobody'), [301, '/bigfirm/lawyers']), 'an old lawyer address with no page goes to the firm\'s Lawyers page');
ok((await get('/firms/nobody-at-all')).status === 404 && (await get('/firms/hidden-firm-toronto')).status === 404, 'an old address that never existed, or belongs to a firm that is switched off, is a 404');

// lawyers' own pages: one namespace with the firms
const dir = await lawyerDirectory(env);
ok(dir.byAddr.get('annlee2')?.firm === 'big-firm-toronto' && dir.byAddr.get('annlee3')?.firm === 'other-firm-calgary' && !dir.byAddr.has('annlee'), 'a lawyer\'s address is never a firm\'s: Ann Lee is taken by a firm, so the two Featured Ann Lees are annlee2 and annlee3 (the firm that comes first has the lower number)');
ok(dir.byAddr.has('contactsmith') && dir.byFirm.get('other-firm-calgary')['ann-lee'] === 'annlee3', 'and a plain name is the address with no dashes: lawdb.ca/contactsmith');
const bo = await get('/bochan');
const boHtml = await bo.text();
ok(bo.status === 200 && canon(boHtml) === 'https://lawdb.ca/bochan' && boHtml.includes('<h1 class="pf-h1">Bo Chan</h1>') && boHtml.includes('href="/bigfirm/lawyers"'), 'lawdb.ca/<name> is the lawyer\'s page, its own canonical, and links back to the firm\'s Lawyers page');
const ann3 = await get('/annlee3');
ok(ann3.status === 200 && (await ann3.text()).includes('Other Firm'), 'the Ann Lee at the other firm is the page at annlee3');
const annFirm = await get('/annlee');
ok(annFirm.status === 200 && (await annFirm.text()).includes('1 Main St'), 'and /annlee is still the firm');
const lp = await (await get('/bigfirm/lawyers')).text();
ok(lp.includes('href="/annlee2"') && lp.includes('href="/bochan"') && !lp.includes('/firms/') && !lp.includes('/lawyer/'), 'a Featured firm\'s Lawyers page links each lawyer to lawdb.ca/<name>');
const lpOther = await (await get('/otherfirm/lawyers')).text();
ok(lpOther.includes('href="/annlee3"') && !lpOther.includes('href="/annlee2"'), 'and the other firm links its own Ann Lee at annlee3');
ok((await get('/nobodyhere')).status === 404 && (await get('/bochan/extra')).status === 404, 'a lawyer with no page of their own has none');

// the sitemap
const sm = await (await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env })).text();
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.includes('https://lawdb.ca/aitkenrobertson') && locs.includes('https://lawdb.ca/bigfirm/lawyers') && locs.includes('https://lawdb.ca/bochan') && locs.includes('https://lawdb.ca/annlee3'), 'the sitemap lists /<handle>, the Lawyers page and lawdb.ca/<name>');
ok(!locs.some((u) => u.includes('/firms/') || u.includes('-kingston') || u.includes('-calgary')) && !locs.includes('https://lawdb.ca/hiddenfirm'), 'no old address and no city in the sitemap; a firm switched off is not in it');

// the traffic message of a firm page counts for the firm
const b1 = await withFirmSlug(env, { t: 'pv', p: '/aitkenrobertson2', v: 1 });
const b2 = await withFirmSlug(env, { t: 'pv', p: '/firms/lawpoint' });
const b3 = await withFirmSlug(env, { t: 'pv', p: '/nobodyhere' });
const b4 = await withFirmSlug(env, { t: 'pv', p: '/news' });
ok(b1.p === '/firms/aitken-robertson-peterborough' && b2.p === '/firms/lawpoint' && b3.p === '/nobodyhere' && b4.p === '/news', 'a page view at /<handle> is counted for the firm\'s slug; anything else is counted as it is');

console.log(bad ? `\n${bad} check(s) failed` : '\nfirm and lawyer address checks passed');
process.exit(bad ? 1 : 0);
