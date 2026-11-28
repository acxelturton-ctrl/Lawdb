/* LawDB AI: a help bot on every public page. A round button at the bottom right opens a chat that reads what the visitor describes and shows matching
   firms (POST /api/ai/match). The chat is in English or French, as the visitor chooses. A page may hold a place for it (#aiMount); the chat moves into the panel when the button is used.
   Everything the server sends is written with textContent, never as HTML. Nothing typed here is sent anywhere but /api/ai/match; the chat is
   kept in this tab's sessionStorage only, so it follows the visitor from page to page and is gone when the tab closes. */
(function () {
  if (window.__lawdbAI) return;
  if (/^\/(admin|account)(\/|$)/.test(location.pathname)) return;
  window.__lawdbAI = true;

  var KEY = 'lawdb-ai-v1', NUDGE = 'lawdb-ai-nudge';
  var mount = document.getElementById('aiMount');
  var S = { texts: [], ctx: {}, events: [], busy: false };
  try { var sv = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (sv) { S.texts = sv.texts || []; S.ctx = sv.ctx || {}; S.events = sv.events || []; } } catch (e) {}
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ texts: S.texts.slice(-6), ctx: S.ctx, events: S.events.slice(-30) }, function (k, v) { return k === '_el' ? undefined : v; })); } catch (e) {} }
  var UI = {
    en: { greet: 'Hi! Tell me what’s going on in your own words, and where you are. I’ll find law firms that handle it.', suggest: ['I was rear-ended in Toronto', 'I need a divorce lawyer in Montreal', 'I was fired without notice in Calgary', 'Charged with impaired driving in Vancouver'],
      sub: 'Describe your situation. I’ll find the right firms.', ph: 'e.g. I was rear-ended in Toronto and need a lawyer', label: 'Describe your legal situation', launch: 'Ask LawDB AI', launchAria: 'Ask LawDB AI, the help bot', close: 'Close chat', toggle: 'FR', toggleAria: 'Passer au français',
      note: 'LawDB AI matches you with law firms. It can’t give legal advice, AI-generated information is general in nature, and using it doesn’t create a lawyer-client relationship. Featured firms are listed first. Please don’t share confidential details.',
      view: 'View profile', call: 'Call', ask: 'Request consultation', why: 'Why this matches: ', loc: 'Use my location', browse: 'Browse all lawyers', featured: 'Featured', verified: 'Verified',
      err: 'I couldn’t reach the matcher just now. You can still search by case type and city.', nogeo: 'Your browser can’t share a location. Type your city instead.', denied: 'No problem. Type your city, or pick one of the cities above.', nudge: 'Need a lawyer? Ask LawDB AI', dismiss: 'Dismiss' },
    fr: { greet: 'Bonjour! Racontez-moi ce qui se passe, dans vos propres mots, et où vous êtes. Je chercherai des cabinets d’avocats qui s’en occupent.', suggest: ['J’ai eu un accident de voiture à Montréal', 'Je cherche un avocat en divorce à Québec', 'J’ai été congédié sans préavis à Ottawa', 'Accusé de conduite avec facultés affaiblies à Laval'],
      sub: 'Décrivez votre situation. Je trouverai les bons cabinets.', ph: 'p. ex. J’ai eu un accident à Montréal et je cherche un avocat', label: 'Décrivez votre situation juridique', launch: 'Demandez à LawDB AI', launchAria: 'Demandez à LawDB AI, l’assistant', close: 'Fermer le clavardage', toggle: 'EN', toggleAria: 'Switch to English',
      note: 'LawDB AI vous met en relation avec des cabinets d’avocats. Il ne donne pas de conseils juridiques, l’information générée par l’IA est de nature générale et son utilisation ne crée pas de relation avocat-client. Les cabinets en vedette sont listés en premier. Veuillez ne pas partager de détails confidentiels.',
      view: 'Voir le profil', call: 'Appeler', ask: 'Demander une consultation', why: 'Pourquoi cela correspond : ', loc: 'Utiliser ma position', browse: 'Voir tous les avocats', featured: 'En vedette', verified: 'Vérifié',
      err: 'Je n’ai pas pu joindre le moteur de recherche pour le moment. Vous pouvez toujours chercher par type de dossier et par ville.', nogeo: 'Votre navigateur ne peut pas partager la position. Tapez votre ville.', denied: 'Pas de souci. Tapez votre ville ou choisissez l’une des villes ci-dessus.', nudge: 'Besoin d’un avocat? Demandez à LawDB AI', dismiss: 'Fermer' },
  };
  var lang = S.ctx.lang === 'fr' ? 'fr' : 'en';
  if (!S.ctx.lang) S.ctx.lang = lang;
  function t(k) { return UI[lang][k]; }
  var SPARK = 'M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7zM19 15l.9 2.4 2.4.9-2.4.9L19 21.6l-.9-2.4-2.4-.9 2.4-.9z';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(path, cls) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.appendChild(p); return s; }

  /* ---------- the chat itself ---------- */
  var card = el('div', 'aic aic-on'); card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'LawDB AI');
  var head = el('div', 'aic-head'), badge = el('span', 'aic-badge'); badge.appendChild(svg(SPARK));
  var htSub = el('small'); var ht = el('div'); ht.appendChild(el('b', null, 'LawDB AI')); ht.appendChild(htSub);
  var closeBtn = el('button', 'aic-x'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close chat'); closeBtn.textContent = '×';
  var langBtn = el('button', 'aic-lang'); langBtn.type = 'button';
  head.appendChild(badge); head.appendChild(ht); head.appendChild(langBtn); head.appendChild(closeBtn);
  var log = el('div', 'aic-log'); log.id = 'aiLog'; log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
  var form = el('form', 'aic-form'); form.autocomplete = 'off';
  var lab = el('label', 'aic-sr'); lab.htmlFor = 'aiInput';
  var input = el('textarea'); input.id = 'aiInput'; input.rows = 1; input.maxLength = 500;
  var send = el('button'); send.type = 'submit'; send.setAttribute('aria-label', 'Send');
  var arrow = svg('M5 12h14M13 6l6 6-6 6'); arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', 'currentColor'); arrow.setAttribute('stroke-width', '2.2'); arrow.setAttribute('stroke-linecap', 'round'); arrow.setAttribute('stroke-linejoin', 'round'); send.appendChild(arrow);
  form.appendChild(lab); form.appendChild(input); form.appendChild(send);
  var note = el('p', 'aic-note');
  card.appendChild(head); card.appendChild(log); card.appendChild(form); card.appendChild(note);

  function scroll() { log.scrollTop = log.scrollHeight; }
  function initials(n) { var w = String(n || '').split(/\W+/).filter(Boolean); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase(); }

  // one renderer per kind of event; `still` is true when a saved chat is put back (no animation)
  function drawBubble(ev, still) { var b = el('div', 'aic-msg ' + (ev.w === 'me' ? 'aic-me' : 'aic-bot') + (still ? ' still' : ''), ev.t); log.appendChild(b); }
  function drawSafety(ev) { var s = el('div', 'aic-safety', ev.t); s.setAttribute('role', 'alert'); log.appendChild(s); }
  function drawChips(ev) {
    var wrap = el('div', 'aic-chips' + (ev.used ? ' used' : ''));
    (ev.list || []).forEach(function (c) {
      var b = el('button', 'aic-chip' + (c.active ? ' on' : ''), c.label); b.type = 'button';
      b.addEventListener('click', function () { choose(c.label, c.pick, c.text); });
      wrap.appendChild(b);
    });
    if (ev.locate) { var l = el('button', 'aic-chip loc', t('loc')); l.type = 'button'; l.addEventListener('click', locate); wrap.appendChild(l); }
    if (ev.browse) { var a = el('a', 'aic-chip', t('browse')); a.href = '/find-lawyers'; wrap.appendChild(a); }
    ev._el = wrap; log.appendChild(wrap);
  }
  function logo(f) {
    var l = el('span', 'aic-logo');
    if (/^(https:\/\/|\/(images\/logos|img)\/)/.test(f.logo || '')) { var i = new Image(); i.src = f.logo; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.onerror = function () { i.remove(); l.textContent = initials(f.name); }; l.appendChild(i); }
    else l.textContent = initials(f.name);
    return l;
  }
  function drawFirms(ev, still) {
    var wrap = el('div', 'aic-firms');
    ev.list.forEach(function (f) {
      var c = el('article', 'aic-firm' + (still ? ' still' : '')), top = el('div', 'aic-firm-top'), body = el('div');
      var name = el('b', null, f.name); if (f.featured) name.appendChild(el('span', null, t('featured'))); body.appendChild(name);
      body.appendChild(el('small', null, f.city + ', ' + f.province + (f.tags && f.tags.length ? ' · ' + f.tags.join(', ') : '')));
      top.appendChild(logo(f)); top.appendChild(body); c.appendChild(top);
      var pills = el('div', 'aic-pills');
      if (f.verified) pills.appendChild(el('span', 'v', t('verified')));
      if (pills.childNodes.length) c.appendChild(pills);
      if (f.why) c.appendChild(el('small', 'aic-why', t('why') + f.why));
      if (f.blurb) c.appendChild(el('p', null, f.blurb));
      var btns = el('div', 'aic-btns');
      var v = el('a', 'go', t('view')); v.href = '/firm/' + encodeURIComponent(f.handle || f.slug); btns.appendChild(v);
      if (f.phone) { var p = el('a', 'call', t('call')); p.href = 'tel:' + f.phone; btns.appendChild(p); }
      var q = el('a', 'ask', t('ask')); q.href = '/firm/' + encodeURIComponent(f.handle || f.slug) + (ev.summary ? '?ask=' + encodeURIComponent(ev.summary) + (lang === 'fr' ? '&lang=fr' : '') : '') + '#contact'; btns.appendChild(q);
      c.appendChild(btns); wrap.appendChild(c);
    });
    log.appendChild(wrap);
  }
  function draw(ev, still) { if (ev.k === 'b') drawBubble(ev, still); else if (ev.k === 'safe') drawSafety(ev); else if (ev.k === 'chips') drawChips(ev); else if (ev.k === 'firms') drawFirms(ev, still); }
  function add(ev) { S.events.push(ev); draw(ev, false); scroll(); save(); }
  function retire() { S.events.forEach(function (e) { if (e.k === 'chips' && !e.used) { e.used = true; if (e._el) e._el.classList.add('used'); } }); }
  function typing(on) {
    var t = log.querySelector('.aic-typing-wrap');
    if (on && !t) { t = el('div', 'aic-msg aic-bot aic-typing-wrap'); var d = el('span', 'aic-typing'); d.appendChild(el('i')); d.appendChild(el('i')); d.appendChild(el('i')); t.appendChild(d); log.appendChild(t); scroll(); }
    if (!on && t) t.remove();
  }

  /* ---------- talking to the server ---------- */
  function setLang(l) { if (l !== 'fr' && l !== 'en') return; lang = l; S.ctx.lang = l; applyLang(); save(); }
  function render(j) {
    S.ctx = j.ctx || S.ctx;
    if (S.ctx.lang && S.ctx.lang !== lang) setLang(S.ctx.lang);
    if (j.safety) add({ k: 'safe', t: j.safety.text });
    if (j.reply) add({ k: 'b', w: 'bot', t: j.reply });
    if (j.firms && j.firms.length) add({ k: 'firms', list: j.firms, summary: (S.ctx && S.ctx.summary) || '' });
    if (j.ask && j.ask.chips) add({ k: 'chips', list: j.ask.chips, locate: !!j.ask.locate });
    if (j.offerLang === 'fr') add({ k: 'chips', list: [{ label: 'Passer au fran\u00e7ais', pick: { lang: 'fr' } }] });
  }
  function post(payload) {
    S.busy = true; send.disabled = true; typing(true);
    fetch('/api/ai/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { typing(false); if (!x.ok) throw new Error((x.j && x.j.error) || 'error'); render(x.j); })
      .catch(function (e) {
        typing(false);
        add({ k: 'b', w: 'bot', t: /Too many/.test(e.message) ? e.message : t('err') });
        add({ k: 'chips', list: [], browse: true });
      })
      .then(function () { S.busy = false; send.disabled = false; });
  }
  function choose(label, pick, text) {
    if (S.busy) return;
    retire(); add({ k: 'b', w: 'me', t: label });
    if (text) { S.texts.push({ role: 'user', content: text }); post({ messages: S.texts.slice(-6), context: S.ctx }); }
    else post({ messages: [], context: S.ctx, pick: pick });
  }
  function ask(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text || S.busy) return;
    retire(); add({ k: 'b', w: 'me', t: text }); S.texts.push({ role: 'user', content: text }); input.value = ''; grow();
    post({ messages: S.texts.slice(-6), context: S.ctx });
  }
  function locate() {
    if (!navigator.geolocation) { add({ k: 'b', w: 'bot', t: t('nogeo') }); return; }
    retire(); add({ k: 'b', w: 'me', t: t('loc') }); typing(true);
    navigator.geolocation.getCurrentPosition(function (p) { typing(false); post({ messages: [], context: S.ctx, pick: { lat: p.coords.latitude, lng: p.coords.longitude } }); },
      function () { typing(false); add({ k: 'b', w: 'bot', t: t('denied') }); }, { timeout: 9000, maximumAge: 600000 });
  }
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; }
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  input.addEventListener('input', grow);

  // a saved chat is put back; a new one starts with a greeting and a few examples
  if (S.events.length) S.events.forEach(function (e) { draw(e, true); });
  else {
    add({ k: 'b', w: 'bot', t: 'Welcome! Choose your language to start. / Bienvenue! Choisissez votre langue pour commencer.' });
    add({ k: 'chips', list: [{ label: 'English', pick: { lang: 'en' } }, { label: 'Fran\u00e7ais', pick: { lang: 'fr' } }] });
  }
  function applyLang() {
    htSub.textContent = t('sub'); input.placeholder = t('ph'); lab.textContent = t('label'); note.textContent = t('note');
    langBtn.textContent = t('toggle'); langBtn.setAttribute('aria-label', t('toggleAria')); closeBtn.setAttribute('aria-label', t('close'));
    if (typeof launch !== 'undefined') { launch.setAttribute('aria-label', t('launchAria')); launch.title = t('launch'); launch.lastChild.textContent = t('launch'); }
    document.documentElement.setAttribute('data-aic-lang', lang);
  }
  langBtn.addEventListener('click', function () { if (S.busy) return; var next = lang === 'fr' ? 'en' : 'fr'; retire(); setLang(next); post({ messages: [], context: S.ctx, pick: { lang: next } }); });
  applyLang();
  scroll();

  /* ---------- the button and the panel ---------- */
  var launch = el('button', 'aic-launch'); launch.type = 'button'; launch.setAttribute('aria-label', t('launchAria')); launch.setAttribute('aria-expanded', 'false');
  launch.title = t('launch'); launch.appendChild(svg(SPARK)); launch.appendChild(el('i', null, 'AI')); launch.appendChild(el('span', null, t('launch')));
  var panel = el('div', 'aic-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'LawDB AI help bot');
  var nudge = null;
  document.body.appendChild(launch); document.body.appendChild(panel);
  document.body.classList.add('aic-ready');
  if (mount) mount.appendChild(card); else { card.classList.add('aic-float'); panel.appendChild(card); }

  function isOpen() { return panel.classList.contains('open'); }
  function open() {
    if (nudge) { nudge.remove(); nudge = null; }
    try { sessionStorage.setItem(NUDGE, '1'); } catch (e) {}
    card.classList.add('aic-float'); panel.appendChild(card);
    panel.classList.add('open'); launch.setAttribute('aria-expanded', 'true'); launch.classList.add('hide');
    document.documentElement.classList.add('aic-lock'); scroll();
    setTimeout(function () { input.focus({ preventScroll: true }); }, 60);
  }
  function close() {
    panel.classList.remove('open'); launch.setAttribute('aria-expanded', 'false'); document.documentElement.classList.remove('aic-lock');
    if (mount) { card.classList.remove('aic-float'); mount.appendChild(card); watch(); } else launch.classList.remove('hide');
    launch.focus({ preventScroll: true });
  }
  launch.addEventListener('click', open);
  if (window.__aiOpenPending) { window.__aiOpenPending = false; open(); } // the menu item was used before this file had loaded
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-open-ai]'); if (!a) return;
    e.preventDefault();
    var d = document.getElementById('menuDrawer'), o = document.getElementById('menuOverlay'); if (d) d.classList.remove('open'); if (o) o.classList.remove('open');
    if (!isOpen()) open();
  });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });

  // on the home page the hero already shows the chat, so the button waits until the hero is scrolled away
  var io = null;
  function watch() {
    if (!mount || !('IntersectionObserver' in window)) { launch.classList.remove('hide'); return; }
    if (!io) io = new IntersectionObserver(function (es) { if (!isOpen()) launch.classList.toggle('hide', es[0].isIntersecting); }, { threshold: 0.15 });
    io.disconnect(); io.observe(mount);
  }
  if (mount) { launch.classList.add('hide'); watch(); }

  // a small hint, once per visit, after a few seconds, on pages where the chat is not already in view
  if (!mount) {
    var seen = false; try { seen = sessionStorage.getItem(NUDGE) === '1' || S.events.length > 2; } catch (e) {}
    if (!seen) setTimeout(function () {
      if (isOpen() || document.hidden) return;
      nudge = el('div', 'aic-nudge'); nudge.appendChild(el('span', null, t('nudge')));
      var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', t('dismiss')); x.addEventListener('click', function (e) { e.stopPropagation(); nudge.remove(); nudge = null; try { sessionStorage.setItem(NUDGE, '1'); } catch (er) {} });
      nudge.appendChild(x); nudge.addEventListener('click', open); document.body.appendChild(nudge);
    }, 7000);
  }
})();
