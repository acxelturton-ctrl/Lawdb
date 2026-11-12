/* City and case-type pages. Loaded with city-pages.css after site.js. The page is complete without this file (a table of firms, the numbers, the text);
   this turns it into a list people can search and sort, with each firm's logo, next to a map of the streets the firms are on, and fades things in as they
   are scrolled to.
     - Case-type page (<body data-city data-prov data-type>): reads the baked table, then asks /api/firms for the city's current list, so a firm that
       listed itself, was renamed, got a logo or became Featured after the page was built shows up straight away. If that request fails the baked table is used.
     - City hub (.seo-city): count-up numbers and fade-ins only.
   The map is a drawing, not a surface map: each street that has two or more of the page's firms is a district, with the firms on it as pins; the rest
   share an "Other streets" district. Streets come from the firms' addresses (which are exact), not from their coordinates (many of which are approximate).
   Nothing here sends anything about the visitor. */
(function () {
  'use strict';
  var D = document, B = D.body, NS = 'http://www.w3.org/2000/svg';
  var RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var PAGE = 12;
  var MAP_MIN = 5; /* fewer firms than this and the map adds nothing */

  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var fmt = function (n) { return Number(n).toLocaleString('en-CA'); };
  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  var prettyPhone = function (p) { var d = digits(p).slice(-10); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; };
  var rated = function (f) { return f.rating > 0; };
  var initials = function (name) {
    var t = String(name).split(/[\s&,.\-/()]+/).filter(function (w) { return /[A-Za-zÀ-ɏЀ-ӿ぀-鿿]/.test(w) && !/^(the|and|of|law|llp|lp|pc|professional|corporation)$/i.test(w); });
    if (!t.length) t = String(name).split(/\s+/);
    var a = (t[0] || '?').charAt(0), b = t.length > 1 ? t[1].charAt(0) : '';
    return (a + b).toUpperCase();
  };
  var rank = function (a, b) {
    return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.rating - a.rating || b.count - a.count || a.name.localeCompare(b.name);
  };
  var svgEl = function (name, attrs, parent) {
    var e = D.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---------- motion helpers ---------- */
  function countUp(el) {
    var target = el._t != null ? el._t : el.textContent;
    var m = String(target).match(/^([\d,]*\.?\d+)$/);
    if (!m || RM) { el.textContent = target; return; }
    var end = parseFloat(m[1].replace(/,/g, '')), dec = (m[1].split('.')[1] || '').length, t0 = null, dur = 1100;
    el.textContent = dec ? (0).toFixed(dec) : '0';
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var live = el._t != null ? el._t : target;
      var mm = String(live).match(/^([\d,]*\.?\d+)$/); if (mm) end = parseFloat(mm[1].replace(/,/g, ''));
      el.textContent = p < 1 ? (dec ? (end * e).toFixed(dec) : fmt(Math.round(end * e))) : String(live);
      if (p < 1) requestAnimationFrame(step); else el._done = true;
    }
    requestAnimationFrame(step);
  }
  function whenSeen(els, fn, opts) {
    if (!els.length) return;
    if (RM || !('IntersectionObserver' in window)) { els.forEach(fn); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); fn(en.target); } }); }, opts || { threshold: 0.15 });
    els.forEach(function (e) { io.observe(e); });
  }
  /* things below the fold fade up as they arrive (site.css .rv / .in, the same motion as the home page) */
  function reveal(sel, root) {
    if (RM || !('IntersectionObserver' in window)) return;
    var vh = window.innerHeight, list = [].slice.call((root || D).querySelectorAll(sel)).filter(function (e) { return !e.classList.contains('rv') && e.getBoundingClientRect().top > vh * 0.92; });
    if (!list.length) return;
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }); }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    list.forEach(function (e) { var sib = [].indexOf.call(e.parentNode.children, e); e.style.setProperty('--rvd', (Math.min(sib % 4, 3) * 0.07) + 's'); e.classList.add('rv'); io.observe(e); });
    setTimeout(function () { [].forEach.call(D.querySelectorAll('.rv:not(.in)'), function (e) { if (e.getBoundingClientRect().top < window.innerHeight) e.classList.add('in'); }); }, 2500);
  }
  function statCountUps() {
    var bs = [].slice.call(D.querySelectorAll('.seo-stats b'));
    bs.forEach(function (b) { b._t = b.textContent; });
    whenSeen(bs, function (b) { countUp(b); });
  }

  /* ---------- the baked table -> firms ---------- */
  function fromTable() {
    var rows = [].slice.call(D.querySelectorAll('.seo-table tbody tr')), out = [];
    rows.forEach(function (tr) {
      var td = tr.children, a = td[0] && td[0].querySelector('a');
      if (!a) return;
      var rt = parseFloat(td[1].textContent), ct = parseInt(td[2].textContent.replace(/\D/g, ''), 10);
      out.push({
        slug: (a.getAttribute('href') || '').replace(/^\/firms\//, ''), name: a.textContent.trim(), featured: !!td[0].querySelector('.seo-feat'),
        rating: isNaN(rt) ? 0 : rt, count: isNaN(ct) ? 0 : ct, address: td[3].textContent.trim(), phone: td[4].textContent.trim(), tags: [], logo: ''
      });
    });
    return out;
  }
  var same = function (a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].slug !== b[i].slug || a[i].rating !== b[i].rating || a[i].count !== b[i].count || !!a[i].featured !== !!b[i].featured || a[i].name !== b[i].name) return false;
    return true;
  };

  /* ---------- streets: "199 Bay St #5300, Toronto, ON ..." -> "Bay St" ---------- */
  var ABBR = { street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', west: 'w', east: 'e', north: 'n', south: 's' };
  function streetLabel(address) {
    var s = String(address || '').split(',')[0]
      .replace(/\s+\d+(?:st|nd|rd|th)\s+(?:Floor|Fl)\b.*$/i, '').replace(/\s+(?:#|Suite|Ste|Unit|Floor|Fl)\b.*$/i, '')
      .replace(/^(?:#?\s*\d+[A-Za-z]*\s*[-–]\s*)?\d+[A-Za-z-]*\s+/, '').replace(/\s+/g, ' ').trim();
    return /^[A-Za-zÀ-ɏ]/.test(s) && s.length > 3 ? s : '';
  }
  function streetKey(address) {
    return streetLabel(address).toLowerCase().replace(/\./g, '').split(' ').map(function (w) { return ABBR[w] || w; }).join(' ');
  }
  /* districts: up to four streets that have two or more firms, then everything else */
  function zonesFor(firms) {
    var groups = {}, order = [];
    firms.forEach(function (f) {
      f._street = streetLabel(f.address); var k = streetKey(f.address);
      if (!k) return;
      if (!groups[k]) { groups[k] = { key: k, label: f._street, items: [] }; order.push(k); }
      groups[k].items.push(f);
    });
    var multi = order.map(function (k) { return groups[k]; }).filter(function (g) { return g.items.length >= 2; })
      .sort(function (a, b) { return b.items.length - a.items.length || a.label.localeCompare(b.label); }).slice(0, 4);
    var inTop = {}; multi.forEach(function (g) { g.items.forEach(function (f) { inTop[f.slug] = 1; }); });
    var rest = firms.filter(function (f) { return !inTop[f.slug]; });
    var zones = multi.map(function (g) { return { key: g.key, label: g.label, items: g.items.slice() }; });
    if (rest.length) zones.push({ key: 'other', label: multi.length ? 'Other streets' : 'All firms', items: rest });
    zones.sort(function (a, b) { return b.items.length - a.items.length || (a.key === 'other' ? 1 : -1); });
    zones.forEach(function (z) { z.items.forEach(function (f) { f._zone = z.key; }); });
    return zones;
  }
  /* where the districts sit on the drawing (viewBox 600 x 760), biggest first */
  var LAYOUTS = {
    1: [{ x: 300, y: 380, rx: 255, ry: 230 }],
    2: [{ x: 300, y: 520, rx: 250, ry: 150 }, { x: 300, y: 215, rx: 250, ry: 125 }],
    3: [{ x: 300, y: 500, rx: 250, ry: 140 }, { x: 165, y: 250, rx: 130, ry: 95 }, { x: 435, y: 250, rx: 130, ry: 95 }],
    4: [{ x: 300, y: 600, rx: 250, ry: 125 }, { x: 165, y: 395, rx: 130, ry: 92 }, { x: 435, y: 395, rx: 130, ry: 92 }, { x: 300, y: 195, rx: 175, ry: 85 }],
    5: [{ x: 300, y: 612, rx: 250, ry: 122 }, { x: 165, y: 385, rx: 130, ry: 90 }, { x: 435, y: 385, rx: 130, ry: 90 }, { x: 165, y: 185, rx: 130, ry: 85 }, { x: 435, y: 185, rx: 130, ry: 85 }]
  };

  /* ---------- rendering ---------- */
  function stars(r) { return '<span class="cp-stars" role="img" aria-label="' + r.toFixed(1) + ' out of 5 stars"><i data-w="' + Math.round(r / 5 * 100) + '"></i></span>'; }
  function logoTile(f, cls) {
    return '<span class="cp-lg ' + (cls || '') + (f.logo ? '' : ' cp-lgm') + '">' + (f.logo
      ? '<img class="cp-lgi" src="' + esc(f.logo) + '" alt="" loading="lazy" decoding="async" data-mono="' + esc(initials(f.name)) + '">'
      : '<b class="cp-mono" aria-hidden="true">' + esc(initials(f.name)) + '</b>') + '</span>';
  }
  function card(f) {
    var ph = prettyPhone(f.phone), tags = (f.tags || []).filter(Boolean).slice(0, 3);
    var rate = rated(f)
      ? '<div class="cp-rate">' + stars(f.rating) + '<b>' + f.rating.toFixed(1) + '</b><span>' + fmt(f.count) + ' Google review' + (f.count === 1 ? '' : 's') + '</span></div>'
      : '<div class="cp-rate"><span>No Google rating on LawDB yet</span></div>';
    return '<article class="cp-card' + (f.featured ? ' cp-feat' : '') + '" data-slug="' + esc(f.slug) + '">'
      + logoTile(f)
      + '<div class="cp-body">' + (f._street ? '<div class="cp-street">' + esc(f._street) + '</div>' : '')
      + '<h3><a class="cp-link" href="/firms/' + esc(f.slug) + '">' + esc(f.name) + '</a>' + (f.featured ? '<span class="seo-feat">Featured</span>' : (!rated(f) ? '<span class="cp-new">New</span>' : '')) + '</h3>'
      + rate + (f.address ? '<p class="cp-addr">' + esc(f.address) + '</p>' : '')
      + (tags.length ? '<div class="cp-tags">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : '') + '</div>'
      + (ph ? '<a class="cp-call" href="tel:+1' + digits(f.phone).slice(-10) + '">Call ' + esc(ph) + '</a>' : '')
      + '</article>';
  }
  /* widths and delays are set through the style object, not inline attributes, so the markup carries no inline styles */
  function paint(root) {
    [].forEach.call(root.querySelectorAll('[data-w]'), function (e) { e.style.setProperty('--w', e.getAttribute('data-w') + '%'); });
  }

  function enhance() {
    var wrap = D.querySelector('.wrap'), tableWrap = D.querySelector('.seo-tablewrap'), h2 = tableWrap && tableWrap.previousElementSibling;
    if (!wrap || !tableWrap || !h2) return;
    var base = fromTable();
    if (!base.length) return;
    var city = B.getAttribute('data-city'), prov = B.getAttribute('data-prov'), type = B.getAttribute('data-type');
    var firms = base, zones = [], st = { q: '', sort: 'rec', hi: false, rev: false, feat: false, zone: '', shown: PAGE, view: 'cards' };

    var tools = D.createElement('div');
    tools.className = 'cp-tools';
    tools.innerHTML = '<label class="cp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" placeholder="Search by firm, street or focus" aria-label="Search these firms" autocomplete="off"></label>'
      + '<select class="cp-select" aria-label="Sort firms"><option value="rec">Recommended</option><option value="rating">Highest rated</option><option value="reviews">Most reviews</option><option value="az">A to Z</option></select>'
      + '<div class="cp-view" role="group" aria-label="View"><button type="button" data-v="cards" aria-pressed="true">Cards</button><button type="button" data-v="table" aria-pressed="false">Table</button></div>'
      + '<div class="cp-pills"><span class="cp-zones" role="group" aria-label="Streets"></span><button type="button" class="cp-pill" data-f="hi" aria-pressed="false">4.5 stars and up</button><button type="button" class="cp-pill" data-f="rev" aria-pressed="false">10+ reviews</button><button type="button" class="cp-pill" data-f="feat" aria-pressed="false" hidden>Featured partners</button></div>';
    var split = D.createElement('div'); split.className = 'cp-split';
    var left = D.createElement('div'); left.className = 'cp-left';
    var count = D.createElement('p'); count.className = 'cp-count'; count.setAttribute('aria-live', 'polite');
    var list = D.createElement('div'); list.className = 'cp-list';
    var more = D.createElement('button'); more.type = 'button'; more.className = 'cp-more'; more.hidden = true;
    left.appendChild(count); left.appendChild(list); left.appendChild(more); split.appendChild(left);
    var mapBox = null;
    h2.id = h2.id || 'cp-firms';
    h2.insertAdjacentElement('afterend', tools);
    tools.insertAdjacentElement('afterend', split);
    tableWrap.hidden = true;
    B.classList.add('cp-ready');

    var q = tools.querySelector('input'), sel = tools.querySelector('select');
    var pillFeat = tools.querySelector('[data-f="feat"]'), zoneBox = tools.querySelector('.cp-zones');

    function view() {
      var out = firms.filter(function (f) {
        if (st.zone && f._zone !== st.zone) return false;
        if (st.hi && !(f.rating >= 4.5)) return false;
        if (st.rev && !(f.count >= 10)) return false;
        if (st.feat && !f.featured) return false;
        if (st.q) { var hay = (f.name + ' ' + (f.address || '') + ' ' + (f.tags || []).join(' ')).toLowerCase(); if (hay.indexOf(st.q) < 0) return false; }
        return true;
      });
      if (st.sort === 'rating') out.sort(function (a, b) { return (rated(b) - rated(a)) || b.rating - a.rating || b.count - a.count; });
      else if (st.sort === 'reviews') out.sort(function (a, b) { return b.count - a.count || b.rating - a.rating; });
      else if (st.sort === 'az') out.sort(function (a, b) { return a.name.localeCompare(b.name); });
      else out.sort(rank);
      return out;
    }
    var drawnFrom = 0;
    function draw(append) {
      var v = view(), n = v.length <= 24 ? v.length : Math.min(st.shown, v.length); /* a short list is shown whole: no firm hides behind a button */
      if (!append) { list.innerHTML = ''; drawnFrom = 0; }
      var html = '';
      for (var i = drawnFrom; i < n; i++) html += card(v[i]);
      if (html) {
        var tmp = D.createElement('div'); tmp.innerHTML = html;
        [].slice.call(tmp.children).forEach(function (c, k) { paint(c); c.style.setProperty('--cpd', (Math.min(k, 8) * 0.045) + 's'); list.appendChild(c); });
      }
      drawnFrom = n;
      if (!v.length) list.innerHTML = '<div class="cp-empty">No firms match that search. <br><button type="button" class="cp-pill" data-clear>Clear filters</button></div>';
      count.innerHTML = 'Showing <b>' + n + '</b> of <b>' + v.length + '</b> ' + (v.length === firms.length ? 'firms' : 'matching firms') + (v.length !== firms.length ? ' (out of ' + firms.length + ')' : '');
      more.hidden = n >= v.length;
      if (!more.hidden) more.textContent = 'Show ' + Math.min(PAGE, v.length - n) + ' more firm' + (Math.min(PAGE, v.length - n) === 1 ? '' : 's');
      syncMap(v);
    }

    /* ---- the map ---- */
    var pins = {}, zoneEls = {}, tip = null;
    function buildMap() {
      zones = zonesFor(firms);
      var showMap = firms.length >= MAP_MIN && !!zones.length;
      split.classList.toggle('cp-nomap', !showMap);
      if (mapBox) { mapBox.remove(); mapBox = null; }
      pins = {}; zoneEls = {};
      /* zone chips */
      var multi = zones.filter(function (z) { return z.key !== 'other'; }).length > 0;
      zoneBox.innerHTML = multi ? '<button type="button" class="cp-pill cp-z" data-z="" aria-pressed="' + (st.zone === '') + '">All <span>' + firms.length + '</span></button>' + zones.map(function (z) {
        return '<button type="button" class="cp-pill cp-z" data-z="' + esc(z.key) + '" aria-pressed="' + (st.zone === z.key) + '">' + esc(z.label) + ' <span>' + z.items.length + '</span></button>';
      }).join('') : '';
      if (st.zone && !zones.some(function (z) { return z.key === st.zone; })) st.zone = '';
      pillFeat.hidden = !firms.some(function (f) { return f.featured; });
      if (!showMap) return;
      mapBox = D.createElement('aside'); mapBox.className = 'cp-map'; mapBox.setAttribute('aria-label', 'Map of the streets these firms are on');
      var svg = svgEl('svg', { viewBox: '0 0 600 760', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
      mapBox.appendChild(svg);
      svgEl('text', { x: 300, y: 742, class: 'cp-city', 'text-anchor': 'middle' }, svg).textContent = city || '';
      for (var i = 0; i < 12; i++) svgEl('line', { x1: 30 + i * 52, y1: 0, x2: i * 52 - 30, y2: 760, class: 'cp-st' }, svg);
      for (var j = 0; j < 12; j++) svgEl('line', { x1: 0, y1: 40 + j * 62, x2: 600, y2: 40 + j * 62 + (j % 2 ? 8 : -8), class: 'cp-st' }, svg);
      var slots = LAYOUTS[Math.min(zones.length, 5)];
      zones.slice(0, slots.length).forEach(function (z, zi) {
        var s = slots[zi], g = svgEl('g', {}, svg);
        var e = svgEl('ellipse', { cx: s.x, cy: s.y, rx: s.rx, ry: s.ry, class: 'cp-zone' }, g);
        var lab = svgEl('text', { x: s.x, y: s.y - s.ry + 22, 'text-anchor': 'middle', class: 'cp-zl' }, g); lab.textContent = z.label;
        e.addEventListener('click', function () { setZone(st.zone === z.key ? '' : z.key); });
        zoneEls[z.key] = { e: e, l: lab };
        /* the firms, spread evenly through the district; the pins shrink as a district fills up */
        var n = z.items.length, ax = s.rx * 0.74, ay = s.ry * 0.62, spacing = Math.sqrt(Math.PI * ax * ay / Math.max(1, n)) * 0.86;
        var pr = Math.max(6, Math.min(19, spacing * 0.5)), withLogo = pr >= 12;
        z.items.forEach(function (f, k) {
          var rr = Math.sqrt((k + 0.5) / n), th = k * 2.39996;
          var og = svgEl('g', { transform: 'translate(' + (s.x + Math.cos(th) * rr * ax).toFixed(1) + ' ' + (s.y + 12 + Math.sin(th) * rr * ay).toFixed(1) + ')' }, svg);
          var pg = svgEl('g', { class: 'cp-pin' + (rated(f) ? '' : ' nr') }, og);
          svgEl('circle', { r: pr + 9, class: 'cp-halo' }, pg);
          svgEl('circle', { r: pr, class: 'cp-pb' }, pg);
          if (withLogo && f.logo) svgEl('image', { href: f.logo, x: -pr * 0.7, y: -pr * 0.7, width: pr * 1.4, height: pr * 1.4, preserveAspectRatio: 'xMidYMid meet' }, pg);
          else if (withLogo) svgEl('text', { y: 3.5, class: 'cp-pt' }, pg).textContent = initials(f.name);
          og.addEventListener('mouseenter', function () { hot(f); });
          og.addEventListener('mouseleave', function () { hot(null); });
          og.addEventListener('click', function () { hot(f); var c = list.querySelector('[data-slug="' + f.slug + '"]'); if (c) c.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' }); });
          if (!RM) { og.style.opacity = '0'; setTimeout(function () { og.style.transition = 'opacity .5s'; og.style.opacity = '1'; }, 150 + (zi * 5 + k) * 45); }
          pins[f.slug] = { og: og, pg: pg };
        });
      });
      tip = D.createElement('div'); tip.className = 'cp-pop'; mapBox.appendChild(tip);
      var chip = D.createElement('div'); chip.className = 'cp-chip'; mapBox.appendChild(chip);
      var cta = D.createElement('a'); cta.className = 'cp-maplink'; cta.href = '/list-your-firm';
      cta.innerHTML = 'Own a firm in ' + esc(city || 'this city') + '? <b>List it free &rarr;</b>'; mapBox.appendChild(cta);
      split.appendChild(mapBox);
    }
    function syncMap(v) {
      if (!mapBox) return;
      var on = {}; v.forEach(function (f) { on[f.slug] = 1; });
      Object.keys(pins).forEach(function (k) { pins[k].pg.classList.toggle('dim', !on[k]); });
      Object.keys(zoneEls).forEach(function (k) { zoneEls[k].e.classList.toggle('on', st.zone === k); zoneEls[k].l.classList.toggle('on', st.zone === k); });
      var chip = mapBox.querySelector('.cp-chip');
      var zl = zones.filter(function (z) { return z.key === st.zone; })[0];
      chip.innerHTML = '<b>' + v.length + '</b> firm' + (v.length === 1 ? '' : 's') + (zl && zl.key !== 'other' ? ' on ' + esc(zl.label) : (city ? ' in ' + esc(city) : ''));
    }
    function hot(f) {
      Object.keys(pins).forEach(function (k) { pins[k].pg.classList.toggle('hot', !!f && f.slug === k); });
      [].forEach.call(list.querySelectorAll('.cp-card'), function (c) { c.classList.toggle('hot', !!f && c.getAttribute('data-slug') === f.slug); });
      if (!tip) return;
      if (!f) { tip.classList.remove('on'); return; }
      if (pins[f.slug]) pins[f.slug].og.parentNode.appendChild(pins[f.slug].og);
      tip.innerHTML = logoTile(f) + '<div><div class="cp-street">' + esc(f._street || '') + '</div><h4>' + esc(f.name) + '</h4><p>' + (rated(f) ? f.rating.toFixed(1) + ' &#9733; from ' + fmt(f.count) + ' Google reviews' : 'New on LawDB') + (f.address ? '<br>' + esc(f.address) : '') + '</p></div>';
      tip.classList.add('on');
    }
    function setZone(k) {
      st.zone = k; st.shown = PAGE;
      [].forEach.call(zoneBox.querySelectorAll('.cp-z'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-z') === k)); });
      draw(false);
    }

    /* controls */
    var timer;
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { st.q = q.value.trim().toLowerCase(); st.shown = PAGE; draw(false); }, 120); });
    sel.addEventListener('change', function () { st.sort = sel.value; st.shown = PAGE; draw(false); });
    tools.addEventListener('click', function (e) {
      var z = e.target.closest('.cp-z'), p = e.target.closest('.cp-pill[data-f]'), v = e.target.closest('.cp-view button');
      if (z) setZone(z.getAttribute('data-z') === st.zone ? '' : z.getAttribute('data-z'));
      if (p) { var k = p.getAttribute('data-f'); st[k] = !st[k]; p.setAttribute('aria-pressed', String(st[k])); st.shown = PAGE; draw(false); }
      if (v) {
        st.view = v.getAttribute('data-v');
        [].forEach.call(tools.querySelectorAll('.cp-view button'), function (b) { b.setAttribute('aria-pressed', String(b === v)); });
        var t = st.view === 'table'; tableWrap.hidden = !t; split.hidden = t;
        if (!t) draw(false);
      }
    });
    list.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) {
        st.q = ''; st.hi = st.rev = st.feat = false; st.zone = ''; q.value = ''; st.shown = PAGE;
        [].forEach.call(tools.querySelectorAll('.cp-pill[data-f]'), function (b) { b.setAttribute('aria-pressed', 'false'); });
        [].forEach.call(zoneBox.querySelectorAll('.cp-z'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-z') === '')); });
        draw(false);
      }
    });
    list.addEventListener('mouseover', function (e) { var c = e.target.closest('.cp-card'); if (c) { var f = firms.filter(function (x) { return x.slug === c.getAttribute('data-slug'); })[0]; if (f) hot(f); } });
    list.addEventListener('mouseleave', function () { hot(null); });
    /* a logo that fails to load turns into the firm's initials */
    list.addEventListener('error', function (e) {
      var im = e.target; if (!im || im.tagName !== 'IMG') return;
      var b = D.createElement('b'); b.className = 'cp-mono'; b.textContent = im.getAttribute('data-mono') || ''; if (im.parentNode) im.parentNode.classList.add('cp-lgm'); im.replaceWith(b);
    }, true);
    more.addEventListener('click', function () { st.shown += PAGE; draw(true); });

    buildMap(); draw(false);

    /* the live list: same city, same case type */
    function setStats(arr) {
      var r = arr.filter(rated), cells = D.querySelectorAll('.wrap .seo-stats b');
      if (cells.length < 4) return;
      var vals = [String(arr.length), r.length ? (r.reduce(function (a, f) { return a + f.rating; }, 0) / r.length).toFixed(1) : '0.0', fmt(arr.reduce(function (a, f) { return a + (f.count || 0); }, 0)), String(arr.filter(function (f) { return f.rating >= 4.5; }).length)];
      vals.forEach(function (v, i) { cells[i]._t = v; if (cells[i]._done || RM || !('IntersectionObserver' in window)) cells[i].textContent = v; });
    }
    if (!window.fetch || !prov || !city || !type) return;
    fetch('/api/firms?province=' + encodeURIComponent(prov) + '&city=' + encodeURIComponent(city) + '&limit=500', { headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (all) {
        if (!Array.isArray(all)) return;
        var live = all.filter(function (f) { return (f.caseTypes || []).indexOf(type) >= 0 && f.slug && f.name; }).map(function (f) {
          return { slug: f.slug, name: f.name, featured: !!f.featured, rating: Number(f.rating) || 0, count: Number(f.count) || 0, address: f.address || '', phone: f.phone || '', tags: f.tags || [],
            logo: f.type === 'logo' && /^(?:images\/logos\/[\w.-]+|img\/[\w-]+)$/.test(f.src || '') ? '/' + f.src : '' };
        }).sort(rank);
        if (!live.length) return;
        var baked = base.slice().sort(rank);
        /* same firms and numbers as the page: keep the order and add what only the live list has (logos, focus areas) */
        if (same(baked, live)) {
          var by = {}; live.forEach(function (f) { by[f.slug] = f; });
          firms.forEach(function (f) { var l = by[f.slug]; f.tags = l.tags; f.logo = l.logo; });
        } else { firms = live; setStats(live); }
        buildMap(); draw(false);
      })
      .catch(function () { /* the baked list stays */ });
  }

  function init() {
    statCountUps();
    if (B.getAttribute('data-type') && B.getAttribute('data-city')) {
      enhance();
      reveal('.wrap > .seo-h, .wrap > .seo-text, .wrap > .seo-ul, .wrap > .seo-ol, .wrap > .seo-faq, .wrap > .seo-chips, .wrap > .cta-box, .wrap > .seo-note');
    } else if (D.querySelector('.seo-city')) {
      reveal('.seo-city .seo-wrap > h3, .seo-city .seo-wrap > .seo-chips, .seo-city .flist, .seo-city .seo-all, .seo-city .seo-faq, .seo-city .seo-ul, .seo-city .seo-ol');
    }
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})();
