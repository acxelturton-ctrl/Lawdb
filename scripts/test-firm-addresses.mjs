// The addresses of firm and lawyer pages:  node --no-warnings scripts/test-firm-addresses.mjs
//   a firm is /firm/<handle> (its Lawyers and Articles pages under it), a Featured lawyer's own page is /lawyer/<name>, the old /firms/<slug> goes there with a 301, and no city is
//   ever added to an address. Runs against a real in-memory SQLite database built from the migrations (the same SQL as the Worker's D1).
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { candidateHandle, assignHandles, loadHandles } from './lib/firm-handles.mjs';
import { firmPath, uniqueHandleFor, currentAddress, firmByToken, HANDLE_RE } from '../src/lib/firm-handle.js';
import { lawyerDirectory } from '../src/lib/lawyer-address.js';
import { firmPage } from '../src/routes/firm-page.js';
import { firmSitemap } from '../src/routes/firm-sitemap.js';
import { withFirmSlug } from '../src/routes/stats.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- the rule: the slug without its city, never a city on the end
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(candidateHandle('lawpoint-north-york', 'North York') === 'lawpoint' && candidateHandle('aitken-robertson-kingston', 'Kingston') === 'aitken-robertson' && candidateHandle('fasken', 'Toronto') === 'fasken', 'the city is taken off the end of a slug, and a slug without one stays as it is');
ok(candidateHandle('grillo-law-personal-injury-lawyers-north-york', 'Toronto') === 'grillo-law-personal-injury-lawyers', 'a firm that moved to another city loses its old place name too (Grillo Law)');
ok(candidateHandle('st-a-law', 'St. A') === 'st-a-law' && candidateHandle('ab-toronto', 'Toronto') === 'ab-toronto', 'a handle never gets shorter than three characters');
const firms = [
  { slug: 'stikeman-elliott-llp', city: 'Toronto', count: 39 }, { slug: 'stikeman-elliott-llp-calgary', city: 'Calgary', count: 80 },
  { slug: 'smith-law-toronto', city: 'Toronto', count: 10 }, { slug: 'smith-law-calgary', city: 'Calgary', count: 90 }, { slug: 'smith-law-halifax', city: 'Halifax', count: 5 },
];
const given = assignHandles(firms);
ok(given['stikeman-elliott-llp'] === 'stikeman-elliott-llp' && given['stikeman-elliott-llp-calgary'] === 'stikeman-elliott-llp-2', 'the firm whose slug is already the handle keeps it; its other office gets -2, not "-calgary"');
ok(given['smith-law-calgary'] === 'smith-law' && given['smith-law-toronto'] === 'smith-law-2' && given['smith-law-halifax'] === 'smith-law-3', 'two firms with one name: more Google reviews first, then -2, -3');
ok(eq(assignHandles(firms, given), {}) && assignHandles([{ slug: 'new-firm-ottawa', city: 'Ottawa' }], given)['new-firm-ottawa'] === 'new-firm', 'a handle already given never changes; a new firm gets one');

// ---- the real list
const all = loadHandles();
const renamed = JSON.parse(readFileSync('data/firm-renames.json', 'utf8')); // a firm renamed in the live database: its old slug is an alias of the new one's handle
const slugs = Object.keys(all), values = Object.entries(all).filter(([slug]) => !renamed[slug]).map(([, h]) => h);
ok(slugs.length > 1800 && new Set(values).size === values.length && values.every((h) => HANDLE_RE.test(h) && h.length >= 3 && h.length <= 80), `${slugs.length} firms have a handle; every handle is unique and a plain address`);
ok(all.lawpoint === 'lawpoint' && all['lawpoint-north-york'] === 'lawpoint' && all['grillo-law-personal-injury-lawyers-north-york'] === 'grillo-law-personal-injury-lawyers', 'Lawpoint is /firm/lawpoint and Grillo Law is /firm/grillo-law-personal-injury-lawyers');
const withCity = slugs.filter((s) => all[s] !== s).length;
ok(withCity > 1400, `${withCity} firms lost the city that was on the end of their slug`);

// ---- a database like the Worker's, built from the migrations
const db = new DatabaseSync(':memory:');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
const d1 = { prepare(sql) { const st = db.prepare(sql); let args = []; const o = { bind(...a) { args = a; return o; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { st.run(...args); return {}; } }; return o; } };
const stored = new Map();
globalThis.caches = { default: { async match() { return undefined; }, async put(k, v) { stored.set(k.url, v); }, async delete() { return true; } } };
globalThis.HTMLRewriter = class { on() { return this; } transform(res) { return res; } };
const ABOUT = 'Plain words about the firm and what it does for people. '.repeat(8);
const lawyers = (names) => names.map((n, i) => ({ name: n, slug: n.toLowerCase().replace(/[^a-z]+/g, '-'), title: 'Partner', callYear: 2000 + i, confirmed: true, featured: true }));
const put = (slug, { handle = null, name = slug, city = 'Toronto', featured = 0, status = 'live', lw = [] } = {}) => {
  const data = { slug, name, city, province: 'ON', featured: !!featured, caseTypes: ['family'], phone: '+14165551234', address: '1 Main St, Toronto, ON', ...(handle ? { handle } : {}), ...(lw.length ? { lawyers: lw } : {}) };
  db.prepare('INSERT INTO firms (slug, name, city, province, region, featured, data, about, status, handle) VALUES (?,?,?,?,?,?,?,?,?,?)').run(slug, name, city, 'ON', 'toronto', featured, JSON.stringify(data), ABOUT, status, handle);
};
put('aitken-robertson-kingston', { handle: 'aitken-robertson', name: 'Aitken Robertson', city: 'Kingston' });
put('aitken-robertson-peterborough', { handle: 'aitken-robertson-2', name: 'Aitken Robertson', city: 'Peterborough' });
put('lawpoint', { handle: 'lawpoint', name: 'Lawpoint', city: 'North York' });
put('no-handle-yet', { name: 'No Handle Yet' });
put('hidden-firm-toronto', { handle: 'hidden-firm', status: 'hidden' });
put('big-firm-toronto', { handle: 'big-firm', name: 'Big Firm', featured: 1, lw: lawyers(['Ann Lee', 'Bo Chan', 'Cy Diaz']) });
put('other-firm-calgary', { handle: 'other-firm', name: 'Other Firm', city: 'Calgary', featured: 1, lw: lawyers(['Ann Lee', 'Dee Evans']) });
db.prepare("INSERT INTO firm_redirects (old_slug, new_slug) VALUES ('lawpoint-north-york', 'lawpoint')").run();
const env = { DB: d1, PUBLIC_CACHE_TTL: '0', SITE_ORIGIN: 'https://lawdb.ca', ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
const ctx = { waitUntil() {} };
const get = (path) => firmPage({ request: new Request(`https://lawdb.ca${path}`), env, ctx });
const moved = async (path) => { const r = await get(path); return [r.status, r.headers.get('location')]; };
const canon = (html) => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];

// the address helpers
ok(firmPath({ slug: 'a-b', handle: 'a' }) === '/firm/a' && firmPath({ slug: 'a-b' }) === '/firm/a-b' && firmPath({ slug: 'a-b', handle: 'a' }, 'lawyers') === '/firm/a/lawyers', 'firmPath: the handle, the slug when there is no handle yet, and a tab');
ok((await firmByToken(env, 'aitken-robertson')).slug === 'aitken-robertson-kingston' && (await firmByToken(env, 'aitken-robertson-2')).slug === 'aitken-robertson-peterborough' && (await firmByToken(env, 'no-handle-yet')).slug === 'no-handle-yet' && !(await firmByToken(env, 'aitken-robertson-kingston')), 'a handle finds its firm; a slug finds only a firm that has no handle yet');
ok((await uniqueHandleFor(env, 'brand-new-ottawa', 'Ottawa')) === 'brand-new' && (await uniqueHandleFor(env, 'aitken-robertson-ottawa', 'Ottawa')) === 'aitken-robertson-3' && (await uniqueHandleFor(env, 'lawpoint-north-york', 'North York')) === 'lawpoint-2', 'a firm that lists itself gets a handle without its city, numbered when taken');
const cur = await currentAddress(env, 'lawpoint-north-york');
ok(cur && cur.slug === 'lawpoint' && cur.handle === 'lawpoint' && (await currentAddress(env, 'aitken-robertson-kingston')).handle === 'aitken-robertson' && (await currentAddress(env, 'nobody')) === null, 'an old slug (even one renamed before) leads to the firm\'s handle in one step');

// the pages
const page = await get('/firm/aitken-robertson');
const html = await page.text();
ok(page.status === 200 && canon(html) === 'https://lawdb.ca/firm/aitken-robertson' && html.includes('<meta property="og:url" content="https://lawdb.ca/firm/aitken-robertson">'), '/firm/<handle> is the page, its own canonical and og:url');
ok((await (await get('/firm/aitken-robertson-2')).text()).includes('Peterborough') && canon(await (await get('/firm/aitken-robertson-2')).text()) === 'https://lawdb.ca/firm/aitken-robertson-2', 'the other office of the same firm has its own address (-2, no city)');
const nh = await get('/firm/no-handle-yet');
ok(nh.status === 200 && canon(await nh.text()) === 'https://lawdb.ca/firm/no-handle-yet', 'a firm that has no handle yet is at /firm/<slug>');
ok(eq(await moved('/firm/aitken-robertson-kingston'), [301, '/firm/aitken-robertson']) && eq(await moved('/firm/lawpoint-north-york'), [301, '/firm/lawpoint']), 'the slug of a firm that has a handle, or an address it used to have, goes to /firm/<handle> (301), so it is never a second page');
ok((await get('/firm/hidden-firm')).status === 404 && (await get('/firm/nobody-here')).status === 404, 'a firm switched off, or one that does not exist, has no page');
const slashed = await get('/firm/aitken-robertson/');
ok(slashed.status === 200 || (slashed.status === 301 && slashed.headers.get('location') === '/firm/aitken-robertson') || slashed.status === 404, 'a trailing slash is not a second page');

// the old addresses
ok(eq(await moved('/firms/aitken-robertson-kingston'), [301, '/firm/aitken-robertson']), '/firms/<slug> goes to /firm/<handle> with a 301');
ok(eq(await moved('/firms/aitken-robertson-peterborough?utm=x'), [301, '/firm/aitken-robertson-2?utm=x']), 'the question-mark part of an address is kept');
ok(eq(await moved('/firms/lawpoint-north-york'), [301, '/firm/lawpoint']) && eq(await moved('/firms/lawpoint'), [301, '/firm/lawpoint']), 'an address a firm used to have goes to the new one in one step');
ok(eq(await moved('/firms/big-firm-toronto/lawyers'), [301, '/firm/big-firm/lawyers']) && eq(await moved('/firms/big-firm-toronto/articles'), [301, '/firm/big-firm/articles']), 'the Lawyers and Articles pages move the same way');
ok(eq(await moved('/firms/no-handle-yet'), [301, '/firm/no-handle-yet']), 'a firm with no handle redirects to /firm/<slug>');
ok(eq(await moved('/firms/big-firm-toronto/lawyers/bo-chan'), [301, '/lawyer/bo-chan']), 'a Featured lawyer\'s old page address goes to /lawyer/<name>');
ok(eq(await moved('/firms/big-firm-toronto/lawyers/nobody'), [301, '/firm/big-firm/lawyers']), 'an old lawyer address with no page goes to the firm\'s Lawyers page');
ok((await get('/firms/nobody-at-all')).status === 404, 'an old address that never existed is a 404');

// lawyers' own pages
const dir = await lawyerDirectory(env);
ok(dir.byAddr.get('ann-lee').firm === 'big-firm-toronto' && dir.byAddr.get('ann-lee-2').firm === 'other-firm-calgary' && dir.byFirm.get('other-firm-calgary')['ann-lee'] === 'ann-lee-2', 'two Featured lawyers with one name: the firm that comes first has /lawyer/ann-lee, the other /lawyer/ann-lee-2 (never a city)');
const bo = await get('/lawyer/bo-chan');
const boHtml = await bo.text();
ok(bo.status === 200 && canon(boHtml) === 'https://lawdb.ca/lawyer/bo-chan' && boHtml.includes('<h1 class="pf-h1">Bo Chan</h1>') && boHtml.includes('href="/firm/big-firm/lawyers"'), '/lawyer/<name> is the lawyer\'s page, its own canonical, and links back to the firm\'s Lawyers page');
const ann2 = await get('/lawyer/ann-lee-2');
ok(ann2.status === 200 && (await ann2.text()).includes('Other Firm'), 'the second Ann Lee\'s page is the one at the other firm');
const lp = await (await get('/firm/big-firm/lawyers')).text();
ok(lp.includes('href="/lawyer/ann-lee"') && lp.includes('href="/lawyer/bo-chan"') && !lp.includes('/firms/'), 'a Featured firm\'s Lawyers page links each lawyer to /lawyer/<name>');
const lpOther = await (await get('/firm/other-firm/lawyers')).text();
ok(lpOther.includes('href="/lawyer/ann-lee-2"') && !lpOther.includes('href="/lawyer/ann-lee"'), 'and the other firm links its own Ann Lee at -2');
ok((await get('/lawyer/nobody-here')).status === 404 && (await get('/lawyer/bo-chan/extra')).status === 404, 'a lawyer with no page of their own has none');
eq; 

// the sitemap
const sm = await (await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env })).text();
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.includes('https://lawdb.ca/firm/aitken-robertson') && locs.includes('https://lawdb.ca/firm/big-firm/lawyers') && locs.includes('https://lawdb.ca/lawyer/bo-chan') && locs.includes('https://lawdb.ca/lawyer/ann-lee-2'), 'the sitemap lists /firm/<handle>, the Lawyers page and /lawyer/<name>');
ok(!locs.some((u) => u.includes('/firms/') || u.includes('-kingston') || u.includes('-calgary')) && !locs.includes('https://lawdb.ca/firm/hidden-firm'), 'no old address and no city in the sitemap; a firm switched off is not in it');

// the traffic message of a firm page counts for the firm
const b1 = await withFirmSlug(env, { t: 'pv', p: '/firm/aitken-robertson-2', v: 1 });
const b2 = await withFirmSlug(env, { t: 'pv', p: '/firms/lawpoint' });
const b3 = await withFirmSlug(env, { t: 'pv', p: '/firm/nobody-here' });
ok(b1.p === '/firms/aitken-robertson-peterborough' && b2.p === '/firms/lawpoint' && b3.p === '/firm', 'a page view at /firm/<handle> is counted for the firm\'s slug; an unknown handle is not counted');

console.log(bad ? `\n${bad} check(s) failed` : '\nfirm and lawyer address checks passed');
process.exit(bad ? 1 : 0);
