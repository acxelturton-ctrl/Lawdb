/* LawDB map: Google-Maps-style results view (bottom sheet on phones, list panel on desktop).
   Loaded after the page's own script. It takes over ensureMap / applyMapTheme / renderMap /
   focusFirmOnMap and rebuilds the results layout around the existing `firms`, `showResults`
   and filter state, so every page that has the Find Your Lawyer results can share it. */
(function(){
  'use strict';
  if(typeof maplibregl === 'undefined' || typeof ensureMap !== 'function' || typeof showResults !== 'function') return;

  var SRC = (document.currentScript && document.currentScript.getAttribute('src')) || 'lawdb-map.js';
  var ROOT = SRC.replace(/lawdb-map\.js.*$/, '');
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MQ = window.matchMedia('(max-width: 899px)');
  function isMobile(){ return MQ.matches; }

  /* ------------------------------------------------------------ helpers */
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function $(id){ return document.getElementById(id); }
  function km(a, b, c, d){
    var R = 6371, t = Math.PI / 180, dLa = (c - a) * t, dLo = (d - b) * t;
    var x = Math.sin(dLa/2) * Math.sin(dLa/2) + Math.cos(a*t) * Math.cos(c*t) * Math.sin(dLo/2) * Math.sin(dLo/2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtKm(d){ return (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km'; }

  var LAWYERS = {
    traffic: 'Traffic ticket lawyers', criminal: 'Criminal defence lawyers', family: 'Family law lawyers',
    injury: 'Personal injury lawyers', realestate: 'Real estate lawyers', wills: 'Wills & estates lawyers',
    business: 'Business lawyers', employment: 'Employment lawyers', immigration: 'Immigration lawyers', litigation: 'Litigation lawyers'
  };
  var AREA = {
    traffic: 'Traffic', criminal: 'Criminal defence', family: 'Family law', injury: 'Personal injury', realestate: 'Real estate',
    wills: 'Wills & estates', business: 'Business law', employment: 'Employment', immigration: 'Immigration', litigation: 'Litigation'
  };
  function areaName(id, prov){
    if(prov === 'QC' && id === 'realestate') return 'Property disputes';
    if(prov === 'QC' && id === 'wills') return 'Estate disputes';
    return AREA[id] || (typeof caseLabel === 'function' ? caseLabel(id, prov) : id);
  }
  function lawyersLabel(id, prov){
    if(prov === 'QC' && id === 'realestate') return 'Property dispute lawyers';
    if(prov === 'QC' && id === 'wills') return 'Estate dispute lawyers';
    return LAWYERS[id] || ((typeof caseLabel === 'function' ? caseLabel(id, prov) : id) + ' lawyers');
  }
  function firmArea(f){
    if(selectedCase && f.caseTypes && f.caseTypes.indexOf(selectedCase) >= 0) return areaName(selectedCase, f.province);
    if(f.caseTypes && f.caseTypes.length) return areaName(f.caseTypes[0], f.province);
    return 'Law firm';
  }
  /* "near a spot" (find-lawyers page only): the firms closest to a town with no firm of its own, or to the person: { lat, lng, label, me } */
  function nearSel(){ return (typeof selectedNear !== 'undefined' && selectedNear) ? selectedNear : null; }
  function setNear(v){ if(typeof selectedNear !== 'undefined') selectedNear = v; }
  function placeLabel(short){
    var nr = nearSel();
    if(nr) return 'Closest to ' + (nr.me ? 'you' : nr.label);
    if(selectedCityName) return selectedCityName + ', ' + selectedProvince;
    if(selectedRegion && typeof REGION_LABEL !== 'undefined' && REGION_LABEL[selectedRegion]) return REGION_LABEL[selectedRegion];
    var pv = (typeof PROVINCE_LABEL !== 'undefined' && PROVINCE_LABEL[selectedProvince]) || 'Canada';
    return short ? pv : 'All of ' + pv;
  }

  /* ------------------------------------------------------------ hours */
  var hours = null, hoursP = null;
  var TZ = { ON: 'America/Toronto', QC: 'America/Toronto', BC: 'America/Vancouver', AB: 'America/Edmonton', MB: 'America/Winnipeg' };
  var DAYN = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function loadHours(){
    if(hoursP) return hoursP;
    hoursP = fetch(ROOT + 'firms_hours.json').then(function(r){ return r.json(); }).then(function(j){ hours = j; return j; }).catch(function(){ hours = {}; return hours; });
    return hoursP;
  }
  function nowIn(tz){
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
      var o = {}; parts.forEach(function(p){ o[p.type] = p.value; });
      return { d: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday], m: (+o.hour % 24) * 60 + (+o.minute) };
    } catch(e){ var n = new Date(); return { d: n.getDay() || 7, m: n.getHours() * 60 + n.getMinutes() }; }
  }
  function toMin(v){ if(typeof v === 'number') return v; var p = String(v).split(':'); return +p[0] * 60 + (+p[1] || 0); }
  function fmtT(v){ var t = toMin(v), h = Math.floor(t / 60) % 24, m = t % 60, ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + (m ? ':' + ('0' + m).slice(-2) : '') + ' ' + ap; }
  function openInfo(f){
    var h = hours && hours[f.slug]; if(!h) return null;
    var n = nowIn(TZ[f.province] || 'America/Toronto'), today = h[n.d] || [], i, r;
    for(i = 0; i < today.length; i++){ r = today[i]; if(n.m >= toMin(r[0]) && n.m < toMin(r[1])) return { open: true, text: 'Closes ' + fmtT(r[1]) }; }
    for(i = 0; i < today.length; i++){ r = today[i]; if(toMin(r[0]) > n.m) return { open: false, text: 'Opens ' + fmtT(r[0]) }; }
    for(i = 1; i <= 7; i++){
      var nd = ((n.d - 1 + i) % 7) + 1;
      if(h[nd] && h[nd].length) return { open: false, text: 'Opens ' + (i === 1 ? 'tomorrow' : DAYN[nd]) + ' ' + fmtT(h[nd][0][0]) };
    }
    return { open: false, text: 'Closed' };
  }

  /* ------------------------------------------------------------ state */
  var base = [], view = [];
  var PER = 10, page = 1, viewSig = '', lastSlots = 0;
  var F = { feat: false, top: false, rev: false, open: false, sort: 'rec' };
  var areaB = null, sel = null, userPos = null, mapOK = false, userMoved = false, sheetState = 'peek', nearOrigin = false;
  var app, panel, scrollEl, listEl, selEl, mapWrap, areaBtn, locBtn;

  /* ------------------------------------------------------------ icons */
  var IC = {
    search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    call: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    dir: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>',
    web: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>',
    prof: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    prev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    tick: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    loc: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#142434" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>',
    redo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    pinS: '<svg class="gm-pin" width="14" height="14" viewBox="0 0 24 24" fill="#8a6224" aria-hidden="true"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12zm0-9.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"/></svg>',
    pinG: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c9a050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>',
    sliders: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#142434" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#142434" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    go: '<svg class="gm-go" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  /* ------------------------------------------------------------ item markup */
  function initials(name){
    var w = String(name || '').replace(/[^A-Za-zÀ-ſ ]/g, ' ').split(/\s+/).filter(function(x){ return x && !/^(the|and|of|law|llp)$/i.test(x); });
    return ((w[0] || name || '?').charAt(0) + ((w[1] || '').charAt(0))).toUpperCase();
  }
  function thumb(f){
    if(f.logoUrl){
      return '<div class="gm-i-thumb mono">' + esc(initials(f.name)) +
        '<img src="' + esc(f.logoUrl) + '" alt="' + esc(f.name) + ' logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" style="background:' + (f.dark ? '#142434' : '#fff') + '"></div>';
    }
    if(f.type === 'logo' && f.src) return '<div class="gm-i-thumb"><img src="' + esc(ROOT + f.src) + '" alt="' + esc(f.name) + ' logo" loading="lazy"></div>';
    return '<div class="gm-i-thumb mono">' + esc(initials(f.name)) + '</div>';
  }
  function itemHtml(f, detail){
    var oi = openInfo(f), dist = userPos ? ' · ' + fmtKm(km(userPos.lat, userPos.lng, f.lat, f.lng)) : '';
    var pct = Math.max(0, Math.min(100, (f.rating || 0) / 5 * 100));
    var prof = ROOT + 'firms/' + f.slug;
    return '<article class="gm-item' + (f.featured ? ' is-feat' : '') + (sel && sel.slug === f.slug && !detail ? ' is-sel' : '') + '" data-slug="' + esc(f.slug) + '">' +
      thumb(f) +
      '<div class="gm-i-main">' +
        (f.featured ? '<span class="gm-i-badge"><i>' + IC.tick + '</i>Featured</span>' : '') +
        '<h3 class="gm-i-name"><a href="' + esc(prof) + '">' + esc(f.name) + '</a></h3>' +
        '<div class="gm-i-rate"><b>' + f.rating.toFixed(1) + '</b><span class="gm-stars" style="--p:' + pct + '%" aria-hidden="true">★★★★★</span><span>(' + f.count + ')</span></div>' +
        '<div class="gm-i-meta">' + esc(firmArea(f)) + ' · ' + esc(f.city) + dist + '</div>' +
        (f.address ? '<div class="gm-i-addr">' + IC.pinS + '<span>' + esc(f.address) + '</span></div>' : '') +
        (oi ? '<div class="gm-i-hours"><span class="' + (oi.open ? 'o' : 'c') + '">' + (oi.open ? 'Open' : 'Closed') + '</span> · ' + esc(oi.text) + '</div>' : '') +
      '</div>' + (detail ? '' : IC.go) +
      '<div class="gm-i-acts">' +
        (f.phone ? '<a class="gm-act pri" href="tel:' + esc(f.phone) + '">' + IC.call + 'Call</a>' : '') +
        '<a class="gm-act" href="' + esc(f.dirUrl) + '" target="_blank" rel="noopener">' + IC.dir + 'Directions</a>' +
        (f.website ? '<a class="gm-act" href="' + esc(f.website) + '" target="_blank" rel="noopener">' + IC.web + 'Website</a>' : '') +
      '</div></article>';
  }
  function detailHtml(f){
    var tags = (f.caseTypes || []).slice(0, 6).map(function(c){ return '<span>' + esc(areaName(c, f.province)) + '</span>'; }).join('');
    return '<div class="gm-sel-bar"><button class="gm-sel-back" type="button" data-back>' + IC.back + 'All results</button></div>' +
      itemHtml(f, true) + (tags ? '<div class="gm-sel-tags">' + tags + '</div>' : '');
  }

  /* ------------------------------------------------------------ filtering */
  function inB(f){ return f.lng >= areaB.getWest() && f.lng <= areaB.getEast() && f.lat >= areaB.getSouth() && f.lat <= areaB.getNorth(); }
  function computeView(){
    var v = base.filter(function(f){
      if(F.feat && !f.featured) return false;
      if(F.top && !(f.rating >= 4.5)) return false;
      if(F.rev && !(f.count >= 40)) return false;
      if(F.open){ var oi = openInfo(f); if(!oi || !oi.open) return false; }
      if(areaB && !inB(f)) return false;
      return true;
    });
    if(F.sort === 'top') v.sort(function(a, b){ return (b.rating - a.rating) || (b.count - a.count); });
    else if(F.sort === 'rev') v.sort(function(a, b){ return b.count - a.count; });
    else if(F.sort === 'near'){
      var c = userPos || (mapOK ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null);
      if(c) v.sort(function(a, b){ return km(c.lat, c.lng, a.lat, a.lng) - km(c.lat, c.lng, b.lat, b.lng); });
    }
    view = v;
    var sig = v.map(function(f){ return f.slug; }).join('|');
    if(sig !== viewSig){ viewSig = sig; page = 1; }
  }

  /* ------------------------------------------------------------ panel rendering */
  var SORTS = [['rec', 'Recommended'], ['top', 'Highest rated'], ['rev', 'Most reviewed'], ['near', 'Nearest']];
  function sortName(){ for(var i = 0; i < SORTS.length; i++) if(SORTS[i][0] === F.sort) return SORTS[i][1]; return 'Recommended'; }

  /* ------------------------------------------------------------ page bar */
  // A fixed number of slots (first page, last page, "..." and the pages around the current one) so the bar never changes width as you page.
  function pageItems(cur, total, slots){
    function range(a, b){ var r = []; for(var i = a; i <= b; i++) r.push(i); return r; }
    if(total <= slots) return range(1, total);
    if(cur <= slots - 3) return range(1, slots - 2).concat([0, total]);
    if(cur >= total - slots + 4) return [1, 0].concat(range(total - slots + 3, total));
    var mid = slots - 4, from = cur - Math.floor((mid - 1) / 2);
    return [1, 0].concat(range(from, from + mid - 1), [0, total]);
  }
  function pageSlots(){
    var w = listEl ? listEl.clientWidth : 0;
    return w ? Math.max(5, Math.min(10, Math.floor((w - 48) / (isMobile() ? 37 : 33)) - 2)) : 7;
  }
  function pagerHtml(pages){
    if(pages < 2) return '';
    lastSlots = pageSlots();
    var h = '<nav class="gm-pager" aria-label="Result pages">' +
      '<button type="button" class="gm-pg gm-pg-arrow" data-pg="' + (page - 1) + '" aria-label="Previous page"' + (page === 1 ? ' disabled' : '') + '>' + IC.prev + '</button>';
    pageItems(page, pages, lastSlots).forEach(function(p){
      h += p === 0 ? '<span class="gm-pg-gap" aria-hidden="true">&hellip;</span>'
        : '<button type="button" class="gm-pg gm-pg-n' + (p === page ? ' on' : '') + '" data-pg="' + p + '" aria-label="Page ' + p + '"' + (p === page ? ' aria-current="page"' : '') + '>' + p + '</button>';
    });
    return h + '<button type="button" class="gm-pg gm-pg-arrow" data-pg="' + (page + 1) + '" aria-label="Next page"' + (page === pages ? ' disabled' : '') + '>' + IC.next + '</button></nav>';
  }

  function queryText(){
    var what = selectedCase ? lawyersLabel(selectedCase, selectedProvince) : 'Lawyers', nr = nearSel();
    return nr ? what + ' near ' + (nr.me ? 'you' : nr.label) : what + ' in ' + placeLabel(true);
  }
  function renderQuery(){
    var q = $('gmQ'); if(!q) return;
    var t = queryText();
    if(document.activeElement !== q) q.value = t;
    q.title = t;
  }
  function renderPanel(){
    var pages = Math.max(1, Math.ceil(view.length / PER));
    if(page > pages) page = pages;
    $('gmCount').textContent = view.length + ' lawyer' + (view.length === 1 ? '' : 's') + (areaB ? ' in this area' : '');
    $('gmSub').innerHTML = (areaB ? 'Showing the current map area · <button type="button" id="gmAll">Show all</button>' : esc(placeLabel())) + (pages > 1 ? ' · <span class="gm-pgno">Page ' + page + ' of ' + pages + '</span>' : '');
    $('gmSortName').textContent = sortName();
    var note = '';
    if(F.open) note = '<p class="gm-note">Only firms with listed hours are shown. Hours are as published online, so please call to confirm.</p>';
    var html;
    if(!base.length){ html = ''; }
    else if(!view.length){
      html = '<div class="gm-empty">' + (areaB ? 'No lawyers match in this part of the map.<br>Zoom out or move the map, then search again.' : 'No lawyers match these filters.') +
        '<br><button type="button" data-reset>' + (areaB ? 'Show all in ' + esc(placeLabel()) : 'Clear filters') + '</button></div>';
    } else {
      html = view.slice((page - 1) * PER, page * PER).map(function(f){ return itemHtml(f); }).join('') + pagerHtml(pages);
    }
    listEl.innerHTML = note + html;
    var lb = $('listBody'); if(lb) lb.style.display = base.length ? 'none' : '';
    syncChips();
  }
  function renderSel(){
    if(!sel){ selEl.hidden = true; selEl.innerHTML = ''; app.classList.remove('has-sel'); return; }
    selEl.innerHTML = detailHtml(sel); selEl.hidden = false; app.classList.add('has-sel');
  }

  /* ------------------------------------------------------------ chips */
  function chipHtml(k, label, extra){ return '<button type="button" class="gm-chip" data-k="' + k + '"' + (extra || '') + '>' + label + '</button>'; }
  function buildChips(){
    var h = chipHtml('feat', 'Featured') + chipHtml('top', 'Top rated') + chipHtml('rev', '40+ reviews') + chipHtml('open', 'Open now') + '<span class="gm-chip-sep"></span>';
    (typeof CASE_TYPES !== 'undefined' ? CASE_TYPES : []).forEach(function(c){
      h += '<button type="button" class="gm-chip" data-case="' + esc(c.id) + '">' + esc(areaName(c.id, selectedProvince)) + '</button>';
    });
    $('gmChips').innerHTML = h;
  }
  var shownCase;
  function syncChips(){
    var box = $('gmChips'), chips = box.querySelectorAll('.gm-chip');
    for(var i = 0; i < chips.length; i++){
      var c = chips[i], on = c.dataset.k ? !!F[c.dataset.k] : (c.dataset.case === selectedCase);
      c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
      if(c.dataset.case) c.textContent = areaName(c.dataset.case, selectedProvince);
    }
    /* a practice area chosen by a link or the search box can sit off to the right: bring it into view, once per choice */
    if(selectedCase !== shownCase){
      shownCase = selectedCase;
      var act = selectedCase && box.querySelector('.gm-chip[data-case].on');
      if(act){ var bx = box.getBoundingClientRect(), cr = act.getBoundingClientRect(); if(cr.right > bx.right - 30 || cr.left < bx.left) box.scrollLeft += cr.left - bx.left - 24; }
    }
  }

  /* ------------------------------------------------------------ apply + draw */
  function apply(refit){
    computeView(); renderPanel();
    if(sel && !view.some(function(f){ return f.slug === sel.slug; }) && !base.some(function(f){ return f.slug === sel.slug; })) clearSel(true);
    drawMap(refit);
  }
  function props(f, i){
    var prio = (f.featured ? 0 : 10) - (f.rating || 0) - Math.min(f.count || 0, 500) / 1000;
    return { idx: i, name: f.name, featured: f.featured ? 1 : 0, prio: prio,
      sub: '★ ' + f.rating.toFixed(1) + ' (' + f.count + ') · ' + firmArea(f) };
  }
  function fc(list){ return { type: 'FeatureCollection', features: list }; }
  function pt(f, p){ return { type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: p }; }
  function drawMap(refit){
    if(!mapOK) return;
    mapDataList = view.slice();
    var b = [], ft = [];
    view.forEach(function(f, i){ (f.featured ? ft : b).push(pt(f, props(f, i))); });
    try { map.getSource('firms').setData(fc(b)); map.getSource('firms-feat').setData(fc(ft)); } catch(e){}
    setSelSource();
    if(refit) fitView();
  }
  function pad(){
    var m = isMobile();
    return m ? { top: 50, bottom: 214 + 40, left: 40, right: 70 } : { top: 60, bottom: 60, left: 60, right: 90 };
  }
  /* Frame the person (or the town searched) and the few firms really near them. One far-off firm must not drag the view out, and a block of
     offices must not zoom the map in to rooftops: the view is at least about a kilometre across and never closer than street level. */
  function fitAround(o, list, animate){
    if(!mapOK) return;
    var ds = list.map(function(f){ return { f: f, d: km(o.lat, o.lng, f.lat, f.lng) }; }).sort(function(a, b){ return a.d - b.d; });
    var lim = ds.length ? Math.max(2, ds[0].d * 2.2 + 1.5) : 0;
    var w = o.lng, e = o.lng, s = o.lat, n = o.lat;
    ds.filter(function(x){ return x.d <= lim; }).slice(0, 6).forEach(function(x){ w = Math.min(w, x.f.lng); e = Math.max(e, x.f.lng); s = Math.min(s, x.f.lat); n = Math.max(n, x.f.lat); });
    var minLat = 0.006, minLng = minLat / Math.max(0.2, Math.cos(o.lat * Math.PI / 180));
    if(n - s < minLat){ var mla = (n + s) / 2; s = mla - minLat / 2; n = mla + minLat / 2; }
    if(e - w < minLng){ var mln = (e + w) / 2; w = mln - minLng / 2; e = mln + minLng / 2; }
    userMoved = false;
    var cam = null;
    try { cam = map.cameraForBounds([[w, s], [e, n]], { padding: pad() }); } catch(x){}
    var dur = animate && !REDUCED ? 700 : 0;
    if(!cam){ map.easeTo({ center: [o.lng, o.lat], zoom: 12, duration: dur }); return; }
    map.easeTo({ center: cam.center, zoom: Math.max(4.5, Math.min(cam.zoom, 15)), duration: dur });
  }
  function fitView(pts){
    if(!mapOK) return;
    if(nearOrigin && userPos && !pts){ fitAround(userPos, view, false); return; }
    pts = pts || view;
    if(!pts.length) return;
    if(pts.length === 1){ map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: 13 }); return; }
    var cityPts = selectedCityName ? pts.filter(function(f){ return f.city === selectedCityName; }) : [];
    var regionPts = selectedRegion ? pts.filter(function(f){ return f.region === selectedRegion; }) : [];
    var use = cityPts.length ? cityPts : (regionPts.length ? regionPts : pts);
    var w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    use.forEach(function(f){ w = Math.min(w, f.lng); e = Math.max(e, f.lng); s = Math.min(s, f.lat); n = Math.max(n, f.lat); });
    userMoved = false;
    map.fitBounds([[w, s], [e, n]], { padding: pad(), maxZoom: cityPts.length ? 14 : 12, duration: 0 });
  }
  function setSelSource(){
    if(!mapOK) return;
    try {
      var s = map.getSource('firm-sel');
      s.setData(sel ? fc([pt(sel, { featured: sel.featured ? 1 : 0 })]) : fc([]));
    } catch(e){}
  }

  /* ------------------------------------------------------------ selection */
  function select(f, fromMap){
    sel = f; renderSel(); setSelSource();
    var vi = view.indexOf(f);
    if(vi >= 0 && Math.floor(vi / PER) + 1 !== page){ page = Math.floor(vi / PER) + 1; renderPanel(); }
    var items = listEl.querySelectorAll('.gm-item');
    for(var i = 0; i < items.length; i++) items[i].classList.toggle('is-sel', items[i].dataset.slug === f.slug);
    scrollEl.scrollTop = 0;
    if(isMobile()) setState('sel');
    if(mapOK){
      var off = isMobile() ? [0, -Math.round(Math.max(120, (selEl.offsetHeight + 26) / 2))] : [0, 0];
      var opts = { center: [f.lng, f.lat], zoom: Math.max(map.getZoom(), 13), offset: off, duration: REDUCED ? 0 : 500 };
      userMoved = false; map.easeTo(opts);
    }
    hideArea();
  }
  function clearSel(silent){
    if(!sel) return;
    sel = null; renderSel(); setSelSource();
    var items = listEl.querySelectorAll('.gm-item.is-sel');
    for(var i = 0; i < items.length; i++) items[i].classList.remove('is-sel');
    if(!silent && isMobile()) setState('peek');
  }

  /* ------------------------------------------------------------ bottom sheet (phones) */
  var curTy = 0;
  function snaps(){
    var H = panel.offsetHeight, A = app.clientHeight;
    var selVis = 26 + (selEl.hidden ? 0 : selEl.offsetHeight) + 6;
    return { full: 0, half: Math.max(0, H - Math.round(A * 0.5)), peek: Math.max(0, H - 214), sel: Math.max(0, H - selVis) };
  }
  function setTy(ty, animate){
    var H = panel.offsetHeight;
    curTy = ty;
    panel.classList.toggle('anim', !!animate && !REDUCED);
    panel.style.setProperty('--gm-ty', ty + 'px');
    app.style.setProperty('--gm-vis', Math.max(0, H - ty) + 'px');
  }
  function setState(name, instant){
    sheetState = name;
    app.dataset.state = name; panel.dataset.state = name;
    /* fully open on a phone: the heading steps aside so the list gets the screen */
    var wide = isMobile() && name === 'full';
    if(document.body.classList.contains('gm-full') !== wide){ document.body.classList.toggle('gm-full', wide); if(wide) window.scrollTo(0, 0); sizeApp(true); }
    if(!isMobile()){ panel.style.removeProperty('--gm-ty'); return; }
    var S = snaps();
    setTy(S[name] != null ? S[name] : S.peek, !instant);
  }
  function setupSheet(){
    var drag = null;
    panel.addEventListener('touchstart', function(e){
      if(!isMobile() || e.touches.length !== 1) return;
      if(sheetState === 'full' && scrollEl.contains(e.target)) return;
      var t = e.touches[0];
      drag = { y0: t.clientY, ty0: curTy, moving: false, ly: t.clientY, lt: Date.now(), v: 0 };
    }, { passive: true });
    panel.addEventListener('touchmove', function(e){
      if(!drag) return;
      var y = e.touches[0].clientY, dy = y - drag.y0;
      if(!drag.moving){ if(Math.abs(dy) < 8) return; drag.moving = true; panel.classList.remove('anim'); }
      if(e.cancelable) e.preventDefault();
      var S = snaps(), lo = 0, hi = sheetState === 'sel' ? S.sel + 90 : S.peek;
      var ty = Math.min(hi, Math.max(lo, drag.ty0 + dy));
      var now = Date.now(), dt = Math.max(1, now - drag.lt);
      drag.v = (y - drag.ly) / dt; drag.ly = y; drag.lt = now;
      setTy(ty, false);
    }, { passive: false });
    function end(){
      if(!drag) return;
      var d = drag; drag = null;
      if(!d.moving) return;
      var S = snaps(), proj = curTy + d.v * 220;
      var names = sel ? ['sel', 'full'] : ['peek', 'half', 'full'];
      if(sel && proj > S.sel + 70){ clearSel(); return; }
      var best = names[0], bd = 1e9;
      names.forEach(function(nm){ var dd = Math.abs(S[nm] - proj); if(dd < bd){ bd = dd; best = nm; } });
      setState(best);
    }
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
    $('gmGrab').addEventListener('click', function(){
      if(!isMobile()) return;
      var order = sel ? ['sel', 'full'] : ['peek', 'half', 'full'];
      var i = order.indexOf(sheetState);
      setState(order[(i + 1) % order.length]);
    });
  }

  /* ------------------------------------------------------------ search-this-area pill */
  function showArea(){ if(areaBtn && !sel) areaBtn.hidden = false; }
  function hideArea(){ if(areaBtn) areaBtn.hidden = true; }

  /* ------------------------------------------------------------ locate me */
  var toastT;
  function toast(msg){
    var t = $('gmToast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function(){ t.hidden = true; }, 4200);
  }
  function updateMe(){
    if(!mapOK) return;
    try { map.getSource('me').setData(fc(userPos ? [pt({ lng: userPos.lng, lat: userPos.lat }, {})] : [])); } catch(e){}
  }
  function locate(){
    if(!navigator.geolocation){ toast('Location isn\u2019t available in this browser.'); return; }
    locBtn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function(p){
      locBtn.classList.remove('busy'); locBtn.classList.add('on');
      var here = { lat: p.coords.latitude, lng: p.coords.longitude };
      if(p.coords.accuracy > 5000) toast('Your phone shared an approximate location (about ' + Math.round(p.coords.accuracy / 1000) + ' km). Search your town if this looks off.');
      // Searching "near" a town and then tapping locate: the search becomes "near you" and the list is rebuilt around the person.
      if(nearSel()){
        setNear({ lat: here.lat, lng: here.lng, label: 'you', prov: null, me: true });
        try { var nu = new URL(location.href); nu.searchParams.set('near', 'me'); history.replaceState({}, '', nu); } catch(e){}
        showResults(true); return;
      }
      userPos = here; nearOrigin = false;
      updateMe();
      F.sort = 'near'; areaB = null; hideArea();
      computeView(); renderPanel(); drawMap(false);
      if(sel) { renderSel(); }
      if(mapOK) fitAround(userPos, view, true);
      if(isMobile() && !sel) setState('peek');
    }, function(){
      locBtn.classList.remove('busy');
      toast('Location not shared. Allow location access in your browser to find lawyers near you.');
    }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 120000 });
  }

  /* ------------------------------------------------------------ basemap theme */
  var P = {
    land: '#f5f3ec', water: 'rgba(138,145,155,0.3)', park: '#f4ecd8', parkLine: '#e6d4a4', wood: '#f4ecd8', grass: '#f5f3ec', resid: '#f5f3ec',
    road: '#ffffff', casing: '#e3dfd3', major: '#ffffff', motor: '#f4ecd8', motorCasing: '#e6d4a4',
    building: '#e3dfd3', buildingLine: '#e3dfd3', halo: 'rgba(255,255,255,.92)', text: '#142434', textSoft: '#586170', water_txt: '#586170'
  };
  window.__gmPalette = P;
  applyMapTheme = function(){
    var layers = map.getStyle().layers || [];
    layers.forEach(function(l){
      var id = l.id, ty = l.type;
      try {
        if(/^poi|^airport|aeroway|natural_earth|building-3d/.test(id)){ map.setLayoutProperty(id, 'visibility', 'none'); return; }
        if(ty === 'symbol'){
          if(/highway-name|road_|waterway_line_label/.test(id)){
            map.setLayoutProperty(id, 'visibility', 'visible');
            map.setPaintProperty(id, 'text-color', /water/.test(id) ? P.water_txt : P.textSoft);
            map.setPaintProperty(id, 'text-halo-color', P.halo); map.setPaintProperty(id, 'text-halo-width', 1.5);
            if(/highway-name|road_/.test(id)) map.setLayerZoomRange(id, 13, 24);
          } else if(/shield|junction|aerialway/.test(id)){ map.setLayoutProperty(id, 'visibility', 'none'); }
          else if(/water_name/.test(id)){
            map.setPaintProperty(id, 'text-color', P.water_txt); map.setPaintProperty(id, 'text-halo-color', P.halo); map.setPaintProperty(id, 'text-halo-width', 1.2);
          } else if(/^label_(city|town|village|state|other|country)/.test(id)){
            map.setLayoutProperty(id, 'visibility', 'visible');
            var dark = /city|town|state|country/.test(id);
            map.setPaintProperty(id, 'text-color', dark ? P.text : P.textSoft);
            map.setPaintProperty(id, 'text-halo-color', P.halo); map.setPaintProperty(id, 'text-halo-width', 1.6);
          }
          return;
        }
        if(ty === 'line'){
          if(/rail|transit|ferry|aerialway|cablecar/.test(id)){ map.setLayoutProperty(id, 'visibility', 'none'); return; }
          if(/^boundary/.test(id)){
            if(/boundary_3|disputed/.test(id)){ map.setLayoutProperty(id, 'visibility', 'none'); return; }
            map.setPaintProperty(id, 'line-color', '#e6d4a4'); return;
          }
          if(/park_outline|outline/.test(id) && !/road|highway|bridge|tunnel/.test(id)){ map.setPaintProperty(id, 'line-color', '#e6d4a4'); return; }
          if(/waterway/.test(id)){ map.setPaintProperty(id, 'line-color', P.water); return; }
          if(/highway|road|bridge|tunnel|link|motorway|trunk|primary|secondary|tertiary|minor|service|path|pier/.test(id)){
            var c = P.road;
            if(/casing/.test(id)) c = /motorway|trunk/.test(id) ? P.motorCasing : P.casing;
            else if(/motorway|trunk/.test(id)) c = P.motor;
            else if(/major|primary|secondary|link/.test(id)) c = P.major;
            else if(/path|track/.test(id)) c = '#e3dfd3';
            map.setPaintProperty(id, 'line-color', c);
          }
          return;
        }
        if(ty === 'background'){ map.setPaintProperty(id, 'background-color', P.land); return; }
        if(ty === 'fill'){
          if(id === 'water' || /^water/.test(id)) map.setPaintProperty(id, 'fill-color', P.water);
          else if(/^park/.test(id) || /landcover_(wood|forest)/.test(id)){
            map.setPaintProperty(id, 'fill-color', /wood|forest/.test(id) ? P.wood : P.park);
            if(/^park/.test(id)) map.setPaintProperty(id, 'fill-outline-color', P.parkLine);
          }
          else if(/landuse_(pitch|track)/.test(id)) map.setPaintProperty(id, 'fill-color', '#edeae1');
          else if(/landcover_(ice|glacier)/.test(id)) map.setPaintProperty(id, 'fill-color', '#edeae1');
          else if(/landcover_(sand|beach)/.test(id)) map.setPaintProperty(id, 'fill-color', '#f4ecd8');
          else if(/landcover_wetland/.test(id)) map.setPaintProperty(id, 'fill-color', '#e3dfd3');
          else if(/landcover/.test(id)) map.setPaintProperty(id, 'fill-color', P.grass);
          else if(/landuse_residential/.test(id)) map.setPaintProperty(id, 'fill-color', P.resid);
          else if(/landuse_cemetery/.test(id)) map.setPaintProperty(id, 'fill-color', '#e3dfd3');
          else if(/landuse_hospital/.test(id)) map.setPaintProperty(id, 'fill-color', '#edeae1');
          else if(/landuse_school/.test(id)) map.setPaintProperty(id, 'fill-color', '#f4ecd8');
          else if(id === 'building'){
            map.setPaintProperty(id, 'fill-color', P.building); map.setPaintProperty(id, 'fill-outline-color', P.buildingLine);
            map.setPaintProperty(id, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1]);
            map.setLayoutProperty(id, 'visibility', 'visible');
          }
        }
      } catch(e){}
    });
  };

  /* ------------------------------------------------------------ pins */
  function pinImage(fill, stroke, scale, gold, dot){
    var W = Math.round(34 * scale), H = Math.round(46 * scale);
    var c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
    var x = c.getContext('2d'); x.scale(2 * scale, 2 * scale);
    x.shadowColor = 'rgba(20,36,52,0.35)'; x.shadowBlur = 3; x.shadowOffsetY = 1.5;
    x.beginPath(); x.moveTo(17, 44);
    x.bezierCurveTo(17, 44, 3, 28, 3, 16.5); x.arc(17, 16.5, 14, Math.PI, 0, false); x.bezierCurveTo(31, 28, 17, 44, 17, 44); x.closePath();
    x.fillStyle = fill; x.fill(); x.shadowColor = 'transparent'; x.lineWidth = 1.4; x.strokeStyle = stroke; x.stroke();
    if(gold){
      // a white disc with the LawDB database-stack mark in gold
      x.beginPath(); x.arc(17, 16.5, 8.6, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
      x.fillStyle = '#c9a050';
      x.beginPath(); x.ellipse(17, 12.6, 5, 2.1, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.moveTo(12, 12.6); x.lineTo(12, 20.4); x.ellipse(17, 20.4, 5, 2.1, 0, Math.PI, 0, true); x.lineTo(22, 12.6); x.closePath(); x.fill();
      x.strokeStyle = '#ffffff'; x.lineWidth = 1; x.beginPath(); x.ellipse(17, 15.4, 5, 2, 0, 0, Math.PI); x.stroke();
      x.beginPath(); x.ellipse(17, 18.1, 5, 2, 0, 0, Math.PI); x.stroke();
    } else {
      x.beginPath(); x.arc(17, 16.5, 5.2, 0, Math.PI * 2); x.fillStyle = dot || '#ffffff'; x.fill();
    }
    return { width: W * 2, height: H * 2, data: x.getImageData(0, 0, W * 2, H * 2).data };
  }
  var FONTS = null;
  function pickFonts(){
    if(FONTS) return FONTS;
    var bold = null, reg = null, any = null;
    try {
      map.getStyle().layers.forEach(function(l){
        var f = l.layout && l.layout['text-font'];
        if(Array.isArray(f) && typeof f[0] === 'string'){
          if(!any) any = f;
          if(!bold && /Bold/i.test(f[0])) bold = f;
          if(!reg && /Regular/i.test(f[0])) reg = f;
        }
      });
    } catch(e){}
    FONTS = { bold: bold, reg: reg || any, any: any };
    return FONTS;
  }
  function textField(feat){
    var F2 = pickFonts(), nm = { 'font-scale': 1, 'text-color': feat ? '#2b3a4c' : '#142434' }, sb = { 'font-scale': 0.88, 'text-color': '#586170' };
    if(F2.bold) nm['text-font'] = ['literal', F2.bold];
    if(F2.reg) sb['text-font'] = ['literal', F2.reg];
    return ['format', ['get', 'name'], nm, '\n', {}, ['get', 'sub'], sb];
  }
  function labelLayer(id, source, feat, filter){
    var F2 = pickFonts(), lay = {
      'text-field': textField(feat), 'text-size': 12.5, 'text-anchor': 'left', 'text-offset': [1.15, -1.75],
      'text-max-width': 10, 'text-optional': true, 'text-allow-overlap': false, 'symbol-sort-key': ['get', 'prio']
    };
    var font = F2.reg || F2.any; if(font) lay['text-font'] = font;
    var def = { id: id, type: 'symbol', source: source, layout: lay,
      paint: { 'text-color': '#142434', 'text-halo-color': 'rgba(245,243,236,0.95)', 'text-halo-width': 1.8,
        'text-opacity': feat ? 1 : ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.5, 1] } };
    if(filter) def.filter = filter;
    try { map.addLayer(def); } catch(e){}
    if(!map.getLayer(id)){ lay['text-field'] = ['concat', ['get', 'name'], '\n', ['get', 'sub']]; map.addLayer(def); }
  }
  function install(){
    if(map.getSource('firms')) return;
    var empty = fc([]);
    map.addSource('firms', { type: 'geojson', data: empty, cluster: true, clusterRadius: 46, clusterMaxZoom: 10 });
    map.addSource('firms-feat', { type: 'geojson', data: empty });
    map.addSource('firm-sel', { type: 'geojson', data: empty });
    map.addSource('me', { type: 'geojson', data: empty });
    var IM = { 'gm-pin': ['#2b3a4c', '#ffffff', 1, false], 'gm-pin-gold': ['#c9a050', '#ffffff', 1.12, true], 'gm-pin-sel': ['#142434', '#ffffff', 1.35, false, '#c9a050'], 'gm-pin-sel-gold': ['#c9a050', '#142434', 1.5, true] };
    Object.keys(IM).forEach(function(k){ if(!map.hasImage(k)) map.addImage(k, pinImage(IM[k][0], IM[k][1], IM[k][2], IM[k][3], IM[k][4]), { pixelRatio: 2 }); });
    var font = pickFonts(), tf = font.bold || font.any;
    var size = ['interpolate', ['linear'], ['zoom'], 8, 0.55, 13, 0.8];
    var notCluster = ['!', ['has', 'point_count']];

    map.addLayer({ id: 'firm-cluster-halo', type: 'circle', source: 'firms', filter: ['has', 'point_count'],
      paint: { 'circle-color': 'rgba(138,98,36,0.2)', 'circle-radius': ['step', ['get', 'point_count'], 24, 5, 28, 15, 33] } });
    map.addLayer({ id: 'firm-cluster', type: 'circle', source: 'firms', filter: ['has', 'point_count'],
      paint: { 'circle-color': '#8a6224', 'circle-radius': ['step', ['get', 'point_count'], 17, 5, 21, 15, 26], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
    var cl = { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-allow-overlap': true };
    if(tf) cl['text-font'] = tf;
    map.addLayer({ id: 'firm-cluster-count', type: 'symbol', source: 'firms', filter: ['has', 'point_count'], layout: cl, paint: { 'text-color': '#ffffff' } });

    map.addLayer({ id: 'firm-pin', type: 'symbol', source: 'firms', filter: notCluster,
      layout: { 'icon-image': 'gm-pin', 'icon-size': size, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'prio'] } });
    labelLayer('firm-label', 'firms', false, notCluster);

    map.addLayer({ id: 'firm-feat-pin', type: 'symbol', source: 'firms-feat',
      layout: { 'icon-image': 'gm-pin-gold', 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.62, 13, 0.9], 'icon-anchor': 'bottom', 'icon-allow-overlap': true } });
    labelLayer('firm-feat-label', 'firms-feat', true, null);

    map.addLayer({ id: 'firm-pin-sel', type: 'symbol', source: 'firm-sel',
      layout: { 'icon-image': ['case', ['==', ['get', 'featured'], 1], 'gm-pin-sel-gold', 'gm-pin-sel'], 'icon-size': 0.82, 'icon-anchor': 'bottom', 'icon-allow-overlap': true } });

    map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 20, 'circle-color': '#8a6224', 'circle-opacity': 0.2 } });
    map.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-radius': 7.5, 'circle-color': '#8a6224', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });

    var tapLayers = ['firm-pin', 'firm-label', 'firm-feat-pin', 'firm-feat-label', 'firm-pin-sel'];
    function pick(e){
      var f = e.features && e.features[0]; if(!f) return;
      var rec = mapDataList[f.properties.idx]; if(rec) select(rec, true);
    }
    ['firm-pin', 'firm-label', 'firm-feat-pin', 'firm-feat-label'].forEach(function(id){
      map.on('click', id, pick);
      map.on('mouseenter', id, function(){ map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, function(){ map.getCanvas().style.cursor = ''; });
    });
    map.on('click', 'firm-cluster', function(e){
      var f = e.features && e.features[0]; if(!f) return;
      var src = map.getSource('firms'), go = function(z){ map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.4, 15), duration: REDUCED ? 0 : 450 }); };
      try { var r = src.getClusterExpansionZoom(f.properties.cluster_id); if(r && r.then) r.then(go); else src.getClusterExpansionZoom(f.properties.cluster_id, function(er, z){ if(!er) go(z); }); } catch(er){}
    });
    map.on('mouseenter', 'firm-cluster', function(){ map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'firm-cluster', function(){ map.getCanvas().style.cursor = ''; });
    map.on('click', function(e){
      var hit = map.queryRenderedFeatures(e.point, { layers: tapLayers.concat(['firm-cluster']) });
      if(!hit.length){ clearSel(); if(isMobile() && (sheetState === 'half' || sheetState === 'full')) setState('peek'); }
    });
    map.on('dragstart', function(){ if(isMobile() && (sheetState === 'half' || sheetState === 'full')) setState(sel ? 'sel' : 'peek'); });
    map.on('moveend', function(e){
      if(e && e.originalEvent && !sel){ userMoved = true; if(base.length) showArea(); }
    });
  }

  /* ------------------------------------------------------------ map creation */
  ensureMap = function(){
    if(mapReady) return mapReady;
    mapReady = new Promise(function(resolve, reject){
      var settled = false;
      var timer = setTimeout(function(){ if(!settled){ settled = true; reject(new Error('Map load timed out')); } }, 12000);
      try {
        map = new maplibregl.Map({
          container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [-82.5, 44.5], zoom: 5.4,
          attributionControl: false, dragRotate: false, touchPitch: false, pitchWithRotate: false, maxZoom: 18.5
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
        map.on('load', function(){
          if(settled) return; settled = true; clearTimeout(timer);
          try { applyMapTheme(); } catch(e){ console.warn('Map theme skipped:', e); }
          var ld = $('mapLoading'); if(ld){ ld.style.opacity = 0; setTimeout(function(){ if(ld.parentNode) ld.remove(); }, 300); }
          resolve();
        });
        map.on('error', function(e){
          var msg = e && e.error && String(e.error.message || e.error);
          if(msg && /AJAXError|cloned|style/i.test(msg) && !settled){ settled = true; clearTimeout(timer); reject(e.error); }
        });
      } catch(err){ if(!settled){ settled = true; clearTimeout(timer); reject(err); } }
    }).catch(function(err){ console.error('Map failed to initialize:', err); showMapError(); throw err; });
    return mapReady;
  };

  /* ------------------------------------------------------------ page hooks */
  renderMap = async function(list){
    base = (list || []).slice();
    // the search "near a spot": the spot is where distances are measured from, and the nearest firm is listed first
    var nr = nearSel();
    if(nr){ userPos = { lat: nr.lat, lng: nr.lng }; nearOrigin = true; F.sort = 'near'; locBtn.classList.toggle('on', !!nr.me); }
    else if(nearOrigin){ nearOrigin = false; userPos = null; if(F.sort === 'near') F.sort = 'rec'; locBtn.classList.remove('on'); }
    areaB = null; hideArea(); clearSel(true); userMoved = false; page = 1; viewSig = '';
    buildChipsOnce(); renderQuery(); sizeApp(true);
    computeView(); renderPanel();
    if(isMobile()) setState('peek', true);
    loadHours().then(function(){ if(F.open) computeView(); renderPanel(); if(mapOK) drawMap(false); });
    await ensureMap();
    install(); mapOK = true; updateMe();
    drawMap(true);
    try { map.resize(); setTimeout(function(){ map.resize(); if(!userMoved && !sel && !areaB && !pendingSlug) fitView(); }, 220); } catch(e){}
    if(pendingSlug){
      var pf = base.filter(function(x){ return x.slug === pendingSlug; })[0]; pendingSlug = null;
      if(pf) select(pf);
    }
    if(pendingLocate){ pendingLocate = false; locate(); }
    try {
      var uu = new URL(location.href);
      if(selectedCase) uu.searchParams.set('case', selectedCase); else uu.searchParams.delete('case');
      uu.searchParams.delete('firm'); history.replaceState({}, '', uu);
    } catch(e){}
  };
  focusFirmOnMap = async function(slug){
    var f = base.filter(function(x){ return x.slug === slug; })[0] || firms.filter(function(x){ return x.slug === slug; })[0];
    if(!f) return;
    select(f);
  };
  openFeaturedPopup = function(f){ select(f); };


  /* ------------------------------------------------------------ search bar */
  var pendingSlug = null, pendingLocate = false;
  var IS_FIND = /find-lawyers/.test(location.pathname);
  var KW = {
    traffic: ['traffic ticket', 'traffic', 'ticket', 'speeding', 'demerit', 'stunt driving'],
    criminal: ['criminal', 'charge', 'charges', 'defence', 'defense', 'dui', 'impaired', 'assault', 'bail'],
    family: ['family', 'divorce', 'custody', 'separation', 'child support', 'spousal'],
    injury: ['personal injury', 'injury', 'injured', 'accident', 'car accident', 'slip and fall', 'whiplash'],
    realestate: ['real estate', 'house', 'home', 'closing', 'condo', 'property', 'mortgage'],
    wills: ['wills', 'will', 'estate', 'estates', 'probate', 'power of attorney', 'poa', 'inheritance'],
    business: ['business', 'corporate', 'commercial', 'incorporation', 'contract'],
    employment: ['employment', 'wrongful dismissal', 'dismissal', 'labour', 'labor', 'severance', 'workplace', 'harassment'],
    immigration: ['immigration', 'visa', 'citizenship', 'refugee', 'sponsorship', 'work permit'],
    litigation: ['litigation', 'lawsuit', 'sue', 'civil', 'dispute']
  };
  var PROVS = { 'ontario': 'ON', 'quebec': 'QC', 'british columbia': 'BC', 'alberta': 'AB', 'manitoba': 'MB', 'bc': 'BC', 'qc': 'QC', 'alta': 'AB' };
  var STOP = /\b(lawyers?|attorneys?|law firms?|firms?|a|an|the|in|for|near|me|nearby|my|need|find|i|looking|to|get)\b/g;
  function norm(x){ return String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function hasW(n, w){ return (' ' + n + ' ').indexOf(' ' + w + ' ') >= 0; }
  var CITIES = null;
  function cities(){
    if(CITIES) return CITIES;
    CITIES = (typeof CITY_INDEX !== 'undefined' ? CITY_INDEX : []).map(function(c){ return { c: c, n: norm(c.name) }; });
    CITIES.sort(function(a, b){ return b.n.length - a.n.length; });
    return CITIES;
  }
  function parseQ(q){
    var n = norm(q), r = { n: n, city: null, prov: null, kase: null, near: /\b(near me|nearby|close to me|around me)\b/.test(n) }, rest = n, i;
    for(i = 0; i < cities().length; i++){ var c = cities()[i]; if(c.n.length > 2 && hasW(rest, c.n)){ r.city = c.c; rest = (' ' + rest + ' ').replace(' ' + c.n + ' ', ' ').trim(); break; } }
    if(!r.city) Object.keys(PROVS).forEach(function(k){ if(!r.prov && hasW(rest, k)){ r.prov = PROVS[k]; rest = (' ' + rest + ' ').replace(' ' + k + ' ', ' ').trim(); } });
    var best = 0;
    Object.keys(KW).forEach(function(id){ KW[id].forEach(function(w){ if(w.length > best && hasW(rest, w)){ r.kase = id; best = w.length; } }); });
    if(r.kase) KW[r.kase].forEach(function(w){ rest = (' ' + rest + ' ').replace(' ' + w + ' ', ' ').trim(); });
    r.tail = rest.replace(STOP, ' ').replace(/\s+/g, ' ').trim();
    return r;
  }
  function curTarget(){
    if(selectedCityName){ var c = cities().filter(function(x){ return x.c.name === selectedCityName && x.c.province === selectedProvince; })[0]; if(c) return { city: c.c }; }
    return { prov: selectedProvince };
  }
  function tgtLabel(t){
    if(t.city) return t.city.name + ', ' + t.city.province;
    if(t.prov) return (typeof PROVINCE_LABEL !== 'undefined' && PROVINCE_LABEL[t.prov]) || t.prov;
    return placeLabel(true);
  }
  function combo(kase, t, extra){
    var what = kase ? lawyersLabel(kase, t.city ? t.city.province : (t.prov || selectedProvince)) : 'Lawyers';
    return { kind: 'combo', icon: kase ? 'search' : 'pin', main: what + ' in ' + tgtLabel(t), sub: extra || (kase ? 'Practice area' : 'All practice areas'),
      t: { caseId: kase || null, city: t.city || null, prov: t.prov || null } };
  }
  /* towns with no firm of their own: places.json is fetched the first time a few letters are typed */
  var placesP = null, placesReady = false;
  function loadPlacesLib(){
    if(placesP) return placesP;
    placesP = new Promise(function(res, rej){
      function go(){ window.LawdbPlaces.load(ROOT).then(function(){ placesReady = true; res(); }, rej); }
      if(window.LawdbPlaces) return go();
      var sc = document.createElement('script'); sc.src = ROOT + 'lawdb-places.js?v=1'; sc.onload = go; sc.onerror = function(){ rej(new Error('places')); };
      document.head.appendChild(sc);
    }).catch(function(){ placesP = null; });
    return placesP;
  }
  function suggestions(q){
    var items = [], seen = {}, p = parseQ(q), cur = curTarget();
    function add(it){ var k = it.kind + '|' + it.main; if(seen[k]) return; seen[k] = 1; items.push(it); }
    var nearIt = function(kase){ return { kind: 'near', icon: 'near', main: 'Lawyers near me', sub: 'Use my location', t: { near: true, caseId: kase || selectedCase || null } }; };
    if(!p.n){
      add(nearIt());
      (typeof CASE_TYPES !== 'undefined' ? CASE_TYPES : []).forEach(function(c){ add(combo(c.id, cur)); });
      return items.slice(0, 9);
    }
    if(p.near) add(nearIt(p.kase));
    var tgt = p.city ? { city: p.city } : (p.prov ? { prov: p.prov } : cur);
    if(p.kase) add(combo(p.kase, tgt));
    if(p.city || p.prov) add(combo(p.kase ? null : null, tgt, 'All practice areas'));
    if(p.city && !p.kase){ (typeof CASE_TYPES !== 'undefined' ? CASE_TYPES : []).slice(0, 5).forEach(function(c){ add(combo(c.id, tgt)); }); }
    var tail = p.tail;
    if(tail.length >= 2 && !(p.city && !p.tail)){
      cities().filter(function(c){ return c.n.indexOf(tail) === 0 || c.n.indexOf(' ' + tail) >= 0; }).slice(0, 4).forEach(function(c){
        add(combo(p.kase, { city: c.c }, p.kase ? 'Practice area' : 'City'));
      });
      if(!p.kase) Object.keys(KW).forEach(function(id){
        if(KW[id].some(function(w){ return w.indexOf(tail) === 0; }) || norm(AREA[id]).indexOf(tail) === 0) add(combo(id, tgt));
      });
      Object.keys(PROVS).forEach(function(k){ if(k.length > 3 && k.indexOf(tail) === 0) add(combo(p.kase, { prov: PROVS[k] }, 'Province')); });
      if(placesReady && tail.length >= 3 && !p.city){
        window.LawdbPlaces.suggest(tail, 6).filter(function(pl){
          return !cities().some(function(c){ return c.c.name === pl.name && c.c.province === pl.prov; });
        }).slice(0, 3).forEach(function(pl){
          add({ kind: 'place', icon: 'pin', main: pl.label, sub: (p.kase ? lawyersLabel(p.kase, pl.prov) : 'Lawyers') + ' nearest to ' + pl.name, t: { place: pl, caseId: p.kase || null } });
        });
      }
    }
    var fq = p.n.replace(STOP, ' ').replace(/\s+/g, ' ').trim();
    if(fq.length >= 3){
      var fm = firms.filter(function(f){ return norm(f.name).indexOf(fq) >= 0; }).sort(function(a, b){ var sa = (a.city === selectedCityName ? 2 : 0) + (a.province === selectedProvince ? 1 : 0), sb = (b.city === selectedCityName ? 2 : 0) + (b.province === selectedProvince ? 1 : 0); return (sb - sa) || ((b.featured ? 1 : 0) - (a.featured ? 1 : 0)) || (b.count - a.count); }).slice(0, 4);
      fm.forEach(function(f){ add({ kind: 'firm', icon: 'firm', main: f.name, sub: 'Law firm · ' + f.city + ', ' + f.province, t: { slug: f.slug } }); });
    }
    return items.slice(0, 9);
  }
  var SUGICO = {
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    near: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8a6224" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>',
    firm: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/></svg>'
  };
  var sugItems = [], sugIdx = -1;
  function drawSug(){
    var box = $('gmSug'), q = $('gmQ').value;
    var val = (document.activeElement === $('gmQ') && q === queryText()) ? '' : q;
    sugItems = suggestions(val); sugIdx = -1;
    if(!sugItems.length){
      box.innerHTML = '<div class="gm-sug-empty">No match yet. Try a city or a practice area, like <b>family lawyer in Ottawa</b>.</div>';
    } else {
      box.innerHTML = (val ? '' : '<div class="gm-sug-h">Try</div>') + sugItems.map(function(it, i){
        return '<div class="gm-sug-i" role="option" id="gmSug' + i + '" data-i="' + i + '"><span class="gm-sug-ico">' + SUGICO[it.icon] + '</span><span class="gm-sug-t"><b>' + esc(it.main) + '</b><small>' + esc(it.sub) + '</small></span></div>';
      }).join('');
    }
    box.hidden = false; $('gmTop').classList.add('searching');
  }
  function closeSug(){ var b = $('gmSug'); if(b) b.hidden = true; var t = $('gmTop'); if(t) t.classList.remove('searching'); sugIdx = -1; }
  function markSug(){
    var rows = $('gmSug').querySelectorAll('.gm-sug-i');
    for(var i = 0; i < rows.length; i++) rows[i].classList.toggle('on', i === sugIdx);
    if(rows[sugIdx]) rows[sugIdx].scrollIntoView({ block: 'nearest' });
  }
  function chooseSug(it){
    if(!it) return;
    closeSug(); $('gmQ').blur();
    go(it.t);
  }
  function go(t){
    var kase = Object.prototype.hasOwnProperty.call(t, 'caseId') ? t.caseId : selectedCase;
    if(t.place){
      var spot = { lat: t.place.lat, lng: t.place.lng, label: t.place.label, prov: t.place.prov, me: false };
      if(!IS_FIND || typeof selectedNear === 'undefined'){ location.href = ROOT + 'find-lawyers?near=' + encodeURIComponent(spot.label) + (kase ? '&case=' + encodeURIComponent(kase) : ''); return; }
      selectedNear = spot; selectedCase = kase; selectedProvince = spot.prov; selectedRegion = null; selectedCityName = null;
      try { var nu = new URL(location.href); nu.searchParams.set('near', spot.label); history.replaceState({}, '', nu); } catch(e){}
      showResults(true);
      return;
    }
    if(!t.near) setNear(null);
    if(t.near){
      if(kase !== selectedCase){ pendingLocate = true; selectedCase = kase; showResults(true); } else locate();
      return;
    }
    if(t.slug){
      var f = firms.filter(function(x){ return x.slug === t.slug; })[0]; if(!f) return;
      var path = typeof CITY_PAGE_MAP !== 'undefined' && CITY_PAGE_MAP[f.city + '|' + f.province];
      var inBase = base.filter(function(x){ return x.slug === f.slug; })[0];
      if(inBase){ select(inBase); return; }
      if(!IS_FIND && path && selectedCityName !== f.city){ location.href = ROOT + path + '?firm=' + encodeURIComponent(f.slug); return; }
      pendingSlug = f.slug; selectedCase = null; selectedProvince = f.province; selectedRegion = f.region; selectedCityName = f.city; showResults(true);
      return;
    }
    if(t.city){
      var key = t.city.name + '|' + t.city.province;
      var cp = typeof CITY_PAGE_MAP !== 'undefined' && CITY_PAGE_MAP[key];
      var same = selectedCityName === t.city.name && selectedProvince === t.city.province;
      if(cp && !same){ location.href = ROOT + cp + (kase ? '?case=' + encodeURIComponent(kase) : ''); return; }
      selectedCase = kase; selectedProvince = t.city.province; selectedRegion = t.city.region; selectedCityName = t.city.name; showResults(true);
      return;
    }
    if(t.prov){
      if(!IS_FIND){ location.href = ROOT + 'find-lawyers?province=' + t.prov + (kase ? '&case=' + encodeURIComponent(kase) : ''); return; }
      selectedCase = kase; selectedProvince = t.prov; selectedRegion = null; selectedCityName = null; showResults(true);
      return;
    }
    selectedCase = kase; showResults(true);
  }
  /* A city page or province hub carries only its own province's firms (LAWDB_SCOPE). The rest are fetched the first time the search box is used,
     so a firm from another province can still be found by name. */
  var allFirms = null;
  function ensureAllFirms(){
    if(typeof LAWDB_SCOPE === 'undefined') return Promise.resolve();
    if(allFirms) return allFirms;
    allFirms = fetch(ROOT + 'firms_data.json').then(function(r){ return r.json(); }).then(function(list){
      var have = {}; firms.forEach(function(f){ have[f.slug] = 1; });
      list.forEach(function(f){
        if(have[f.slug]) return;
        f.dirUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(f.address || f.name).replace(/%20/g, '+');
        firms.push(f);
      });
    }).catch(function(){ allFirms = null; });
    return allFirms;
  }
  function wireSearch(){
    var q = $('gmQ'), box = $('gmSug');
    q.addEventListener('focus', function(){ setTimeout(function(){ try { q.select(); } catch(e){} }, 0); drawSug(); if(isMobile() && !sel) setState('peek'); ensureAllFirms().then(function(){ if(document.activeElement === q) drawSug(); }); });
    q.addEventListener('input', function(){ drawSug(); if(q.value.length >= 3 && !placesReady) loadPlacesLib().then(function(){ if(document.activeElement === q) drawSug(); }); });
    q.addEventListener('blur', function(){ setTimeout(function(){ closeSug(); renderQuery(); }, 160); });
    q.addEventListener('keydown', function(e){
      var n = sugItems.length;
      if(e.key === 'ArrowDown'){ e.preventDefault(); if(box.hidden) drawSug(); sugIdx = n ? (sugIdx + 1) % n : -1; markSug(); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); sugIdx = n ? (sugIdx <= 0 ? n - 1 : sugIdx - 1) : -1; markSug(); }
      else if(e.key === 'Enter'){
        e.preventDefault();
        var it = sugItems[sugIdx >= 0 ? sugIdx : 0];
        if(!it){ drawSug(); return; }
        chooseSug(it);
      }
      else if(e.key === 'Escape'){ closeSug(); q.blur(); }
    });
    box.addEventListener('mousedown', function(e){ e.preventDefault(); });
    box.addEventListener('click', function(e){ var r = e.target.closest('.gm-sug-i'); if(r) chooseSug(sugItems[+r.dataset.i]); });
    $('gmX').addEventListener('mousedown', function(e){ e.preventDefault(); });
    $('gmX').addEventListener('click', function(){
      if(document.activeElement === q || q.value){ q.value = ''; q.focus(); drawSug(); }
      else { q.focus(); }
    });
    $('gmSearchBtn').addEventListener('click', function(){ q.focus(); });
  }
  (function(){
    var u = new URLSearchParams(location.search);
    if(!IS_FIND){
      var c = u.get('case'); if(c && typeof CASE_TYPES !== 'undefined' && CASE_TYPES.some(function(x){ return x.id === c; })) selectedCase = c;
    }
    var fs = u.get('firm'); if(fs) pendingSlug = fs;
  })();

  /* fit the whole app into what is left of the screen below the page header/intro */
  var lastW = 0, lastH = 0;
  function sizeApp(force){
    if(!app) return;
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight, vw = window.innerWidth;
    if(!force && vw === lastW && Math.abs(vh - lastH) < 120) return;
    lastW = vw; lastH = vh;
    var top = app.getBoundingClientRect().top + (window.pageYOffset || 0);
    var h = Math.round(vh - Math.min(top, vh * 0.45) - (isMobile() ? 6 : 58));
    app.style.setProperty('--gm-h', Math.max(isMobile() ? 480 : 560, Math.min(h, 920)) + 'px');
    if(isMobile()) setState(sel ? 'sel' : sheetState === 'sel' ? 'peek' : sheetState, true);
    if(mapOK) map.resize();
  }
  /* ------------------------------------------------------------ DOM build */
  var chipsBuilt = false;
  function buildChipsOnce(){ if(!chipsBuilt){ buildChips(); chipsBuilt = true; } }

  /* the heading block above the search: an eyebrow, the page's own h1 (its place in gold italic) and one line under it. City and province pages
     already have their h1 in a .city-hero, which is kept as it is for search engines and only styled; the Find page gets its own. */
  function buildHead(wrap, before){
    var head = document.querySelector('.city-hero');
    if(!head){
      head = document.createElement('header'); head.className = 'gm-head';
      head.innerHTML = '<h1>Trusted legal help,<span class="gm-brk"></span> <em>near you.</em></h1><p>Search by location, practice area or firm name. Every firm shows its public Google rating, and none can pay to change it.</p>';
      wrap.insertBefore(head, before);
    } else {
      var h1 = head.querySelector('h1'), m = h1 && !h1.querySelector('em') && h1.textContent.match(/^(Find a Lawyer in )(.+)$/i);
      if(m) h1.innerHTML = esc(m[1]) + '<em>' + esc(m[2]) + '</em>';
    }
    head.classList.add('gm-head');
    var eb = document.createElement('div'); eb.className = 'gm-eyebrow'; eb.textContent = 'Find a lawyer';
    head.insertBefore(eb, head.firstChild);
  }

  function build(){
    var wrap = document.querySelector('.results-wrap'), stack = document.querySelector('.content-stack'), card = document.querySelector('.map-card');
    if(!wrap || !stack || !card) return false;
    document.body.classList.add('gm-on');
    app = document.createElement('div'); app.className = 'gm-app'; app.id = 'gmApp'; app.dataset.state = 'peek';
    app.innerHTML =
      '<div class="gm-mapwrap" id="gmMapWrap">' +
        '<button type="button" class="gm-area" id="gmArea" hidden>' + IC.pinG + 'Search this area</button>' +
        '<div class="gm-ctrls" id="gmCtrls">' +
          '<div class="gm-zoom"><button type="button" class="gm-zbtn" id="gmZin" aria-label="Zoom in">' + IC.plus + '</button><button type="button" class="gm-zbtn" id="gmZout" aria-label="Zoom out">' + IC.minus + '</button></div>' +
          '<button type="button" class="gm-loc" id="gmLoc" aria-label="Show lawyers near my location">' + IC.loc + '</button>' +
        '</div>' +
        '<div class="gm-toast" id="gmToast" role="status" hidden></div>' +
      '</div>' +
      '<aside class="gm-panel" id="gmPanel" aria-label="Law firm results">' +
        '<button type="button" class="gm-grab" id="gmGrab" aria-label="Expand or collapse results"><span></span></button>' +
        '<div class="gm-phead"><div><b id="gmCount"></b><small id="gmSub"></small></div>' +
          '<div class="gm-sortwrap"><button type="button" class="gm-sortbtn" id="gmSort" aria-haspopup="true" aria-expanded="false"><span class="gm-sortlbl">Sort:</span><span id="gmSortName">Recommended</span> ' + IC.chev + '</button>' +
          '<div class="gm-menu" id="gmMenu" role="menu" hidden></div></div></div>' +
        '<div class="gm-scroll" id="gmScroll"><div class="gm-sel" id="gmSel" hidden></div><div class="gm-list" id="gmList"></div></div>' +
      '</aside>';
    /* heading, then the search pill with the filters beside it, then the map card */
    buildHead(wrap, stack);
    var bar = document.createElement('div'); bar.className = 'gm-top'; bar.id = 'gmTop';
    bar.innerHTML =
      '<div class="gm-searchwrap"><div class="gm-search" role="search"><button type="button" class="gm-sbtn" id="gmSearchBtn" aria-label="Search">' + IC.search + '</button>' +
        '<input class="gm-q" id="gmQ" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search a city or type of lawyer" aria-label="Search lawyers by city or practice area" role="combobox" aria-expanded="false" aria-controls="gmSug">' +
        '<button type="button" class="gm-x" id="gmX" aria-label="Clear search">' + IC.x + '</button>' +
        '<button type="button" class="gm-filter" id="gmFilter" aria-label="Choose a type of lawyer">' + IC.sliders + '</button></div>' +
        '<div class="gm-sug" id="gmSug" role="listbox" hidden></div></div>' +
      '<div class="gm-chips" id="gmChips" role="group" aria-label="Filters"></div>';
    wrap.insertBefore(bar, stack);
    wrap.insertBefore(app, stack);
    mapWrap = $('gmMapWrap'); panel = $('gmPanel'); scrollEl = $('gmScroll'); listEl = $('gmList'); selEl = $('gmSel'); areaBtn = $('gmArea'); locBtn = $('gmLoc');
    mapWrap.insertBefore(card, mapWrap.firstChild);
    var note = $('provinceNote'); if(note) scrollEl.insertBefore(note, selEl);
    var lb = $('listBody'); if(lb) scrollEl.appendChild(lb);
    var h2 = document.querySelector('.map-col h2'); if(h2) h2.textContent = 'On the map';

    /* sort menu */
    var menu = $('gmMenu');
    function drawMenu(){
      menu.innerHTML = SORTS.map(function(s){
        return '<button type="button" role="menuitemradio" data-sort="' + s[0] + '" aria-checked="' + (F.sort === s[0]) + '">' + s[1] + '</button>';
      }).join('');
    }
    $('gmSort').addEventListener('click', function(e){
      e.stopPropagation(); drawMenu();
      var open = menu.hidden; menu.hidden = !open; this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.addEventListener('click', function(e){
      var b = e.target.closest('button[data-sort]'); if(!b) return;
      F.sort = b.dataset.sort; menu.hidden = true; $('gmSort').setAttribute('aria-expanded', 'false');
      if(F.sort === 'near' && !userPos && !mapOK) F.sort = 'rec';
      apply(false); scrollEl.scrollTop = 0;
    });
    document.addEventListener('click', function(){ menu.hidden = true; $('gmSort').setAttribute('aria-expanded', 'false'); });

    /* chips */
    $('gmChips').addEventListener('click', function(e){
      var c = e.target.closest('.gm-chip'); if(!c) return;
      if(c.dataset.case){ selectedCase = selectedCase === c.dataset.case ? null : c.dataset.case; showResults(true); return; }
      var k = c.dataset.k; F[k] = !F[k];
      if(k === 'open' && F.open && !hours){ loadHours().then(function(){ apply(true); }); syncChips(); return; }
      areaB = null; hideArea();
      apply(true);
    });

    wireSearch();

    /* area + locate */
    areaBtn.addEventListener('click', function(){
      if(!mapOK) return;
      areaB = map.getBounds(); hideArea(); userMoved = false;
      apply(false); scrollEl.scrollTop = 0;
      if(isMobile() && !sel) setState('half');
    });
    locBtn.addEventListener('click', locate);
    $('gmZin').addEventListener('click', function(){ if(mapOK) map.zoomIn({ duration: REDUCED ? 0 : 250 }); });
    $('gmZout').addEventListener('click', function(){ if(mapOK) map.zoomOut({ duration: REDUCED ? 0 : 250 }); });
    $('gmFilter').addEventListener('mousedown', function(e){ e.preventDefault(); });
    $('gmFilter').addEventListener('click', function(){ var q = $('gmQ'); if(document.activeElement !== q) q.focus(); q.value = ''; drawSug(); });

    /* list / selection delegation */
    function onItem(e){
      var pg = e.target.closest && e.target.closest('[data-pg]');
      if(pg){
        var n = +pg.dataset.pg;
        if(!pg.disabled && n >= 1 && n !== page){
          page = n; renderPanel(); scrollEl.scrollTop = 0;
          var on = e.detail === 0 && listEl.querySelector('.gm-pg-n.on'); if(on) on.focus({ preventScroll: true });
        }
        return;
      }
      if(e.target.closest('[data-back]')){ clearSel(); return; }
      if(e.target.closest('[data-reset]')){
        if(areaB){ areaB = null; apply(true); }
        else { F.feat = F.top = F.rev = F.open = false; apply(true); }
        return;
      }
      if(e.target.closest('#gmAll')){ areaB = null; apply(true); return; }
    }
    panel.addEventListener('click', onItem);

    setupSheet();
    var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ sizeApp(false); if(mapOK) map.resize(); if(view.length > PER && pageSlots() !== lastSlots) renderPanel(); }, 120); });
    window.addEventListener('orientationchange', function(){ setTimeout(function(){ sizeApp(true); }, 250); });
    var onMQ = function(){ setState(sheetState === 'sel' && !sel ? 'peek' : sheetState, true); if(mapOK) setTimeout(function(){ map.resize(); }, 50); };
    if(MQ.addEventListener) MQ.addEventListener('change', onMQ); else if(MQ.addListener) MQ.addListener(onMQ);
    return true;
  }

  /* an earlier version of the page may already have started its own map: restart cleanly */
  if(mapReady){ try { map.remove(); } catch(e){} map = null; mapReady = null; }
  if(!build()) return;
  sizeApp(true); setState('peek', true);
  var res = $('results');
  if(res && res.classList.contains('active')){
    try { showResults(true); } catch(e){}
  }
})();
