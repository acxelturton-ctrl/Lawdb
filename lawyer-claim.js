/* "Claim your lawyer listing": sends the form to /api/leads as form "lawyer-claim" (src/routes/public.js), which emails the admin. Used on a firm's Lawyers page and on /for-firms.
   Everything on the page is written as plain text. */
(function () {
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

  // "Is this you?" on a lawyer's card: choose that lawyer in the form and go to it
  Array.prototype.forEach.call(document.querySelectorAll('a[data-claim-lawyer]'), function (a) {
    a.addEventListener('click', function () {
      var f = document.querySelector('form[data-lawyer-claim]'), sel = f && f.elements.lawyer;
      if (sel) { sel.value = a.getAttribute('data-claim-lawyer'); }
      if (f && f.elements.name) { setTimeout(function () { try { f.elements.name.focus({ preventScroll: true }); } catch (e) { f.elements.name.focus(); } }, 450); }
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('form[data-lawyer-claim]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.lc-msg'), btn = f.querySelector('button[type=submit]');
      var els = f.elements;
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
          // the form is replaced by a thank-you that says what happens next
          var done = el('div', 'lc-done'), first = name.split(/\s+/)[0];
          done.setAttribute('role', 'status');
          done.appendChild(el('h3', '', 'Thank you, ' + first + '.'));
          done.appendChild(el('p', '', 'We have your request. We check every one against your law society’s listing and will email you at ' + email + ' within a few days.'));
          done.appendChild(el('p', '', 'Your free listing stays as it is until then. If you would like a Featured lawyer listing, tell us in your reply.'));
          f.parentNode.replaceChild(done, f);
        })
        .catch(function () { btn.disabled = false; say('Something went wrong. Please try again or email info@lawdb.ca.', true); });
    });
  });
})();
