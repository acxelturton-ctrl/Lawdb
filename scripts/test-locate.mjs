// Location on arrival (locate.js, suggest.js, find-lawyers.html, site.js, src/lib/stats.js): when the visitor is asked, what is remembered and for how long, that a
// position never leaves the browser, and what the search box does with it.
//   node scripts/test-locate.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { eventIncs, LOCATION_CHOICES } from '../src/lib/stats.js';

// locate.js is a plain browser script (the repo's "type": "module" would make require() treat it as a module), so it is run here the way a browser runs it,
// with a `module` to hand its functions to.
const box = { module: { exports: {} }, Date, Math, JSON, Promise, isFinite, setTimeout, console };
vm.runInNewContext(readFileSync(new URL('../locate.js', import.meta.url), 'utf8'), box, { filename: 'locate.js' });
const L = box.module.exports;

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- a pretend browser
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
function world({ permission = 'prompt', position = { latitude: 51.04472, longitude: -114.07194 }, error = null, noGeo = false, noPermissionsApi = false, now = 1_700_000_000_000 } = {}) {
  const clock = { t: now };
  const asked = [];
  const calls = { geo: 0 };
  const counts = [], emitted = [];
  const nav = noGeo ? {} : {
    geolocation: { getCurrentPosition(ok, fail) { calls.geo++; if (error) fail(error); else ok({ coords: position }); } },
    ...(noPermissionsApi ? {} : { permissions: { query: async () => { asked.push('query'); if (permission === 'throws') throw new Error('no'); return { state: permission }; } } }),
  };
  const session = memory(), store = memory();
  const loc = L.createLocator({ nav, session, store, now: () => clock.t, count: (v) => counts.push(v), emit: (k) => emitted.push(k) });
  return { loc, clock, session, store, counts, emitted, calls, asked };
}
const open = async (w) => w.loc.onOpen();
const DAY = 86400000;

// ---- distance
const calgary = [51.0447, -114.0719], edmonton = [53.5461, -113.4938], toronto = [43.6532, -79.3832];
const d = L.km(...calgary, ...edmonton);
ok(d > 275 && d < 295, `Calgary to Edmonton is about ${Math.round(d)} km`);
ok(L.km(...toronto, ...toronto) === 0 && Math.abs(L.km(...calgary, ...toronto) - L.km(...toronto, ...calgary)) < 1e-9, 'a spot is 0 km from itself, and the distance is the same both ways');

// ---- what happens when a page opens
ok(await open(world({ permission: 'prompt' })) === 'ask', 'a first visit, the browser has not been asked: the card is shown');
ok(await open(world({ permission: 'granted' })) === 'auto', 'the browser already allows location: refreshed quietly, no card');
ok(await open(world({ permission: 'denied' })) === 'none', 'the browser says no: nothing is shown, ever');
ok(await open(world({ noGeo: true })) === 'none', 'a browser with no location: nothing is shown');
ok(await open(world({ noPermissionsApi: true })) === 'ask', 'an older browser that cannot say whether it is allowed: the card is shown');
ok(await open(world({ permission: 'throws' })) === 'ask', 'a browser that fails to answer: the card is shown');
{
  const w = world({ permission: 'granted' });
  await w.loc.ask();
  ok(await open(w) === 'have' && w.calls.geo === 1 && !w.asked.length, 'a position already kept in this tab: nothing to do, the browser is not asked again, not even whether it is allowed');
}

// ---- what is kept: rounded, in this tab only, for 30 minutes
{
  const w = world();
  const k = await w.loc.ask();
  ok(k.lat === 51.045 && k.lng === -114.072, 'the position is rounded to about 100 m (51.04472 becomes 51.045)');
  ok(JSON.parse(w.session.m.get('lawdb.near')).lat === 51.045 && w.store.m.size === 0, 'it goes in this tab\'s note (the key the Find page reads), and nothing about it goes in storage that outlasts the tab');
  ok(w.emitted.length === 1 && w.emitted[0].lat === 51.045, 'listeners (the search box) are told');
  ok(w.loc.kept().lat === 51.045, 'and it can be read back');
  w.clock.t += 29 * 60 * 1000;
  ok(!!w.loc.kept(), 'still there after 29 minutes');
  w.clock.t += 2 * 60 * 1000;
  ok(w.loc.kept() === null, 'gone after 30 minutes');
  w.session.setItem('lawdb.near', JSON.stringify({ lat: 'x', lng: 1, t: w.clock.t }));
  ok(w.loc.kept() === null, 'a damaged note is ignored');
  w.session.setItem('lawdb.near', JSON.stringify({ lat: 1, lng: 1, t: w.clock.t + 3_600_000 }));
  ok(w.loc.kept() === null, 'a note from the future is ignored');
  w.session.setItem('lawdb.near', 'not json');
  ok(w.loc.kept() === null, 'a note that is not JSON is ignored');
}
{
  const seen = [];
  const w = world();
  w.loc.on((k) => seen.push(k));
  await w.loc.ask();
  ok(seen.length === 1, 'on() is called when a position arrives');
  const throwing = L.createLocator({ nav: { geolocation: { getCurrentPosition: (ok2) => ok2({ coords: { latitude: 1, longitude: 2 } }) } }, session: { getItem: () => null, setItem: () => { throw new Error('blocked'); } }, store: memory(), now: () => 5, count() {} });
  let fine = true; try { await throwing.ask(); } catch { fine = false; }
  ok(fine && throwing.kept() === null, 'storage that is blocked does not break the page: the position is used once and not kept');
}

// ---- the visitor taps "Use my location"
{
  const w = world();
  ok(await w.loc.request() === 'yes' && w.counts.join() === 'yes' && !!w.loc.kept(), 'yes: the position is kept and the answer is counted');
}
{
  const w = world({ error: { code: 1 } });
  ok(await w.loc.request() === 'no' && w.counts.join() === 'no' && !w.loc.kept(), 'refused in the browser\'s prompt: counted, nothing kept');
  ok(JSON.parse(w.store.m.get('lawdb.locAsk')).v === 'no', 'the refusal is remembered on the device (a preference, not a place)');
  ok(await open(w) === 'none', 'so the card does not come back');
  w.clock.t += 89 * DAY;
  ok(await open(w) === 'none', 'not after 89 days');
  w.clock.t += 2 * DAY;
  ok(await open(w) === 'ask', 'but after 90 days it may ask again');
}
{
  const w = world({ error: { code: 3 } });
  ok(await w.loc.request() === 'fail' && w.counts.join() === 'fail', 'the browser could not find the visitor this time (timeout): counted as fail, not as a refusal');
  ok(JSON.parse(w.store.m.get('lawdb.locAsk')).v === 'later', 'it is treated like Not now, not like a refusal');
}
{
  const w = world();
  w.loc.later();
  ok(w.counts.join() === 'later' && JSON.parse(w.store.m.get('lawdb.locAsk')).v === 'later', 'Not now is counted and remembered');
  ok(await open(w) === 'none', 'the card does not come straight back');
  w.clock.t += 13 * DAY;
  ok(await open(w) === 'none', 'not after 13 days');
  w.clock.t += 2 * DAY;
  ok(await open(w) === 'ask', 'but after 14 days it asks again');
  w.store.setItem('lawdb.locAsk', '{"v":"forever","t":1}');
  ok(w.loc.lastChoice() === null, 'an unknown remembered answer is ignored');
}

// ---- the browser is only ever asked from request() or ask(), never by merely opening a page
{
  const w = world({ permission: 'prompt' });
  await open(w);
  ok(w.calls.geo === 0, 'opening a page never asks the browser for the position (that waits for the visitor\'s tap)');
}

// ---- the module in a browser: not in the admin or the member pages, not inside another page
{
  const make = (pathname, top = false) => { const w = { location: { pathname }, document: { documentElement: {}, readyState: 'complete' }, navigator: {}, setTimeout: () => {} }; w.top = top ? {} : w; w.self = w; return w; };
  const admin = make('/admin/'), account = make('/account/'), framed = make('/', true);
  L.start(admin); L.start(account); L.start(framed);
  ok(!admin.LawdbLocation && !account.LawdbLocation && !framed.LawdbLocation, 'the admin area, the member pages and a page shown inside another page never ask');
}

// ---- the code and the pages that carry it
const js = readFileSync('locate.js', 'utf8'), site = readFileSync('site.js', 'utf8'), sug = readFileSync('suggest.js', 'utf8'), find = readFileSync('find-lawyers.html', 'utf8'), home = readFileSync('index.html', 'utf8');
const policy = readFileSync('privacy-policy.html', 'utf8');
ok(!/\.innerHTML|insertAdjacentHTML|document\.write/.test(js), 'the card is built with text nodes, never innerHTML');
ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(js) && !/lat|lng/.test(js.slice(js.indexOf('function count'), js.length).split('counted')[0] || ''), 'locate.js sends nothing anywhere: the only message is the answer, through the page\'s own counter');
ok(/lwq[^;]*push\(\{ t: 'loc', v: v \}\)/.test(js), 'the counter message carries only the answer (t: loc, v: yes / no / later / fail / auto)');
ok(/role', 'dialog'\)/.test(js) && /aria-modal', 'false'/.test(js) && /key === 'Escape'/.test(js) && /prefers-reduced-motion/.test(js) && /aria-label', T\.close/.test(js), 'the card is a labelled, non-modal dialog that Escape closes, with reduced motion respected');
ok(/ASK_STYLE = 'card'/.test(js) && /ASK_STYLE === 'native'/.test(js), 'the browser prompt on page load is one switch away (ASK_STYLE), off by default');
const loader = site.slice(site.lastIndexOf('// Location:'));
ok(/\/locate\.js\?v=\d+/.test(loader) && /\(admin\|account\)/.test(loader) && /window\.top !== window\.self/.test(loader), 'every public page loads locate.js through site.js (not the admin or member pages, not in a frame)');
ok(/sessionStorage\.getItem\('lawdb\.near'\)/.test(sug) && /nearRow\(/.test(sug) && /nearestCity\(\)/.test(sug) && /lawdb:location/.test(sug), 'the search box reads where the visitor is, and says "near you" with their city');
ok(/function keptSpot\(\)/.test(find) && /startNear\(\{ lat: here\.lat, lng: here\.lng, label: 'you', me: true \}, p\.caseId\)/.test(find), 'a practice area alone on the Find page goes straight to the closest firms once the visitor has shared where they are');
ok(/suggest\.js\?v=6/.test(home) && /suggest\.js\?v=6/.test(find), 'the pages load the new search script');
ok(/Your location \(only if you say yes\)/.test(policy) && /not stored on our servers/.test(policy) && /14 days/.test(policy) && /90 days/.test(policy) && /never a place/.test(policy), 'the privacy policy says what is asked, what is kept and for how long, and that only the answer is counted');

// ---- the anonymous counts
ok([...LOCATION_CHOICES].sort().join() === 'auto,fail,later,no,yes', 'five answers are counted');
ok(JSON.stringify(eventIncs({ t: 'loc', v: 'yes' })) === '[["loc","yes",""]]' && JSON.stringify(eventIncs({ t: 'loc', v: 'no' })) === '[["loc","no",""]]', 'an answer is one count under "loc"');
ok(eventIncs({ t: 'loc', v: 'maybe' }) === null && eventIncs({ t: 'loc' }) === null && eventIncs({ t: 'loc', v: { x: 1 } }) === null, 'anything else is ignored');
ok(JSON.stringify(eventIncs({ t: 'loc', v: 'yes', lat: 51.04, lng: -114.07, city: 'Calgary' })) === '[["loc","yes",""]]', 'a position that is sent along anyway is never counted or kept');
ok(/location: top\(location\.results\)/.test(readFileSync('src/lib/stats.js', 'utf8')) && /Location, when asked/.test(readFileSync('admin/admin.js', 'utf8')), 'the owner sees the answers in the Traffic tab');

console.log(bad ? `\n${bad} check(s) failed` : '\nall location checks passed');
process.exit(bad ? 1 : 0);
