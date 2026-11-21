/* LawDB location: ask once, on a visitor's first page, whether we may use where they are to show the closest lawyers first.
   - window.LawdbLocation.get()  -> { lat, lng, t } kept in THIS browser tab for 30 minutes, or null
     .ask() -> Promise (the browser's own permission prompt; call it from a tap)   .state() -> 'granted' | 'denied' | 'prompt' | 'unsupported'
     .km(lat1, lng1, lat2, lng2)   .on(fn) calls fn when a position arrives
   - The position never leaves the browser: it is not sent to LawDB, not stored on our servers and not put in an address. It is rounded to about 100 m and kept in
     sessionStorage ('lawdb.near', the key the Find page already reads); the search box (suggest.js) and the Find page use it to put "near you" first.
   - What happens when a page opens:
       a position is already kept in this tab         nothing to do;
       the browser already allows location for us     the position is refreshed quietly, no prompt, no card;
       the browser says no, or has no location        nothing, and nothing is shown;
       otherwise                                      a small card asks "Find a lawyer near you, faster?"; only its button starts the browser's own prompt.
     Asking the browser's prompt the moment a page loads is avoided on purpose: a "Block" is remembered by the browser for good, most people block a prompt they did not ask
     for, Chrome's Lighthouse flags it, and the card costs nothing. Set ASK_STYLE to 'native' to open the browser's prompt straight away anyway.
   - "Not now" is remembered on this device for 14 days, a refusal for 90 days (a preference, not a place). We count, anonymously, how many people said yes, no, later,
     or were recognised ('loc' counts in the Traffic tab): never where anyone is.
   Tested without a browser: scripts/test-locate.mjs (createLocator takes everything it touches as arguments). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && root === window) api.start(window);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var ASK_STYLE = 'card'; // 'card' (recommended) or 'native' (the browser's prompt on page load)
  var KEY = 'lawdb.near', ASK = 'lawdb.locAsk', COUNTED = 'lawdb.locCounted';
  var KEEP_MS = 30 * 60 * 1000;
  var SNOOZE_MS = { later: 14 * 86400000, no: 90 * 86400000 };

  var TEXT = {
    en: { title: 'Find a lawyer near you, faster', body: 'Share your location and we will show the closest firms first. It stays in your browser. We never store it.', go: 'Use my location', later: 'Not now', finding: 'Finding you…',
      thanks: 'Thanks. Lawyers near you come first now.', no: 'No problem. Type your town in the search box instead.', fail: 'We could not find you just now. Type your town in the search box instead.', close: 'Close' },
    fr: { title: 'Trouvez un avocat près de chez vous, plus vite', body: 'Partagez votre position et nous afficherons d’abord les cabinets les plus proches. Elle reste dans votre navigateur. Nous ne la conservons jamais.', go: 'Utiliser ma position', later: 'Pas maintenant', finding: 'Recherche de votre position…',
      thanks: 'Merci. Les avocats près de vous passent en premier.', no: 'Aucun problème. Saisissez votre ville dans la barre de recherche.', fail: 'Nous n’avons pas pu vous localiser. Saisissez votre ville dans la barre de recherche.', close: 'Fermer' }
  };

  var isNum = function (n) { return typeof n === 'number' && isFinite(n); };
  var round3 = function (n) { return Math.round(n * 1000) / 1000; }; // about 100 m: enough to find the closest firm, too coarse to find a door

  // Great-circle distance in km.
  function km(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // env: { nav, session, store, now(), emit(position), count(choice) }. Everything it touches comes in here, so it can be tested without a browser.
  function createLocator(env) {
    var listeners = [];
    function kept() {
      try {
        var k = JSON.parse(env.session.getItem(KEY) || 'null');
        if (k && isNum(k.lat) && isNum(k.lng) && isNum(k.t) && env.now() - k.t < KEEP_MS && env.now() >= k.t - 60000) return k;
      } catch (e) { /* storage blocked or a damaged note: nothing is kept */ }
      return null;
    }
    function save(lat, lng) {
      var k = { lat: round3(lat), lng: round3(lng), t: env.now() };
      try { env.session.setItem(KEY, JSON.stringify(k)); } catch (e) { /* storage blocked: it is used once and not kept */ }
      listeners.slice().forEach(function (fn) { try { fn(k); } catch (e) { /* a listener's trouble is its own */ } });
      if (env.emit) env.emit(k);
      return k;
    }
    function lastChoice() {
      try {
        var c = JSON.parse(env.store.getItem(ASK) || 'null');
        if (c && SNOOZE_MS[c.v] && isNum(c.t) && env.now() - c.t < SNOOZE_MS[c.v]) return c;
      } catch (e) { /* ignore */ }
      return null;
    }
    function choose(v) { try { env.store.setItem(ASK, JSON.stringify({ v: v, t: env.now() })); } catch (e) { /* storage blocked: it may ask again next visit */ } }
    function state() {
      if (!env.nav || !env.nav.geolocation) return Promise.resolve('unsupported');
      if (!env.nav.permissions || !env.nav.permissions.query) return Promise.resolve('prompt');
      return env.nav.permissions.query({ name: 'geolocation' }).then(function (s) { return s.state; }, function () { return 'prompt'; });
    }
    // The browser's position. This is the only place the browser is asked.
    function ask() {
      return new Promise(function (resolve, reject) {
        if (!env.nav || !env.nav.geolocation) { reject({ code: 0 }); return; }
        env.nav.geolocation.getCurrentPosition(function (p) { resolve(save(p.coords.latitude, p.coords.longitude)); }, function (e) { reject(e || { code: 2 }); }, { timeout: 9000, maximumAge: 600000 });
      });
    }
    // What to do when a page opens: 'have' | 'auto' | 'ask' | 'none'.
    function onOpen() {
      if (kept()) return Promise.resolve('have');
      return state().then(function (s) {
        if (s === 'granted') return 'auto';
        if (s === 'denied' || s === 'unsupported') return 'none';
        return lastChoice() ? 'none' : 'ask';
      });
    }
    // The visitor tapped "Use my location". Resolves 'yes', 'no' (they refused) or 'fail' (no position this time). The choice is remembered and counted.
    function request() {
      return ask().then(function () { env.count && env.count('yes'); return 'yes'; }, function (e) {
        if (e && e.code === 1) { choose('no'); env.count && env.count('no'); return 'no'; }
        choose('later'); env.count && env.count('fail'); return 'fail';
      });
    }
    function later() { choose('later'); env.count && env.count('later'); }
    return { kept: kept, ask: ask, state: state, onOpen: onOpen, request: request, later: later, lastChoice: lastChoice, on: function (fn) { listeners.push(fn); }, save: save };
  }

  // ---- the card (only in a browser)
  var CSS = '.lwloc{position:fixed;left:16px;bottom:16px;z-index:2147483000;width:340px;max-width:calc(100vw - 96px);box-sizing:border-box;background:#fffdf8;color:#2a2a2a;border:1px solid #ece6d3;border-radius:16px;box-shadow:0 10px 30px rgba(42,42,42,.18);padding:16px 16px 14px;font:14px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.lwloc *{box-sizing:border-box}.lwloc-t{display:block;margin:0 24px 6px 0;font:700 16px/1.25 "Source Serif 4",Georgia,serif;color:#2a2a2a}.lwloc-b{margin:0 0 12px;color:#5f5f5f}' +
    '.lwloc-row{display:flex;flex-wrap:wrap;gap:8px}.lwloc button{font:700 14px Inter,system-ui,sans-serif;border-radius:10px;padding:10px 14px;cursor:pointer;border:1px solid #ece6d3;background:#fff;color:#2a2a2a;min-height:40px}' +
    '.lwloc button:focus-visible{outline:2px solid #c9a050;outline-offset:2px}.lwloc .lwloc-go{background:#c9a050;border-color:#c9a050;color:#2a2a2a}.lwloc button[disabled]{opacity:.7;cursor:default}' +
    '.lwloc .lwloc-x{position:absolute;top:6px;right:6px;border:0;background:none;padding:6px 10px;font-size:20px;line-height:1;color:#5f5f5f;min-height:0}' +
    '@media(max-width:560px){.lwloc{left:12px;bottom:12px;width:auto;max-width:calc(100vw - 92px)}}' +
    '@media(prefers-reduced-motion:no-preference){.lwloc{animation:lwlocin .25s ease-out}@keyframes lwlocin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}';

  function start(win) {
    var doc = win.document;
    if (/^\/(admin|account)(\/|$)/.test(win.location.pathname) || win.top !== win.self) return; // not the admin or the member pages, and not inside another page
    var lang = /^fr/i.test(doc.documentElement.lang || '') ? 'fr' : 'en';
    var T = TEXT[lang];
    var counted = function (v) {
      try { if (win.sessionStorage.getItem(COUNTED + v)) return; win.sessionStorage.setItem(COUNTED + v, '1'); } catch (e) { /* counted every time */ }
      (win.lwq = win.lwq || []).push({ t: 'loc', v: v });
    };
    var store = (function () { try { return win.localStorage; } catch (e) { return { getItem: function () { return null; }, setItem: function () {} }; } })();
    var session = (function () { try { return win.sessionStorage; } catch (e) { return { getItem: function () { return null; }, setItem: function () {} }; } })();
    var loc = createLocator({
      nav: win.navigator, session: session, store: store, now: function () { return Date.now(); }, count: counted,
      emit: function (k) { try { win.dispatchEvent(new win.CustomEvent('lawdb:location', { detail: k })); } catch (e) { /* old browser: the search box reads the note itself */ } }
    });
    win.LawdbLocation = { get: loc.kept, ask: loc.ask, state: loc.state, on: loc.on, km: km };

    var card = null;
    function hide() { if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function show() {
      if (card || doc.getElementById('lwloc')) return;
      if (!doc.getElementById('lwloc-css')) { var st = doc.createElement('style'); st.id = 'lwloc-css'; st.textContent = CSS; doc.head.appendChild(st); }
      card = el('div', 'lwloc'); card.id = 'lwloc'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false'); card.setAttribute('aria-labelledby', 'lwloc-t'); card.setAttribute('aria-describedby', 'lwloc-b');
      var title = el('b', 'lwloc-t', T.title); title.id = 'lwloc-t';
      var body = el('p', 'lwloc-b', T.body); body.id = 'lwloc-b'; body.setAttribute('aria-live', 'polite');
      var go = el('button', 'lwloc-go', T.go); go.type = 'button';
      var no = el('button', '', T.later); no.type = 'button';
      var x = el('button', 'lwloc-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T.close);
      var row = el('div', 'lwloc-row'); row.appendChild(go); row.appendChild(no);
      card.appendChild(x); card.appendChild(title); card.appendChild(body); card.appendChild(row);
      doc.body.appendChild(card);
      function dismiss() { loc.later(); hide(); }
      no.addEventListener('click', dismiss); x.addEventListener('click', dismiss);
      card.addEventListener('keydown', function (e) { if (e.key === 'Escape') dismiss(); });
      go.addEventListener('click', function () {
        go.disabled = true; no.disabled = true; go.textContent = T.finding;
        loc.request().then(function (r) {
          card.removeChild(row); card.removeChild(title);
          body.textContent = r === 'yes' ? T.thanks : r === 'no' ? T.no : T.fail;
          body.style.margin = '0 18px 0 0';
          setTimeout(hide, r === 'yes' ? 3500 : 5000);
        });
      });
    }

    function run() {
      loc.onOpen().then(function (what) {
        if (what === 'auto') { loc.ask().then(function () { counted('auto'); }, function () { /* no position this time: nothing to show */ }); return; }
        if (what !== 'ask') return;
        if (ASK_STYLE === 'native') { loc.request(); return; }
        show();
      });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { setTimeout(run, 600); });
    else setTimeout(run, 600);
  }

  return { createLocator: createLocator, km: km, start: start, KEY: KEY, ASK: ASK, KEEP_MS: KEEP_MS, SNOOZE_MS: SNOOZE_MS, round3: round3 };
});
