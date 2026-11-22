/* Decorative map of Canada on the home page: firm logos laid over images/ca-map.svg. It is only a picture (nothing to click or hover).
   Data: GET /api/map (?small=1 on a phone) -> {w, h, logos: [[cityKey, x, y, logoUrl, background?], ...]}: where each logo goes on the drawing, worked out on the
   server (the logos scattered evenly over each province, all on land and inside the firm's own province, clear of the badge). The logos are the site's own files.
   Nothing is fetched until the map is about to scroll into view. A logo that fails to load is simply left out. */
(function () {
  'use strict';
  var root = document.getElementById('hmMap');
  if (!root) return;
  var started = false;

  function start() {
    if (started) return; started = true;
    var small = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches); // a phone shows the whole map 390 pixels wide: fewer, spaced for bigger logos
    fetch('/api/map' + (small ? '?small=1' : ''), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (d) {
      var W = d.w, H = d.h, queue = (d.logos || []).slice(), order = 0, POOL = 8;
      function place(l, im) {
        var p = document.createElement('span'); p.className = 'hm-pin'; p.setAttribute('aria-hidden', 'true');
        if (/^#[0-9a-f]{6}$/i.test(l[4] || '')) { p.className += ' full'; p.style.background = l[4]; } // a logo drawn on its own colour fills the circle
        p.style.left = (l[1] / W * 100).toFixed(2) + '%';
        p.style.top = (l[2] / H * 100).toFixed(2) + '%';
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
