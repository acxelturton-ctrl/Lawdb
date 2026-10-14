// The one-time token lives in the URL fragment (#token=...), so it is never sent to any server
// until this page POSTs it. A button press is required so email link scanners cannot use it up.
const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', location.pathname); // remove the token from the address bar

const go = document.getElementById('go');
const err = document.getElementById('error');
const status = document.getElementById('status');

function fail(message) {
  err.textContent = message;
  err.hidden = false;
  status.hidden = true;
  go.hidden = true;
  document.getElementById('back').hidden = false;
}

if (!token) fail('This sign-in link is missing its token. Request a new one.');

go.addEventListener('click', async () => {
  go.disabled = true;
  go.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign-in failed.');
    location.replace('/admin/');
  } catch (e) {
    fail(e.message);
  }
});
