/* The "tell us what you need" request (request-a-lawyer.html), part of the Lead Marketplace. Asks the server whether the marketplace is open (the page says so if it is
   not), and posts the form to /api/marketplace/inquiries. The server checks the consent box again and stores the wording of the version shown (src/lib/marketplace.js),
   so nothing here can change what a person agreed to. No cookies, nothing kept in the browser. */
(function () {
  var form = document.getElementById('rlForm');
  if (!form) return;
  var btn = document.getElementById('rlBtn');
  var err = document.getElementById('rlErr');
  var ok = document.getElementById('rlOk');
  var closed = document.getElementById('rlClosed');

  fetch('/api/marketplace/status').then(function (r) { return r.json(); }).then(function (s) {
    if (s && s.open) return;
    form.hidden = true;
    closed.hidden = false;
  }).catch(function () {});

  function fail(message) {
    err.textContent = message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Send my request';
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var v = function (n) { return form.elements[n].value.trim(); };
    if (!v('name') || !/^\S+@\S+\.\S+$/.test(v('email'))) return fail('Please add your name and a valid email.');
    if (!v('practiceArea') || !v('province')) return fail('Please choose the kind of lawyer you need and your province.');
    if (v('description').length < 25) return fail('Please tell us a little more about what you need (a sentence or two).');
    if (!document.getElementById('rlConsent').checked) return fail('Please tick the box to agree to how your request is shared.');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    fetch('/api/marketplace/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: v('name'), email: v('email'), phone: v('phone'), practiceArea: v('practiceArea'), province: v('province'), city: v('city'), urgency: v('urgency'),
        description: v('description'), consent: 'yes', botcheck: form.elements.botcheck.checked ? '1' : '',
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
        });
      })
      .then(function () { form.hidden = true; ok.hidden = false; ok.focus(); })
      .catch(function (e2) { fail(e2.message || 'Something went wrong. Please try again.'); });
  });
})();
