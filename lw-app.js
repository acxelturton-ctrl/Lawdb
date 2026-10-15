/* The signed-in side of the website. Loaded on every public page once someone has signed in on this device (site.js decides),
   and on /account/. It gives members the same experience everywhere: an avatar in the header that opens their account panel,
   a bottom tab bar on phones (Home, Find, Feed, Saved, Me) and, on the home page, a short "Your feed". */
(function () {
  if (window.lawdbApp || /^\/admin/.test(location.pathname)) return;
  window.lawdbApp = true;

  var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/lw-app.css'; document.head.appendChild(link);

  var ICON = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></svg>',
    saved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><path d="M16 5a3.5 3.5 0 010 6.5M18 14c2 .7 3.2 2.600 3.500 6"/></svg>',
    firm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.500 4-6 8-6s7 1.500 8 6"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/></svg>'
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var all = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };
  var initials = function (me) {
    var n = (me.name || '').trim();
    if (n) { var p = n.split(/\s+/); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
    return (me.email || '?')[0].toUpperCase();
  };
  var face = function (me) { return me.avatar ? '<img alt="" src="' + esc(me.avatar) + '">' : esc(initials(me)); };
  var signedOut = function () {
    try { localStorage.setItem('lawdb_in', '0'); sessionStorage.removeItem('lawdb_me'); } catch (e) {}
    all('.lw-ava,.lw-tabbar,.lw-ov,.lw-panel').forEach(function (el) { el.remove(); });
    document.body.classList.remove('lw-has-tabs');
  };

  function me(cb) {
    var cached = null;
    try { var j = JSON.parse(sessionStorage.getItem('lawdb_me') || 'null'); if (j && Date.now() - j.t < 60000) cached = j.v; } catch (e) {}
    if (cached) cb(cached);
    fetch('/api/account/me', { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { if (!cached) cb(null); else signedOut(); return null; }
      return r.json();
    }).then(function (d) {
      if (!d || !d.user) return;
      var v = { name: d.user.name || '', email: d.user.email, role: d.user.role, jobTitle: d.user.jobTitle || '', employer: d.user.employer || '', avatar: d.user.avatar || '', onboarded: d.user.onboarded !== false,
        firms: (d.memberships || []).filter(function (m) { return m.status === 'approved'; }).length };
      try { sessionStorage.setItem('lawdb_me', JSON.stringify({ t: Date.now(), v: v })); localStorage.setItem('lawdb_in', '1'); } catch (e) {}
      if (!cached) cb(v);
      else if (JSON.stringify(cached) !== JSON.stringify(v)) { all('.lw-ava,.lw-tabbar,.lw-ov,.lw-panel').forEach(function (el) { el.remove(); }); document.body.classList.remove('lw-has-tabs'); build(v); }
    }).catch(function () { if (!cached) cb(null); });
  }

  function build(m) {
    if ($('.lw-panel')) return;
    var line = [m.jobTitle, m.employer].filter(Boolean).join(' at ');
    var ov = document.createElement('div'); ov.className = 'lw-ov';
    var panel = document.createElement('aside'); panel.className = 'lw-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Your account');
    panel.innerHTML = '<button class="lw-x" type="button" aria-label="Close">&times;</button>' +
      '<div class="lw-who"><span class="lw-ava big">' + face(m) + '</span><b>' + esc(m.name || 'Your account') + '</b>' + (line ? '<small>' + esc(line) + '</small>' : '') + '<small>' + esc(m.email) + '</small></div>' +
      '<a class="lw-vp" href="/account/#profile">View profile</a>' +
      '<nav>' +
      '<a href="/account/#feed">' + ICON.feed + 'Your feed</a>' +
      '<a href="/account/#network">' + ICON.users + 'My network</a>' +
      '<a href="/account/#saved">' + ICON.saved + 'Saved stories</a>' +
      (m.firms ? '<a href="/account/#firms">' + ICON.firm + 'Dashboard: my firms</a>' : '') +
      '<a href="/account/#find">' + ICON.plus + 'Add or claim a firm</a>' +
      '<a href="/account/#profile">' + ICON.user + 'Profile and settings</a>' +
      (m.role === 'admin' ? '<a href="/admin/">' + ICON.shield + 'Admin</a>' : '') +
      '<hr><a href="#" data-out>' + ICON.out + 'Sign out</a></nav>';
    document.body.appendChild(ov); document.body.appendChild(panel);
    var open = function () { ov.classList.add('open'); panel.classList.add('open'); };
    var shut = function () { ov.classList.remove('open'); panel.classList.remove('open'); };
    ov.addEventListener('click', shut); $('.lw-x', panel).addEventListener('click', shut);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
    all('a', panel).forEach(function (a) { a.addEventListener('click', function () { shut(); }); });
    $('[data-out]', panel).addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .catch(function () {}).then(function () { signedOut(); location.href = '/'; });
    });

    // avatar in the header (replaces the Sign in / My account link in the top menu)
    var right = $('.site-header .header-right');
    all('.desktop-nav a[href="/account/"]').forEach(function (a) { a.remove(); });
    all('.menu-drawer a[href="/account/"]').forEach(function (a) { a.textContent = 'My account'; });
    if (right && !$('.lw-ava', right)) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'lw-ava'; b.setAttribute('aria-label', 'Your account'); b.innerHTML = face(m);
      b.addEventListener('click', open);
      var ham = $('.hamburger-btn', right); right.insertBefore(b, ham || null);
      // phones show the avatar next to the menu button; the menu button stays for the rest of the site
    }

    // bottom tab bar on phones
    var bar = document.createElement('nav'); bar.className = 'lw-tabbar'; bar.setAttribute('aria-label', 'Member navigation');
    var tabs = [['home', 'Home', '/'], ['find', 'Find', '/find-lawyers'], ['network', 'Network', '/account/#network'], ['feed', 'Feed', '/account/#feed']];
    bar.innerHTML = tabs.map(function (t) { return '<a href="' + t[2] + '" data-t="' + t[0] + '">' + (ICON[t[0]] || ICON.users) + t[1] + '</a>'; }).join('') +
      '<button type="button" data-t="me"><span class="lw-ava">' + face(m) + '</span>Me</button>';
    document.body.appendChild(bar); document.body.classList.add('lw-has-tabs');
    $('[data-t="me"]', bar).addEventListener('click', open);
    var mark = function () {
      var p = location.pathname, h = location.hash.replace('#', ''), on = '';
      if (p === '/') on = 'home';
      else if (/^\/find-lawyers/.test(p)) on = 'find';
      else if (p === '/account/') on = (h === '' || h === 'feed') ? 'feed' : (h === 'network' || h === 'following') ? 'network' : '';
      all('[data-t]', bar).forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-t') === on); });
    };
    mark(); window.addEventListener('hashchange', mark);
    window.lawdbOpenPanel = open;
    dots();
  }

  // a dot on Feed (and on your avatar) when the firms you follow have posted since you last looked
  function paintDot(n) {
    all('.lw-dot').forEach(function (d) { d.remove(); });
    if (!n) return;
    var feed = $('.lw-tabbar [data-t="feed"]'); if (feed) { var d1 = document.createElement('i'); d1.className = 'lw-dot'; d1.textContent = n > 9 ? '9+' : n; feed.style.position = 'relative'; feed.appendChild(d1); }
    var ava = $('.site-header .lw-ava'); if (ava) { var d2 = document.createElement('i'); d2.className = 'lw-dot sm'; ava.style.position = 'relative'; ava.appendChild(d2); }
  }
  window.lawdbDot = paintDot;
  function dots() {
    var c = null;
    try { var j = JSON.parse(sessionStorage.getItem('lawdb_notif') || 'null'); if (j && Date.now() - j.t < 60000) c = j.n; } catch (e) {}
    if (c !== null) return paintDot(c);
    fetch('/api/account/notifications', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return; try { sessionStorage.setItem('lawdb_notif', JSON.stringify({ t: Date.now(), n: d.unseen })); } catch (e) {}
      paintDot(d.unseen);
    }).catch(function () {});
  }

  // the home page: a short "Your feed" under the search
  function homeFeed() {
    if (location.pathname !== '/') return;
    var anchor = $('section.citystrip') || $('.hero');
    if (!anchor || $('.lw-hf')) return;
    fetch('/api/account/feed', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var s = (d.stories || []).slice(0, 3), sec = document.createElement('section'); sec.className = 'lw-hf';
      var body = s.length
        ? '<div class="lw-hf-grid">' + s.map(function (x) {
          return '<a class="lw-hf-card" href="' + esc(x.href) + '">' + (x.image ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(x.image) + '" onerror="this.remove()">' : '') +
            '<div><small>' + esc(x.firm && x.firm.name) + '</small><b>' + esc(x.title) + '</b></div></a>';
        }).join('') + '</div>'
        : '<div class="lw-hf-empty">Your feed is empty. <b>Follow law firms</b> and their newest articles will show up here. A few to start with:</div><div class="lw-hf-sug" id="lwSug"></div>';
      sec.innerHTML = '<div class="lw-hf-in"><div class="lw-hf-top"><h2>Your feed</h2><a href="/account/#' + (s.length ? 'feed' : 'network') + '">' + (s.length ? 'See all' : 'My network') + '</a></div>' + body + '</div>';
      anchor.parentNode.insertBefore(sec, anchor);
      if (!s.length) fetch('/api/account/network', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (n) {
        var box = $('#lwSug', sec); if (!n || !box) return;
        box.innerHTML = (n.suggestions || []).slice(0, 3).map(function (f) {
          return '<div class="r"><a href="/firms/' + esc(f.slug) + '">' + esc(f.name) + '<small>' + esc(f.city) + ', ' + esc(f.province) + '</small></a><button type="button" class="lw-fbtn" data-follow="' + esc(f.slug) + '">+ Follow</button></div>';
        }).join('');
        if (window.lawdbSocial) window.lawdbSocial.init(sec);
      }).catch(function () {});
    }).catch(function () {});
  }

  function start() { me(function (m) { if (!m) return; build(m); homeFeed(); }); }
  // the account page calls this after a profile or photo change so the header, panel and tab bar update at once
  window.lawdbRefresh = function () {
    try { sessionStorage.removeItem('lawdb_me'); } catch (e) {}
    all('.lw-ava,.lw-tabbar,.lw-ov,.lw-panel,.lw-dot').forEach(function (el) { el.remove(); });
    document.body.classList.remove('lw-has-tabs');
    me(function (m) { if (m) build(m); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
