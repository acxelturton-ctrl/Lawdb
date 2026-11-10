/* City and case-type pages. Loaded with city-pages.css after site.js. The page is complete without this file (a table of firms, the numbers, the text);
   this turns it into a list people can search and sort, adds the side rail, and fades things in as they are scrolled to.
     - Case-type page (<body data-city data-prov data-type>): reads the baked table, then asks /api/firms for the city's current list, so a firm that
       listed itself, was renamed or became Featured after the page was built shows up straight away. If that request fails the baked table is used.
     - City hub (.seo-city): count-up numbers and fade-ins only.
   Nothing here sends anything about the visitor. */
(function () {
  'use strict';
  var D = document, B = D.body;
  var RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var PAGE = 12;

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
        rating: isNaN(rt) ? 0 : rt, count: isNaN(ct) ? 0 : ct, address: td[3].textContent.trim(), phone: td[4].textContent.trim(), tags: []
      });
    });
    return out;
  }
  var same = function (a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].slug !== b[i].slug || a[i].rating !== b[i].rating || a[i].count !== b[i].count || !!a[i].featured !== !!b[i].featured || a[i].name !== b[i].name) return false;
    return true;
  };

  /* widths and delays are set through the style object, not inline attributes, so the markup carries no inline styles */
  function paint(root) {
    [].forEach.call(root.querySelectorAll('[data-w]'), function (e) { e.style.setProperty('--w', e.getAttribute('data-w') + '%'); if (e.hasAttribute('data-d')) e.style.setProperty('--cpd', e.getAttribute('data-d') + 's'); });
  }

  /* ---------- rendering ---------- */
  function stars(r) { return '<span class="cp-stars" role="img" aria-label="' + r.toFixed(1) + ' out of 5 stars"><i data-w="' + Math.round(r / 5 * 100) + '"></i></span>'; }
  function card(f, i) {
    var ph = prettyPhone(f.phone), tags = (f.tags || []).filter(Boolean).slice(0, 3);
    var rate = rated(f)
      ? '<div class="cp-rate">' + stars(f.rating) + '<b>' + f.rating.toFixed(1) + '</b><span>' + fmt(f.count) + ' Google review' + (f.count === 1 ? '' : 's') + '</span></div>'
      : '<div class="cp-rate"><span>No Google rating on LawDB yet</span></div>';
    return '<article class="cp-card' + (f.featured ? ' cp-feat' : '') + '" data-slug="' + esc(f.slug) + '">'
      + '<div class="cp-mono" aria-hidden="true">' + esc(initials(f.name)) + '</div>'
      + '<div class="cp-body"><h3><a href="/firms/' + esc(f.slug) + '">' + esc(f.name) + '</a>' + (f.featured ? '<span class="seo-feat">Featured</span>' : (!rated(f) ? '<span class="cp-new">New</span>' : '')) + '</h3>'
      + rate + (f.address ? '<p class="cp-addr">' + esc(f.address) + '</p>' : '')
      + (tags.length ? '<div class="cp-tags">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : '') + '</div>'
      + '<div class="cp-act"><a class="cp-btn" href="/firms/' + esc(f.slug) + '">View profile</a>' + (ph ? '<a class="cp-call" href="tel:+1' + digits(f.phone).slice(-10) + '">Call ' + esc(ph) + '</a>' : '') + '</div>'
      + '</article>';
  }
  function pickCard(label, f) {
    return '<a class="cp-pick" href="/firms/' + esc(f.slug) + '"><span class="cp-eyebrow">' + esc(label) + '</span><strong>' + esc(f.name) + '</strong><span class="cp-meta">'
      + (rated(f) ? f.rating.toFixed(1) + ' &#9733; &middot; ' + fmt(f.count) + ' reviews' : ((f.tags || []).filter(Boolean).slice(0, 2).join(' &middot; ') || 'No Google rating yet')) + '</span></a>';
  }
  function picks(list) {
    if (list.length < 4) return '';
    var ok = list.filter(function (f) { return rated(f) && f.count >= 10; });
    var best = (ok.length ? ok : list.filter(rated)).slice().sort(function (a, b) { return b.rating - a.rating || b.count - a.count; })[0];
    var most = list.slice().sort(function (a, b) { return b.count - a.count || b.rating - a.rating; })[0];
    var feat = list.filter(function (f) { return f.featured; })[0];
    var fresh = list.filter(function (f) { return !rated(f); })[0];
    var seen = {}, out = [];
    [['Highest rated' + (ok.length ? ' (10+ reviews)' : ''), best], ['Most reviewed', most], ['Featured partner', feat], ['New on LawDB', fresh]].forEach(function (p) {
      if (p[1] && !seen[p[1].slug]) { seen[p[1].slug] = 1; out.push(pickCard(p[0], p[1])); }
    });
    return out.length > 1 ? '<div class="cp-picks">' + out.join('') + '</div>' : '';
  }

  function buckets(list) {
    var b = [['4.5 &ndash; 5.0', 0], ['4.0 &ndash; 4.4', 0], ['3.5 &ndash; 3.9', 0], ['Below 3.5', 0], ['Not rated', 0]];
    list.forEach(function (f) { var r = f.rating; b[!(r > 0) ? 4 : r >= 4.5 ? 0 : r >= 4 ? 1 : r >= 3.5 ? 2 : 3][1]++; });
    return b.filter(function (x, i) { return x[1] > 0 || i === 0; });
  }
  function bars(list) {
    var n = list.length || 1;
    return buckets(list).map(function (x, i) {
      return '<div class="cp-bar"><span>' + x[0] + '</span><span class="cp-track"><span class="cp-fill" data-w="' + Math.round(x[1] / n * 100) + '" data-d="' + (i * 0.08) + '"></span></span><em>' + x[1] + '</em></div>';
    }).join('');
  }

  function enhance() {
    var wrap = D.querySelector('.wrap'), tableWrap = D.querySelector('.seo-tablewrap'), h2 = tableWrap && tableWrap.previousElementSibling;
    if (!wrap || !tableWrap || !h2) return;
    var base = fromTable();
    if (!base.length) return;
    var city = B.getAttribute('data-city'), prov = B.getAttribute('data-prov'), type = B.getAttribute('data-type');
    var cityName = city || 'your city';
    var firms = base, st = { q: '', sort: 'rec', hi: false, rev: false, feat: false, shown: PAGE, view: 'cards' };

    var tools = D.createElement('div');
    tools.className = 'cp-tools';
    tools.innerHTML = '<label class="cp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" placeholder="Search by firm, street or focus" aria-label="Search these firms" autocomplete="off"></label>'
      + '<select class="cp-select" aria-label="Sort firms"><option value="rec">Recommended</option><option value="rating">Highest rated</option><option value="reviews">Most reviews</option><option value="az">A to Z</option></select>'
      + '<div class="cp-view" role="group" aria-label="View"><button type="button" data-v="cards" aria-pressed="true">Cards</button><button type="button" data-v="table" aria-pressed="false">Table</button></div>'
      + '<div class="cp-pills"><button type="button" class="cp-pill" data-f="hi" aria-pressed="false">4.5 stars and up</button><button type="button" class="cp-pill" data-f="rev" aria-pressed="false">10+ reviews</button><button type="button" class="cp-pill" data-f="feat" aria-pressed="false" hidden>Featured partners</button></div>';
    var count = D.createElement('p'); count.className = 'cp-count'; count.setAttribute('aria-live', 'polite');
    var pk = D.createElement('div');
    var list = D.createElement('div'); list.className = 'cp-list';
    var more = D.createElement('button'); more.type = 'button'; more.className = 'cp-more'; more.hidden = true;
    h2.id = h2.id || 'cp-firms';
    h2.insertAdjacentElement('afterend', pk);
    pk.insertAdjacentElement('afterend', tools);
    tools.insertAdjacentElement('afterend', count);
    count.insertAdjacentElement('afterend', list);
    list.insertAdjacentElement('afterend', more);
    tableWrap.hidden = true;
    B.classList.add('cp-ready');

    var q = tools.querySelector('input'), sel = tools.querySelector('select');
    var pillFeat = tools.querySelector('[data-f="feat"]');

    function view() {
      var out = firms.filter(function (f) {
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
      for (var i = drawnFrom; i < n; i++) html += card(v[i], i);
      if (html) {
        var tmp = D.createElement('div'); tmp.innerHTML = html;
        [].slice.call(tmp.children).forEach(function (c, k) { paint(c); c.style.setProperty('--cpd', (Math.min(k, 8) * 0.045) + 's'); list.appendChild(c); });
      }
      drawnFrom = n;
      if (!v.length) list.innerHTML = '<div class="cp-empty">No firms match that search. <br><button type="button" class="cp-pill" data-clear>Clear filters</button></div>';
      count.innerHTML = 'Showing <b>' + n + '</b> of <b>' + v.length + '</b> ' + (v.length === firms.length ? 'firms' : 'matching firms') + (v.length !== firms.length ? ' (out of ' + firms.length + ')' : '');
      more.hidden = n >= v.length;
      if (!more.hidden) more.textContent = 'Show ' + Math.min(PAGE, v.length - n) + ' more firm' + (Math.min(PAGE, v.length - n) === 1 ? '' : 's');
    }
    function summary() {
      pk.innerHTML = picks(firms);
      pillFeat.hidden = !firms.some(function (f) { return f.featured; });
      var rail = D.querySelector('.cp-rail .cp-bars');
      if (rail) { rail.innerHTML = bars(firms); paint(rail); armBars(rail); }
    }

    /* the side rail */
    var rail = D.createElement('aside'); rail.className = 'cp-rail'; rail.setAttribute('aria-label', 'Page summary');
    var heads = [].slice.call(wrap.querySelectorAll('h2.seo-h'));
    var toc = heads.map(function (h, i) {
      if (!h.id) h.id = 'cp-s' + (i + 1);
      return '<li><a href="#' + h.id + '">' + h.innerHTML + '</a></li>';
    }).join('');
    rail.innerHTML = '<div class="cp-box"><h2>Ratings at a glance</h2><div class="cp-bars"></div></div>'
      + '<nav class="cp-box cp-toc" aria-label="On this page"><h2>On this page</h2><ol>' + toc + '</ol></nav>'
      + '<div class="cp-box cp-cta"><h2>For law firms</h2><p>Own a firm in ' + esc(cityName) + '? List it free, or get Featured to be shown first.</p><a class="cp-btn" href="/list-your-firm">List your firm free</a><a class="cp-alt" href="/list-your-firm?plan=featured">See what Featured includes &rarr;</a></div>';
    var statsEl = D.querySelector('.wrap .seo-stats');
    (statsEl || h2).insertAdjacentElement('afterend', rail);

    function armBars(root) {
      var els = [].slice.call(root.querySelectorAll('.cp-bar'));
      if (RM) { els.forEach(function (e) { e.classList.add('on'); }); return; }
      whenSeen(els.length ? [root] : [], function () { els.forEach(function (e) { e.classList.add('on'); }); }, { threshold: 0.3 });
    }

    /* scroll spy for the table of contents */
    var links = [].slice.call(rail.querySelectorAll('.cp-toc a')), ticking = false;
    function spy() {
      ticking = false;
      var y = window.innerHeight * 0.3, cur = null;
      heads.forEach(function (h) { if (h.getBoundingClientRect().top < y) cur = h.id; });
      links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + cur); });
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });

    /* controls */
    var timer;
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { st.q = q.value.trim().toLowerCase(); st.shown = PAGE; draw(false); }, 120); });
    sel.addEventListener('change', function () { st.sort = sel.value; st.shown = PAGE; draw(false); });
    tools.addEventListener('click', function (e) {
      var p = e.target.closest('.cp-pill[data-f]'), v = e.target.closest('.cp-view button');
      if (p) { var k = p.getAttribute('data-f'); st[k] = !st[k]; p.setAttribute('aria-pressed', String(st[k])); st.shown = PAGE; draw(false); }
      if (v) {
        st.view = v.getAttribute('data-v');
        [].forEach.call(tools.querySelectorAll('.cp-view button'), function (b) { b.setAttribute('aria-pressed', String(b === v)); });
        var t = st.view === 'table'; tableWrap.hidden = !t; list.hidden = t; more.hidden = t || more.hidden; count.hidden = t; pk.hidden = t;
        if (!t) draw(false);
      }
    });
    list.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) {
        st.q = ''; st.hi = st.rev = st.feat = false; q.value = ''; st.shown = PAGE;
        [].forEach.call(tools.querySelectorAll('.cp-pill'), function (b) { b.setAttribute('aria-pressed', 'false'); });
        draw(false);
      }
    });
    more.addEventListener('click', function () { st.shown += PAGE; draw(true); });

    summary(); draw(false); setTimeout(spy, 50);

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
          return { slug: f.slug, name: f.name, featured: !!f.featured, rating: Number(f.rating) || 0, count: Number(f.count) || 0, address: f.address || '', phone: f.phone || '', tags: f.tags || [] };
        }).sort(rank);
        if (!live.length) return;
        var baked = base.slice().sort(rank);
        /* same firms and numbers as the page: keep what is drawn and only add the tags the live list has */
        if (same(baked, live)) { var tg = {}; live.forEach(function (f) { tg[f.slug] = f.tags; }); firms.forEach(function (f) { f.tags = tg[f.slug] || []; }); }
        else { firms = live; setStats(live); }
        summary(); draw(false);
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
