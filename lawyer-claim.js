/* "Claim your lawyer listing": sends the form to /api/leads as form "lawyer-claim" (src/routes/public.js), which emails the admin.
   - A firm's Lawyers page has only a heading and a button (section[data-claim-box]); the form is built here, below the lawyers, when the button is pressed.
   - /for-firms has the form in its markup (form[data-lawyer-claim]).
   Everything on the page is written as plain text. */
(function () {
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function field(label, input) { var l = el('label', '', label); l.appendChild(input); return l; }
  function input(name, type, attrs) { var i = el('input'); i.name = name; i.type = type; for (var k in attrs) i.setAttribute(k, attrs[k]); return i; }

  // sends a form (built here or in the page) and swaps it for a thank-you
  function bind(f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.lc-msg'), btn = f.querySelector('button[type=submit]'), els = f.elements;
      var say = function (t, bad) { msg.textContent = t; msg.className = 'lc-msg' + (bad ? ' err' : ''); };
      var name = (els.name.value || '').trim(), email = (els.email.value || '').trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say('Please add your name and a valid email address.', true); return; }
      var sel = els.lawyer, firmName = f.getAttribute('data-firm-name') || (els.firmName ? (els.firmName.value || '').trim() : '');
      if (!firmName) { say('Please tell us which firm you are at.', true); return; }
      var body = {
        form: 'lawyer-claim', name: name, email: email, phone: (els.phone.value || '').trim(), message: els.message ? (els.message.value || '').trim() : '',
        claimFirm: f.getAttribute('data-firm') || '', claimFirmName: firmName, claimLawyer: sel ? sel.value : '', page: location.pathname, botcheck: els.botcheck ? els.botcheck.value : ''
      };
      btn.disabled = true; say('Sending…', false);
      fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (r) {
          if (!r.ok) { btn.disabled = false; say((r.d && r.d.error) || 'Something went wrong. Please try again or email info@lawdb.ca.', true); return; }
          var done = el('div', 'lc-done'), first = name.split(/\s+/)[0];
          done.setAttribute('role', 'status');
          done.appendChild(el('h3', '', 'Thank you, ' + first + '.'));
          done.appendChild(el('p', '', 'We have your request. We check every one against your law society’s listing and will email you at ' + email + ' within a few days.'));
          done.appendChild(el('p', '', 'Your free listing stays as it is until then. If you would like a Featured lawyer listing, tell us in your reply.'));
          f.parentNode.replaceChild(done, f);
        })
        .catch(function () { btn.disabled = false; say('Something went wrong. Please try again or email info@lawdb.ca.', true); });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('form[data-lawyer-claim]'), bind);

  // the Lawyers page: heading + button; the button opens the form below the lawyers
  Array.prototype.forEach.call(document.querySelectorAll('section[data-claim-box]'), function (box) {
    var btn = box.querySelector('[data-claim-open]'), panel = box.querySelector('.lc-panel'), built = false;
    function build() {
      var firm = box.getAttribute('data-firm'), firmName = box.getAttribute('data-firm-name'), featured = box.getAttribute('data-featured') === '1';
      var lawyerPrice = box.getAttribute('data-lawyer-price'), firmPrice = box.getAttribute('data-firm-price'), lawyers = [];
      try { lawyers = JSON.parse(box.getAttribute('data-lawyers') || '[]'); } catch (x) { lawyers = []; }
      panel.appendChild(el('p', 'lc-intro', 'Claim your free listing so your details are right. We check every request against your law society’s listing.'));
      var st = el('p', 'lc-status' + (featured ? ' ok' : '')); st.appendChild(el('i'));
      var tx = el('span');
      if (featured) {
        tx.appendChild(el('b', '', firmName + ' is a Featured firm'));
        tx.appendChild(document.createTextNode(', so you can add your own Featured lawyer listing for $' + lawyerPrice + ' a month: a page of your own, your direct phone number and a pin on the map. '));
      } else {
        tx.appendChild(el('b', '', firmName + ' is not Featured yet.'));
        tx.appendChild(document.createTextNode(' A Featured lawyer listing ($' + lawyerPrice + ' a month) opens once your firm is Featured ($' + firmPrice + ' a month). '));
        var mail = el('a', '', 'Tell your firm');
        mail.href = 'mailto:?subject=' + encodeURIComponent('Featured listings for our lawyers on LawDB') + '&body=' + encodeURIComponent('LawDB lists our lawyers for free. If ' + firmName + ' becomes a Featured firm, each of us can add a Featured lawyer listing: a page of our own, a direct phone number and a pin on the map.\n\nhttps://lawdb.ca/for-firms');
        tx.appendChild(mail);
        tx.appendChild(document.createTextNode(' \u00b7 '));
      }
      var more = el('a', '', 'What Featured lawyers get'); more.href = '/for-firms#lawyers'; tx.appendChild(more);
      st.appendChild(tx); panel.appendChild(st);

      var f = el('form'); f.setAttribute('data-lawyer-claim', ''); f.setAttribute('data-firm', firm); f.setAttribute('data-firm-name', firmName); f.noValidate = true;
      var r1 = el('div', 'lc-row'), sel = el('select'); sel.name = 'lawyer';
      var o0 = el('option', '', 'Choose your name'); o0.value = ''; sel.appendChild(o0);
      lawyers.forEach(function (l) { var o = el('option', '', l[1]); o.value = l[0]; sel.appendChild(o); });
      var oo = el('option', '', 'I am not on this list'); oo.value = 'other'; sel.appendChild(oo);
      r1.appendChild(field('Your name', input('name', 'text', { autocomplete: 'name', maxlength: '90', required: '' })));
      r1.appendChild(field('Which lawyer are you?', sel));
      var r2 = el('div', 'lc-row');
      r2.appendChild(field('Your email', input('email', 'email', { autocomplete: 'email', maxlength: '254', required: '' })));
      r2.appendChild(field('Phone (optional)', input('phone', 'tel', { autocomplete: 'tel', maxlength: '30' })));
      var bot = input('botcheck', 'text', { tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }); bot.style.cssText = 'position:absolute;left:-9999px;opacity:0';
      var go = el('button', 'pf-btn pf-primary', 'Send my claim'); go.type = 'submit';
      f.appendChild(r1); f.appendChild(r2); f.appendChild(bot); f.appendChild(go);
      f.appendChild(el('p', 'lc-fine', 'LawDB does not rank, recommend or certify lawyers.'));
      f.appendChild(el('p', 'lc-msg')); f.lastChild.setAttribute('role', 'status'); f.lastChild.setAttribute('aria-live', 'polite');
      panel.appendChild(f); bind(f);
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var open = panel.hidden;
      if (open && !built) { build(); built = true; }
      panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var first = panel.querySelector('input[name=name]');
        setTimeout(function () { if (first) { try { first.focus({ preventScroll: true }); } catch (x) { first.focus(); } } }, 60);
        box.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
      }
    });
  });
})();
