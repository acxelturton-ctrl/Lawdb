/* Decorative map of Canada on the home page: a ring of firm logos laid over images/ca-map.svg. It is only a picture (nothing to click or hover).
   Data: GET /api/map -> {w, h, logos: [[cityKey, x, y, logoUrl, background?], ...]}, x/y already projected onto the drawing, about 100 logos in all
   (the site's own logo files). The logos of one city make a ring around it, like the map on lawdb.ai.
   Nothing is fetched until the map is about to scroll into view. A logo that fails to load is simply left out. */
(function () {
  'use strict';
  var root = document.getElementById('hmMap');
  if (!root) return;
  var started = false;

  function start() {
    if (started) return; started = true;
    fetch('/api/map', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (d) {
      var W = d.w, H = d.h, queue = (d.logos || []).slice(), perCity = {}, order = 0, POOL = 8;
      // On a phone the map is wider than the screen and scrolls sideways: start at the stretch with the most logos in it (the part a phone shows), not at the
      // left edge (British Columbia). A visitor who has already scrolled is left alone.
      var sc = document.getElementById('hmScroll');
      if (sc && queue.length && sc.scrollLeft === 0 && sc.scrollWidth > sc.clientWidth) {
        var span = sc.clientWidth / sc.scrollWidth * W, xs = queue.map(function (l) { return l[1]; }).sort(function (u, v) { return u - v; }), best = 0, at = xs[0];
        for (var lo = 0, hi = 0; hi < xs.length; hi++) {
          while (xs[hi] - xs[lo] > span) lo++;
          if (hi - lo + 1 > best) { best = hi - lo + 1; at = (xs[lo] + xs[hi]) / 2; }
        }
        sc.scrollLeft = Math.max(0, Math.min(at / W * sc.scrollWidth - sc.clientWidth / 2, sc.scrollWidth - sc.clientWidth));
      }
      function place(l, im) {
        var n = perCity[l[0]] = (perCity[l[0]] || 0) + 1; n -= 1;
        var a = n * 2.4, r = n === 0 ? 0 : 10 * Math.sqrt(n);          // sunflower spiral around the city's point
        var p = document.createElement('span'); p.className = 'hm-pin'; p.setAttribute('aria-hidden', 'true');
        if (/^#[0-9a-f]{6}$/i.test(l[4] || '')) { p.className += ' full'; p.style.background = l[4]; } // a logo drawn on its own colour fills the circle
        p.style.left = ((l[1] + r * Math.cos(a)) / W * 100).toFixed(2) + '%';
        p.style.top = ((l[2] + r * Math.sin(a)) / H * 100).toFixed(2) + '%';
        p.style.zIndex = String(++order % 40);
        p.style.animationDelay = Math.min(order * 14, 900) + 'ms';
        im.alt = ''; p.appendChild(im); root.appendChild(p);
      }
      function next() {
        if (!queue.length) return;
        var l = queue.shift(), im = new Image(), done = false;
        function fin(ok) {
          if (done) return; done = true;
          if (ok && im.naturalWidth >= 24 && im.naturalHeight >= 24) place(l, im);
          next();
        }
        im.decoding = 'async';
        im.addEventListener('load', function () { fin(true); });
        im.addEventListener('error', function () { fin(false); });
        setTimeout(function () { fin(false); }, 10000);
        im.src = l[3];
      }
      for (var j = 0; j < POOL; j++) next();
    }).catch(function () { /* the plain map is still a fine picture */ });
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es, o) { if (es[0].isIntersecting) { o.disconnect(); start(); } }, { rootMargin: '300px 0px' }).observe(root);
  } else start();
})();
