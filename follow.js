/* Follow and Save buttons for public pages. Any element with data-follow="<firm slug>" becomes a Follow button and any with data-save="<story id>"
   becomes a Save button. Signed-in people toggle them in place; everyone else is taken to sign in and the action is finished when they come back. */
(function () {
  if (window.lawdbSocial) return;
  var css = '.lw-fbtn,.lw-sbtn{font:600 13px Inter,system-ui,sans-serif;border:1px solid #2b2723;background:transparent;color:#2b2723;border-radius:999px;padding:5px 12px;cursor:pointer;line-height:1.2;white-space:nowrap}' +
    '.lw-fbtn[aria-pressed="true"],.lw-sbtn[aria-pressed="true"]{background:#2b2723;color:#fff}.lw-fbtn:hover,.lw-sbtn:hover{border-color:#9a6f1c}.lw-fbtn[disabled],.lw-sbtn[disabled]{opacity:.6;cursor:wait}' +
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

  window.lawdbSocial = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); }); else init(document);
})();
