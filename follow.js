/* Follow and Save buttons for public pages. Any element with data-follow="<firm slug>" becomes a Follow button and any with data-save="<story id>"
   becomes a Save button. Signed-in people toggle them in place; everyone else is taken to sign in and the action is finished when they come back. */
(function () {
  if (window.lawdbSocial) return;
  var css = '.lw-fbtn,.lw-sbtn{font:600 13px Inter,system-ui,sans-serif;border:1px solid #1f2328;background:transparent;color:#1f2328;border-radius:999px;padding:5px 12px;cursor:pointer;line-height:1.2;white-space:nowrap}' +
    '.lw-fbtn[aria-pressed="true"],.lw-sbtn[aria-pressed="true"]{background:#1f2328;color:#fff}.lw-fbtn:hover,.lw-sbtn:hover{border-color:#b45309}.lw-fbtn[disabled],.lw-sbtn[disabled]{opacity:.6;cursor:wait}' +
    '.li-actions{flex-wrap:wrap}.li-actions .lw-fbtn{border-radius:4px;padding:11px 18px;font-size:14px}@media(max-width:520px){.li-actions .lw-fbtn{flex:1 1 100%}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var state = { signedIn: false, follows: {}, saved: {} };
  var all = function (root, sel) { return [].slice.call((root || document).querySelectorAll(sel)); };
  var uniq = function (a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); };

  function paint(root) {
    all(root, '[data-follow]').forEach(function (b) {
      var s = state.follows[b.getAttribute('data-follow')] || { following: false, followers: 0 };
      b.setAttribute('aria-pressed', s.following ? 'true' : 'false');
      b.textContent = (s.following ? 'Following ✓' : 'Follow') + (s.followers > 0 ? ' · ' + s.followers : '');
      b.title = s.following ? 'You follow this firm. Tap to stop.' : 'Follow this firm to see its new stories in your feed';
    });
    all(root, '[data-save]').forEach(function (b) {
      var on = !!state.saved[b.getAttribute('data-save')];
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.textContent = on ? 'Saved ✓' : 'Save';
    });
  }

  function init(root) {
    var slugs = uniq(all(root, '[data-follow]').map(function (b) { return b.getAttribute('data-follow'); })).slice(0, 40);
    var ids = uniq(all(root, '[data-save]').map(function (b) { return b.getAttribute('data-save'); })).slice(0, 60);
    if (!slugs.length && !ids.length) return;
    paint(root);
    fetch('/api/social/status?slugs=' + encodeURIComponent(slugs.join(',')) + '&posts=' + encodeURIComponent(ids.join(',')), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.signedIn = !!d.signedIn;
        Object.keys(d.follows || {}).forEach(function (k) { state.follows[k] = d.follows[k]; });
        ids.forEach(function (id) { state.saved[id] = !!(d.saved && d.saved[id]); });
        paint(root);
      }).catch(function () {});
  }

  function toAccount(action) {
    try { localStorage.setItem('lawdb_pending', JSON.stringify(action)); } catch (e) {}
    location.href = '/account/';
  }
  function call(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }); });
  }

  document.addEventListener('click', function (e) {
    var f = e.target.closest && e.target.closest('[data-follow]');
    var s = !f && e.target.closest && e.target.closest('[data-save]');
    if (!f && !s) return;
    e.preventDefault(); e.stopPropagation();
    var b = f || s;
    if (!state.signedIn) return toAccount(f ? { type: 'follow', slug: b.getAttribute('data-follow') } : { type: 'save', id: b.getAttribute('data-save') });
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
  var rcss = '.lw-rate{max-width:640px;margin:18px auto;padding:16px 18px;background:#fff;border:1px solid #e3dfd5;border-radius:12px;font:15px/1.5 Inter,system-ui,sans-serif;color:#1f2328}' +
    '.lw-rate h2{font:700 17px "Source Serif 4",Georgia,serif;margin:0 0 6px}.lw-rate .lw-avg{font-size:26px;font-weight:700;color:#b45309}.lw-rate .lw-sub{color:#636870;font-size:14px}' +
    '.lw-rate .lw-row2{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:6px 0}.lw-rate button{font:600 14px Inter,system-ui,sans-serif;border:1px solid #1f2328;background:transparent;color:#1f2328;border-radius:8px;padding:9px 16px;cursor:pointer}' +
    '.lw-rate button.go{background:#1f2328;color:#fff}.lw-rate button[disabled]{opacity:.6}.lw-stars button{border:0;background:none;font-size:30px;line-height:1;padding:2px 4px;color:#e3dfd5;cursor:pointer}.lw-stars button.on{color:#e8a91f}' +
    '.lw-rate textarea{width:100%;min-height:80px;border:1px solid #e3dfd5;border-radius:8px;padding:10px;font:15px Inter,system-ui,sans-serif;margin:8px 0}.lw-rate .lw-note{font-size:12.5px;color:#8d9197}' +
    '.lw-rate .lw-cm{border-top:1px solid #f0ede5;padding:10px 0 0;margin-top:10px}.lw-rate .lw-cm b{color:#e8a91f}.lw-rate .lw-err{color:#a8402f;font-size:14px}';
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
  function boot() { init(document); initRatings(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
