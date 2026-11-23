/* "Claim your lawyer profile": sends the form to /api/leads as form "lawyer-claim" (src/routes/public.js), which emails the admin. Used on a firm's Lawyers page and on /for-firms. */
(function () {
  var forms = document.querySelectorAll('form[data-lawyer-claim]');
  Array.prototype.forEach.call(forms, function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.lc-msg'), btn = f.querySelector('button[type=submit]');
      var el = f.elements;
      var name = (el.name.value || '').trim(), email = (el.email.value || '').trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Please add your name and a valid email address.'; return; }
      var sel = el.lawyer, firmName = f.getAttribute('data-firm-name') || (el.firmName ? (el.firmName.value || '').trim() : '');
      if (!firmName) { msg.textContent = 'Please tell us which firm you are at.'; return; }
      var body = {
        form: 'lawyer-claim', name: name, email: email, phone: (el.phone.value || '').trim(), message: el.message ? (el.message.value || '').trim() : '',
        claimFirm: f.getAttribute('data-firm') || '', claimFirmName: firmName, claimLawyer: sel ? sel.value : '', page: location.pathname, botcheck: el.botcheck ? el.botcheck.value : ''
      };
      btn.disabled = true; msg.textContent = 'Sending…';
      fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (r) {
          if (r.ok) { f.reset(); msg.textContent = 'Thank you. We check each request against your law society listing and will email you within a few days.'; }
          else { btn.disabled = false; msg.textContent = (r.d && r.d.error) || 'Something went wrong. Please try again or email info@lawdb.ca.'; }
        })
        .catch(function () { btn.disabled = false; msg.textContent = 'Something went wrong. Please try again or email info@lawdb.ca.'; });
    });
  });
})();
