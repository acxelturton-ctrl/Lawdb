/* The LawDB Marketplace waitlist form (marketplace.html). Sends the form to /api/leads as form "marketplace-waitlist"; the server checks the consent box
   again and stores the wording of the version shown (src/lib/consent.js), so nothing here can change what a person agreed to. No cookies, no tracking. */
(function () {
  var form = document.getElementById('mpForm');
  if (!form) return;
  var btn = document.getElementById('mpBtn');
  var err = document.getElementById('mpErr');
  var ok = document.getElementById('mpOk');

  function checked(name) {
    var out = [];
    var boxes = form.querySelectorAll('input[name="' + name + '"]:checked');
    for (var i = 0; i < boxes.length; i++) out.push(boxes[i].value);
    return out.join(',');
  }
  function fail(message) {
    err.textContent = message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Join the waitlist';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var name = form.elements.name.value.trim();
    var email = form.elements.email.value.trim();
    var firmName = form.elements.firmName.value.trim();
    if (!name || !firmName || !/^\S+@\S+\.\S+$/.test(email)) return fail('Please add your name, a valid email and your firm\'s name.');
    if (!document.getElementById('mpConsent').checked) return fail('Please tick the box to agree to be emailed about LawDB Marketplace.');
    btn.disabled = true;
    btn.textContent = 'Joining...';
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form: 'marketplace-waitlist', name: name, email: email, firmName: firmName,
        lawSociety: form.elements.lawSociety.value.trim(),
        practiceAreas: checked('practiceAreas'), provinces: checked('provinces'),
        consent: 'yes', botcheck: form.elements.botcheck.checked ? '1' : '', page: location.pathname,
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again, or email info@lawdb.ca.');
        });
      })
      .then(function () {
        form.hidden = true;
        ok.hidden = false;
        ok.focus();
      })
      .catch(function (e2) { fail(e2.message || 'Something went wrong. Please try again, or email info@lawdb.ca.'); });
  });
})();
