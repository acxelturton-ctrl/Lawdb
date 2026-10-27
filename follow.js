/* Follow and Save buttons for public pages. Any element with data-follow="<firm slug>" becomes a Follow button and any with data-save="<story id>"
   becomes a Save button. Signed-in people toggle them in place; everyone else is taken to sign in and the action is finished when they come back. */
(function () {
  if (window.lawdbSocial) return;
  // Follow is plain text in the site's link colour, like on other social platforms (no box). Save keeps its pill.
  var css = '.lw-sbtn{font:600 13px Inter,system-ui,sans-serif;border:1.5px solid #142434;background:#fff;color:#142434;border-radius:999px;padding:6px 14px;cursor:pointer;line-height:1.2;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:4px}' +
    '.lw-sbtn:hover{background:#f4ecd8;border-color:#c9a050}.lw-sbtn[disabled]{opacity:.6;cursor:wait}' +
    '.lw-fbtn{font:700 14px Inter,system-ui,sans-serif;border:0;background:none;color:#e2bd6a;padding:2px 0;margin:0;cursor:pointer;line-height:1.2;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;text-decoration:none}' +
    '.lw-fbtn:hover{text-decoration:underline;text-underline-offset:3px}.lw-fbtn[disabled]{opacity:.6;cursor:wait}' +
    '.lw-fbtn[aria-pressed="true"]{color:#586170;font-weight:600}@media(hover:hover){.lw-fbtn[aria-pressed="true"]:hover{color:#e2bd6a}.lw-fbtn[aria-pressed="true"]:hover .lw-a{display:none}.lw-fbtn[aria-pressed="true"]:hover .lw-b{display:inline}}' +
    '.lw-fbtn .lw-b{display:none}' +
    '.lw-sbtn[aria-pressed="true"]{background:#142434;color:#fff}' +
    '.lc .lw-fbtn{position:static;margin-left:10px;font-size:13px}' +
    '.frow .lw-fbtn{position:absolute;top:12px;right:14px;z-index:2}.fcard-actions .lw-fbtn,.ra-actions .lw-fbtn{font-size:13px}' +
    '.lw-claim{margin:10px 0 0;font:600 13.5px Inter,system-ui,sans-serif}.lw-claim a{color:#e2bd6a;text-decoration:underline;text-underline-offset:2px}.lw-claim a:hover{color:#142434}.lw-claimed{color:#2b3a4c}' +
    '.lw-fcount{margin:0;font:600 13.5px Inter,system-ui,sans-serif;color:#586170}' +
    '.lw-fline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 12px}.lw-fline .lw-fcount:empty{display:none}.lw-fline .lw-fcount:not(:empty)::after{content:"\\00b7";margin-left:10px;color:#8a919b}' +
    '.li-actions{flex-wrap:wrap}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  // The greyed-out "Book a call" button on a firm's page: tapping it opens or closes the note that says how the firm can add a booking link.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.li-book-off') : null;
    var n = b && document.getElementById(b.getAttribute('aria-controls') || 'lw-book-note');
    if (!n) return;
    n.hidden = !n.hidden;
    b.setAttribute('aria-expanded', n.hidden ? 'false' : 'true');
  });
  var state = { signedIn: false, follows: {}, saved: {} };
  var all = function (root, sel) { return [].slice.call((root || document).querySelectorAll(sel)); };
  var uniq = function (a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); };

  function paint(root) {
    all(root, '[data-follow]').forEach(function (b) {
      var s = state.follows[b.getAttribute('data-follow')] || { following: false, followers: 0 };
      b.setAttribute('aria-pressed', s.following ? 'true' : 'false');
      var key = s.following ? 'on' : 'off';
      if (b.getAttribute('data-h') !== key) {
        b.setAttribute('data-h', key);
        while (b.firstChild) b.removeChild(b.firstChild);
        if (s.following) {
          var a = document.createElement('span'); a.className = 'lw-a'; a.textContent = '\u2713 Following';
          var u = document.createElement('span'); u.className = 'lw-b'; u.textContent = 'Unfollow';
          b.appendChild(a); b.appendChild(u);
        } else b.textContent = '+ Follow';
      }
      b.title = s.following ? 'You follow this firm. Tap to unfollow.' : 'Follow this firm to see its new stories in your feed';
    });
    all(root, '[data-fcount]').forEach(function (el) {
      var s = state.follows[el.getAttribute('data-fcount')];
      el.textContent = s && s.followers > 0 ? s.followers.toLocaleString('en-CA') + (s.followers === 1 ? ' follower' : ' followers') : '';
    });
    all(root, '[data-save]').forEach(function (b) {
      var on = !!state.saved[b.getAttribute('data-save')];
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.textContent = on ? 'Saved ✓' : 'Save';
    });
  }

  // Firm cards on the home page, city and practice-area pages and the lawyer search get a Follow button too.
  var slugOf = function (href) { var m = (href || '').match(/\/firms\/([a-z0-9][a-z0-9-]*)\/?$/); return m ? m[1] : null; };
  var mk = function (slug) { var b = document.createElement('button'); b.type = 'button'; b.className = 'lw-fbtn lw-in'; b.setAttribute('data-follow', slug); b.textContent = '+ Follow'; return b; };
  function decorate(root) {
    var n = 0;
    all(root, '.lc').forEach(function (c) {
      if (c.querySelector('[data-follow]')) return;
      var a = c.querySelector('h3 a'), rate = c.querySelector('.lc-rate'), box = c.querySelector('.lc-btns'), s = a && slugOf(a.getAttribute('href'));
      if (s && rate) { rate.appendChild(mk(s)); n++; } else if (s && box) { box.appendChild(mk(s)); n++; }
    });
    all(root, 'a.frow').forEach(function (a) {
      if (a.querySelector('[data-follow]')) return;
      var s = slugOf(a.getAttribute('href')); if (s) { a.appendChild(mk(s)); n++; }
    });
    all(root, 'a.fa-profile, a.ra-profile').forEach(function (a) {
      var nx = a.nextElementSibling; if (nx && nx.hasAttribute && nx.hasAttribute('data-follow')) return;
      var s = slugOf(a.getAttribute('href')); if (s) { a.insertAdjacentElement('afterend', mk(s)); n++; }
    });
    return n;
  }

  function init(root) {
    decorate(root);
    var slugs = uniq(all(root, '[data-follow],[data-fcount]').map(function (b) { return b.getAttribute('data-follow') || b.getAttribute('data-fcount'); }));
    var ids = uniq(all(root, '[data-save]').map(function (b) { return b.getAttribute('data-save'); })).slice(0, 60);
    if (!slugs.length && !ids.length) return;
    paint(root);
    var chunks = [];
    for (var i = 0; i < slugs.length; i += 40) chunks.push(slugs.slice(i, i + 40));
    if (!chunks.length) chunks.push([]);
    chunks.forEach(function (ch, k) {
      var mine = k === 0 ? ids : [];
      fetch('/api/social/status?slugs=' + encodeURIComponent(ch.join(',')) + '&posts=' + encodeURIComponent(mine.join(',')), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          state.signedIn = !!d.signedIn;
          try { localStorage.setItem('lawdb_in', d.signedIn ? '1' : '0'); } catch (e) {}
          Object.keys(d.follows || {}).forEach(function (key) { state.follows[key] = d.follows[key]; });
          mine.forEach(function (id) { state.saved[id] = !!(d.saved && d.saved[id]); });
          paint(root);
        }).catch(function () {});
    });
  }

  function toAccount(action, join) {
    try { localStorage.setItem('lawdb_pending', JSON.stringify(action)); } catch (e) {}
    location.href = '/account/' + (join ? '?join=1' : '');
  }

  // Signed-out people who tap Follow or Save get a centred sign-in popup instead of being thrown to another page.
  var gcss = '.lw-gate{position:fixed;inset:0;z-index:2000;background:rgba(27,36,45,0.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif}' +
    '.lw-gate-card{position:relative;background:#fff;border-radius:16px;width:100%;max-width:440px;padding:56px 28px 32px;text-align:center;box-shadow:0 24px 60px rgba(20,36,52,0.28);color:#142434}' +
    '.lw-gate-x{position:absolute;top:10px;left:10px;width:40px;height:40px;border:0;background:none;font-size:28px;line-height:1;color:#586170;cursor:pointer;border-radius:50%}.lw-gate-x:hover{background:#edeae1;color:#142434}' +
    '.lw-gate-logo{display:inline-flex;align-items:center;gap:10px;margin:0 0 24px;text-decoration:none;color:#142434;font:800 26px Inter,system-ui,sans-serif;letter-spacing:-.01em}.lw-gate-logo img{height:40px;width:auto;display:block}.lw-gate-logo i{font-style:normal;color:#c9a050}' +
    '.lw-gate h2{font:700 24px/1.25 "Source Serif 4",Georgia,serif;margin:0 0 10px;text-wrap:balance}.lw-gate p{margin:0 0 26px;color:#586170;font-size:16px;line-height:1.5}' +
    '.lw-gate-btn{display:block;width:100%;box-sizing:border-box;border-radius:999px;padding:14px 18px;font:700 16px Inter,system-ui,sans-serif;cursor:pointer;text-align:center;text-decoration:none;margin:0 0 12px}' +
    '.lw-gate-btn.go{background:#c9a050;border:1.5px solid #c9a050;color:#142434}.lw-gate-btn.go:hover{background:#c9a050}' +
    '.lw-gate-btn.alt{background:#fff;border:1.5px solid #e3dfd3;color:#142434}.lw-gate-btn.alt:hover{border-color:#c9a050;background:#f4ecd8}' +
    '.lw-gate small{display:block;margin-top:8px;color:#8a919b;font-size:12.5px;line-height:1.5}';
  function nameOf(slug, btn) {
    var t = '', card = btn.closest && btn.closest('.lc, .frow, .fcard, .rcard');
    if (card) { var n = card.querySelector('h3 a, .rname, .fname'); t = n ? (n.firstChild && n.firstChild.nodeType === 3 ? n.firstChild.textContent : n.textContent) : ''; }
    if (!t && location.pathname.indexOf('/firms/' + slug) === 0) { var h1 = document.querySelector('h1'); t = h1 ? h1.textContent : ''; }
    if (!t) { all(document, 'a[href$="/firms/' + slug + '"]').some(function (a) { var x = a.textContent.replace(/\s+/g, ' ').trim(); if (x && !/^(view |see )?(profile|website|more|call)/i.test(x)) { t = x; return true; } return false; }); }
    return (t || '').replace(/\s+/g, ' ').trim();
  }
  function gate(action, name) {
    if (document.querySelector('.lw-gate')) return;
    if (!document.getElementById('lw-gate-css')) { var g = document.createElement('style'); g.id = 'lw-gate-css'; g.textContent = gcss; document.head.appendChild(g); }
    var mkEl = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    var follow = action.type === 'follow', claim = action.type === 'claim', prev = document.activeElement;
    var wrap = mkEl('div', 'lw-gate'), card = mkEl('div', 'lw-gate-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'lw-gate-h');
    var x = mkEl('button', 'lw-gate-x', '\u00d7'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
    var logo = mkEl('a', 'lw-gate-logo'); logo.href = '/';
    var im = document.createElement('img'); im.src = '/images/logo-icon.png'; im.alt = ''; logo.appendChild(im);
    var wm = mkEl('span'); wm.appendChild(document.createTextNode('Law')); wm.appendChild(mkEl('i', '', 'DB')); logo.appendChild(wm);
    var h = mkEl('h2', '', claim ? 'Claim ' + (name || 'this firm') + ' on LawDB.' : follow ? 'Follow ' + (name || 'this firm') + ' to see what they share.' : 'Sign in to save this story.'); h.id = 'lw-gate-h';
    var sub = mkEl('p', '', claim ? 'Sign in to manage this listing: edit your description, practice areas, hours and photos. We check every request so listings stay trustworthy.' : follow ? 'Stay up to date with news and updates from the law firms you care about. Free.' : 'Keep the stories you want to read again in your own list. Free.');
    var li = mkEl('a', 'lw-gate-btn go', 'Log in'); li.href = '/account/'; li.setAttribute('role', 'button');
    var su = mkEl('a', 'lw-gate-btn alt', 'Sign up'); su.href = '/account/?join=1'; su.setAttribute('role', 'button');
    var fine = mkEl('small', '', 'Continue with Google or LinkedIn. No password to remember.');
    [li, su].forEach(function (a, i) { a.addEventListener('click', function (ev) { ev.preventDefault(); toAccount(action, i === 1); }); });
    [x, logo, h, sub, li, su, fine].forEach(function (e) { card.appendChild(e); });
    wrap.appendChild(card); document.body.appendChild(wrap);
    var prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    function close() { document.removeEventListener('keydown', key, true); document.body.style.overflow = prevOverflow; wrap.remove(); if (prev && prev.focus) try { prev.focus(); } catch (e) {} }
    function key(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      else if (ev.key === 'Tab') { var f = [x, li, su], i = f.indexOf(document.activeElement); ev.preventDefault(); f[(i + (ev.shiftKey ? f.length - 1 : 1)) % f.length].focus(); }
    }
    x.addEventListener('click', close);
    wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) close(); });
    document.addEventListener('keydown', key, true);
    li.focus();
  }
  function call(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }); });
  }

  document.addEventListener('click', function (e) {
    var cl = e.target.closest && e.target.closest('[data-claim]');
    if (cl) {
      e.preventDefault(); e.stopPropagation();
      var cs = cl.getAttribute('data-claim');
      if (!state.signedIn) { var h1 = document.querySelector('h1'); return gate({ type: 'claim', slug: cs }, h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : ''); }
      return toAccount({ type: 'claim', slug: cs });
    }
    var f = e.target.closest && e.target.closest('[data-follow]');
    var s = !f && e.target.closest && e.target.closest('[data-save]');
    if (!f && !s) return;
    e.preventDefault(); e.stopPropagation();
    var b = f || s;
    if (!state.signedIn) return f ? gate({ type: 'follow', slug: b.getAttribute('data-follow') }, nameOf(b.getAttribute('data-follow'), b)) : gate({ type: 'save', id: b.getAttribute('data-save') });
    b.disabled = true;
    var p;
    if (f) {
      var slug = b.getAttribute('data-follow'), on = (state.follows[slug] || {}).following;
      p = on ? call('DELETE', '/api/account/follow/' + encodeURIComponent(slug)) : call('POST', '/api/account/follow', { slug: slug });
      p = p.then(function (j) { state.follows[slug] = { following: j.following, followers: j.followers }; });
    } else {
      var id = b.getAttribute('data-save'), was = state.saved[id];
      p = was ? call('DELETE', '/api/account/saved/' + encodeURIComponent(id)) : call('POST', '/api/account/saved', { postId: Number(id) });
      p = p.then(function (j) { state.saved[id] = j.saved; });
    }
    p.then(function () { paint(document); }, function (err) { b.title = err.message; b.textContent = 'Try again'; })
      .then(function () { b.disabled = false; });
  }, true);


  // ---- member ratings: <div data-rate="<firm slug>"> becomes the rating box
  var rcss = '.lw-rate{max-width:640px;margin:18px auto;padding:16px 18px;background:#fff;border:1px solid #e3dfd3;border-radius:12px;font:15px/1.5 Inter,system-ui,sans-serif;color:#142434}' +
    '.lw-rate h2{font:700 17px "Source Serif 4",Georgia,serif;margin:0 0 6px}.lw-rate .lw-avg{font-size:26px;font-weight:700;color:#e2bd6a}.lw-rate .lw-sub{color:#586170;font-size:14px}' +
    '.lw-rate .lw-row2{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:6px 0}.lw-rate button{font:600 14px Inter,system-ui,sans-serif;border:1px solid #142434;background:transparent;color:#142434;border-radius:8px;padding:9px 16px;cursor:pointer}' +
    '.lw-rate button.go{background:#142434;color:#fff}.lw-rate button[disabled]{opacity:.6}.lw-stars button{border:0;background:none;font-size:30px;line-height:1;padding:2px 4px;color:#e3dfd3;cursor:pointer}.lw-stars button.on{color:#c9a050}' +
    '.lw-rate textarea{width:100%;min-height:80px;border:1px solid #e3dfd3;border-radius:8px;padding:10px;font:15px Inter,system-ui,sans-serif;margin:8px 0}.lw-rate .lw-note{font-size:12.5px;color:#8a919b}' +
    '.lw-rate .lw-cm{border-top:1px solid #edeae1;padding:10px 0 0;margin-top:10px}.lw-rate .lw-cm b{color:#c9a050}.lw-rate .lw-err{color:#e2bd6a;font-size:14px}';
  var rs = document.createElement('style'); rs.textContent = rcss; document.head.appendChild(rs);
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function renderRating(box, slug, d) {
    box.textContent = '';
    box.appendChild(el('h2', null, 'LawDB member ratings'));
    var top = el('div', 'lw-row2');
    if (d.count >= 3) { top.appendChild(el('span', 'lw-avg', '★ ' + d.average.toFixed(1))); top.appendChild(el('span', 'lw-sub', 'from ' + d.count + ' LawDB member ratings')); }
    else top.appendChild(el('span', 'lw-sub', d.count ? d.count + ' rating' + (d.count === 1 ? '' : 's') + ' so far. The average shows from 3 ratings.' : 'No ratings yet. Be the first.'));
    box.appendChild(top);
    var act = el('div', 'lw-row2');
    if (!d.signedIn) {
      var si = el('button', 'go', 'Sign in to rate'); si.type = 'button';
      si.onclick = function () { try { localStorage.setItem('lawdb_pending', JSON.stringify({ type: 'back', url: location.pathname + '#rate' })); } catch (e) {} location.href = '/account/'; };
      act.appendChild(si);
    } else if (d.manages) {
      act.appendChild(el('span', 'lw-note', 'You manage this firm, so you cannot rate it.'));
    } else {
      if (d.mine) act.appendChild(el('span', 'lw-sub', 'Your rating: ' + stars(d.mine.stars) + (d.mine.commentStatus === 'pending' ? ' (your comment is waiting for review)' : '')));
      var b = el('button', d.mine ? '' : 'go', d.mine ? 'Change my rating' : 'Rate this firm'); b.type = 'button';
      b.onclick = function () { form(box, slug, d); };
      act.appendChild(b);
    }
    box.appendChild(act);
    (d.comments || []).forEach(function (c) { var w = el('div', 'lw-cm'); w.appendChild(el('b', null, stars(c.stars))); w.appendChild(el('div', null, c.comment)); w.appendChild(el('div', 'lw-note', 'A LawDB member')); box.appendChild(w); });
    box.appendChild(el('p', 'lw-note', 'Ratings are the opinions of signed-in LawDB members. Comments are reviewed before they appear. They are separate from the public Google ratings shown above.'));
  }
  function form(box, slug, d) {
    var pick = (d.mine && d.mine.stars) || 0;
    box.textContent = '';
    box.appendChild(el('h2', null, 'Rate this firm'));
    var row = el('div', 'lw-stars'); var btns = [];
    for (var i = 1; i <= 5; i++) (function (n) { var b = el('button', null, '★'); b.type = 'button'; b.setAttribute('aria-label', n + ' star' + (n > 1 ? 's' : '')); b.onclick = function () { pick = n; paint2(); }; btns.push(b); row.appendChild(b); })(i);
    function paint2() { btns.forEach(function (b, k) { b.className = k < pick ? 'on' : ''; }); }
    paint2(); box.appendChild(row);
    var ta = el('textarea'); ta.maxLength = 600; ta.placeholder = 'Optional: a few words about your experience (no links or contact details)'; ta.value = (d.mine && d.mine.comment) || ''; box.appendChild(ta);
    var err = el('div', 'lw-err'); box.appendChild(err);
    var act = el('div', 'lw-row2'); var ok = el('button', 'go', 'Submit'); ok.type = 'button'; var no = el('button', null, 'Cancel'); no.type = 'button';
    ok.onclick = function () {
      if (!pick) { err.textContent = 'Choose 1 to 5 stars.'; return; }
      ok.disabled = true; err.textContent = '';
      call('POST', '/api/account/ratings', { slug: slug, stars: pick, comment: ta.value }).then(function (j) { d.mine = j.mine; d.count = j.count; d.average = j.average; d.comments = j.comments; renderRating(box, slug, d); }, function (e) { err.textContent = e.message; ok.disabled = false; });
    };
    no.onclick = function () { renderRating(box, slug, d); };
    act.appendChild(ok); act.appendChild(no); box.appendChild(act);
    box.appendChild(el('p', 'lw-note', 'Rate only firms you have dealt with. Please do not include private or confidential details.'));
  }
  function initRatings(root) {
    all(root, '[data-rate]').forEach(function (box) {
      var slug = box.getAttribute('data-rate');
      fetch('/api/firms/' + encodeURIComponent(slug) + '/ratings', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
        state.signedIn = !!d.signedIn; renderRating(box, slug, d);
        if (location.hash === '#rate' && d.canRate && !d.mine) { box.scrollIntoView(); form(box, slug, d); }
      }).catch(function () {});
    });
  }

  window.lawdbSocial = { init: init, initRatings: initRatings };
  function boot() {
    init(document); initRatings(document);
    // The lawyer search draws its result cards with script, so watch for new ones.
    if (window.MutationObserver) {
      var t = null;
      new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { if (decorate(document)) init(document); }, 150); }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
