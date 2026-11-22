/* Decorative map of Canada on the home page: a ring of firm logos laid over images/ca-map.svg. It is only a picture (nothing to click or hover).
   Data: GET /api/map -> {w, h, logos: [[cityKey, x, y, logoUrl, background?], ...]}, x/y already projected onto the drawing, about 120 logos in all
   (more than are placed: a logo too wide to read in a small circle is left out). The logos are the site's own files.
   Nothing is fetched until the map is about to scroll into view. A logo that fails to load is simply left out. */
(function () {
  'use strict';
  var root = document.getElementById('hmMap');
  if (!root) return;
  var started = false;

  function start() {
    if (started) return; started = true;
    fetch('/api/map', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (d) {
      var W = d.w, H = d.h, queue = (d.logos || []).slice(), order = 0, POOL = 8, placed = [];
      // On a phone the map is wider than the screen and scrolls sideways: start where most of the firms are, not at the left edge (British Columbia).
      var sc = document.getElementById('hmScroll');
      if (sc && queue.length && sc.scrollLeft === 0 && sc.scrollWidth > sc.clientWidth) {
        var mean = 0; for (var q = 0; q < queue.length; q++) mean += queue[q][1]; mean /= queue.length;
        sc.scrollLeft = Math.max(0, Math.min(mean / W * sc.scrollWidth - sc.clientWidth / 2, sc.scrollWidth - sc.clientWidth));
      }
      // Each logo goes as near its city as it can without sitting on another one (a spiral out from the city's point), so a busy city
      // is a tidy cluster you can read, not a pile. D is a logo's width in the drawing's own units.
      function place(l, im) {
        var p = document.createElement('span'); p.className = 'hm-pin'; p.setAttribute('aria-hidden', 'true');
        if (/^#[0-9a-f]{6}$/i.test(l[4] || '')) { p.className += ' full'; p.style.background = l[4]; } // a logo drawn on its own colour fills the circle
        im.alt = ''; p.appendChild(im); root.appendChild(p);
        var D = root.clientWidth ? p.offsetWidth / root.clientWidth * W * 0.96 : 0, k = 0, x, y;
        function spot() { // the k-th place to try, kept inside the drawing
          var a = k * 2.4, r = k ? D * 0.5 * Math.sqrt(k) : 0;
          x = Math.min(Math.max(l[1] + r * Math.cos(a), D / 2), W - D / 2); y = Math.min(Math.max(l[2] + r * Math.sin(a), D / 2), H - D / 2);
        }
        function free() { for (var i = 0; i < placed.length; i++) { var dx = placed[i][0] - x, dy = placed[i][1] - y; if (dx * dx + dy * dy < D * D) return false; } return true; }
        spot();
        while (D && k < 500 && !free()) { k++; spot(); }
        if (D && k >= 500) { root.removeChild(p); return; }       // no room left around this city
        placed.push([x, y]);
        p.style.left = (x / W * 100).toFixed(2) + '%';
        p.style.top = (y / H * 100).toFixed(2) + '%';
        p.style.zIndex = String(++order % 40);
        p.style.animationDelay = Math.min(order * 14, 900) + 'ms';
      }
      function next() {
        if (!queue.length) return;
        var l = queue.shift(), im = new Image(), done = false;
        function fin(ok) {
          if (done) return; done = true;
          var w = im.naturalWidth, h = im.naturalHeight;
          // too small to see, or a wide wordmark that would be a smudge in a circle: skip it
          if (ok && w >= 24 && h >= 24 && w / h <= 2.4 && h / w <= 2.4) place(l, im);
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
