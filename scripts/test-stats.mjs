// The traffic counter: every value is checked or dropped, robots are ignored, nothing about the sender is kept, and a message only ever adds to
// counters with sensible names. (The end-to-end part, sending real messages to the running Worker and reading the owner's report, is in smoke.mjs.)
import { cleanPath, cleanRef, cleanWords, eventIncs, isBot, throttled, torontoDay, record, prune } from '../src/lib/stats.js';
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- addresses
ok(cleanPath('/firms/Torkin-Manes-LLP?utm=x#top') === '/firms/torkin-manes-llp' && cleanPath('/ontario/toronto/') === '/ontario/toronto' && cleanPath('') === '/' && cleanPath('/index.html') === '/index', 'page addresses are tidied: no query, hash, trailing slash or .html, lower case');
ok(['<script>', '/a//b', '/../etc', 'https://evil.com/x', '/x y', 'x', 42, null, '/' + 'a'.repeat(130)].every((p) => cleanPath(p) === null), 'anything that is not a plain site address is refused');

// ---- referrers
ok(cleanRef('www.google.ca') === 'google' && cleanRef('l.facebook.com') === 'facebook' && cleanRef('t.co') === 'x' && cleanRef('Example.com') === 'example.com', 'search engines and social sites are grouped, other sites keep their name');
ok(cleanRef('lawdb.ca') === '' && cleanRef('www.lawdb.ca') === '' && cleanRef('x') === '' && cleanRef('a b.com') === '' && cleanRef(5) === '', 'our own site, junk and non-text are not a referrer');

// ---- words nobody has a page for
ok(cleanWords('Keswick') === 'keswick' && cleanWords('  st   catharines ') === 'st catharines' && cleanWords('Keswick, ON') === 'keswick, on' && cleanWords("saint-jean-sur-richelieu") === 'saint-jean-sur-richelieu' && cleanWords('Trois-Rivières') === 'trois-rivières', 'town names are kept (lower case, tidy spacing, accents kept)');
ok(['call me 4165551234', 'john@example.com', 'https://x.com/a', 'www.x.com', 'a', '', 'a b c d e f', 'x'.repeat(41), '<b>x</b>', '12345', null, 7].every((w) => cleanWords(w) === ''), 'numbers, emails, links, markup and long rambles are dropped, never stored');

// ---- robots and throttling
ok(['Googlebot/2.1', 'Mozilla/5.0 HeadlessChrome/120', 'curl/8.0', 'python-requests/2.31', 'Lighthouse', '', undefined, 'UptimeRobot/2.0'].every(isBot), 'robots, scripts and monitors are recognised');
ok(!isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1') && !isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'), 'ordinary phone and computer browsers are counted');
{
  const t = 1_000_000;
  let hit = false;
  for (let i = 0; i < 90; i++) hit = hit || throttled('1.2.3.4', t + i);
  ok(!hit && throttled('1.2.3.4', t + 100) && !throttled('9.9.9.9', t + 100) && !throttled('1.2.3.4', t + 61_000), 'one address may send 90 messages a minute, then the rest are ignored until the minute is up');
}
ok(/^\d{4}-\d{2}-\d{2}$/.test(torontoDay()) && torontoDay(new Date('2026-10-20T03:30:00Z')) === '2026-10-19', 'days are Toronto days');

// ---- page views
const geo = { country: 'CA', region: 'MB' };
ok(same(eventIncs({ t: 'pv', p: '/firms/a-law', m: 1, s: 0 }, geo), [['pv', '/firms/a-law', ''], ['dev', 'mobile', '']]), 'a later page of a visit adds a page view and the device, nothing else');
ok(same(eventIncs({ t: 'pv', p: '/', m: 0, s: 1, r: 'www.google.com', u: 'Spring' }, geo), [['pv', '/', ''], ['dev', 'desktop', ''], ['visit', '', ''], ['entry', '/', ''], ['ref', 'google', ''], ['geo', 'CA', 'MB'], ['utm', 'spring', '']]), 'the first page of a visit also counts the visit, landing page, where it came from, the coarse region and a campaign');
ok(same(eventIncs({ t: 'pv', p: '/', s: 1, r: 'lawdb.ca' }, {}).slice(-2), [['ref', 'direct', ''], ['geo', '??', '']]), 'no referrer is "direct" and an unknown region is "??"');
ok(eventIncs({ t: 'pv', p: '<x>' }, geo) === null && eventIncs({ t: 'pv' }, geo) === null, 'a page view without a real address is not counted');
ok(!JSON.stringify(eventIncs({ t: 'pv', p: '/', s: 1, ip: '1.2.3.4', ua: 'secret', email: 'a@b.com', id: 'abc' }, geo)).match(/1\.2\.3\.4|secret|a@b\.com|abc/), 'anything else in a message (an address, browser details, an id) is ignored and never stored');

// ---- clicks
ok(same(eventIncs({ t: 'ev', e: 'call', p: '/firms/a-law' }), [['ev', 'call', '/firms/a-law']]) && eventIncs({ t: 'ev', e: 'delete-everything', p: '/' }) === null && eventIncs({ t: 'ev', e: 'call', p: 'nope' }) === null, 'only the known click names are counted, each with its page');

// ---- searches
ok(same(eventIncs({ t: 'search', c: 'family', city: 'Ottawa|ON' }), [['search', 'family', 'Ottawa|ON']]), 'a search for a kind of lawyer in a city adds to that pair');
ok(same(eventIncs({ t: 'search', c: 'injury', prov: 'BC' }), [['search', 'injury', 'BC']]) && same(eventIncs({ t: 'search', c: 'criminal', near: true }), [['search', 'criminal', 'near-me']]), 'a province and "near me" are places too');
ok(same(eventIncs({ t: 'search', c: 'criminal', w: 'Keswick' }), [['search', 'criminal', ''], ['town', 'keswick', 'criminal']]), 'a lawyer type with a town nobody has a page for is a "town" the owner can add firms for');
ok(same(eventIncs({ t: 'search', c: '', w: 'Keswick, ON', nt: 1 }), [['search', '', ''], ['town', 'keswick, on', '']]), 'a town picked from the suggestions counts as a town even without a lawyer type');
ok(same(eventIncs({ t: 'search', w: 'purple monkey' }), [['search', '', ''], ['noparse', 'purple monkey', '']]), 'words that matched nothing at all are kept (letters only) so the owner can see what people expect');
ok(same(eventIncs({ t: 'search', c: 'family', city: 'Ottawa|ON', w: 'john smith' }), [['search', 'family', 'Ottawa|ON']]), 'when a city matched, any extra words are dropped, not kept');
ok(same(eventIncs({ t: 'search', c: 'weird', city: '<b>|ON', prov: 'XX', w: 'call 4165551234' }), null) && eventIncs({ t: 'search' }) === null && eventIncs({ t: 'nope' }) === null && eventIncs('x') === null && eventIncs(null) === null, 'invented case types, cities, provinces, numbers and unknown message types are refused');

// ---- writing and tidying up: one add-one statement per counter, today's day, no other columns
{
  const calls = [];
  const env = { DB: { prepare: (sql) => ({ sql, bind: (...a) => ({ sql, a }) }), batch: async (stmts) => { calls.push(...stmts); return stmts.map(() => ({ meta: { changes: 2 } })); } } };
  await record(env, '2026-10-19', [['pv', '/', ''], ['dev', 'mobile', '']]);
  ok(calls.length === 2 && calls.every((c) => /ON CONFLICT \(day, kind, k1, k2\) DO UPDATE SET n = n \+ 1/.test(c.sql)) && same(calls[0].a, ['2026-10-19', 'pv', '/', '']), 'each counter is "add one to today\'s row"');
  const before = calls.length;
  await record(env, 'x', []);
  ok(calls.length === before, 'nothing to count means no database call');
  const removed = await prune(env);
  ok(removed === 4 && calls.slice(before).some((c) => /400 days/.test(c.sql)) && calls.slice(before).some((c) => /'town', 'noparse'/.test(c.sql) && /90 days/.test(c.sql)), 'tidying deletes counts older than 400 days and unmatched words older than 90 days');
}

// ---- the page script: nothing for Do Not Track / Global Privacy Control, none in member areas, no cookie
{
  const js = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
  ok(/doNotTrack === '1'/.test(js) && /globalPrivacyControl === true/.test(js) && /\(admin\|account\|api\)/.test(js), 'the page script sends nothing for Do Not Track, Global Privacy Control, or the admin, account and api areas');
  ok(!/document\.cookie/.test(js.slice(js.indexOf('Traffic counts'))), 'the counting script never touches cookies');
  const adminJs = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  ok(/localStorage\.getItem\('lawdb_skip'\) === '1'/.test(js) && /var off = mine \|\|/.test(js), 'the page script sends nothing from a browser marked as the owner\'s (lawdb_skip)');
  ok(/setSkip\(true\)/.test(adminJs) && /skipState\(\) === null/.test(adminJs) && /Count this device again/.test(adminJs) && /Do not count this device/.test(adminJs), 'opening the admin marks the device, unless the owner has chosen otherwise, and the Traffic tab can switch it either way');
}

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\ntraffic counter checks passed');
