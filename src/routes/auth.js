import { json, readJson, isEmail, NO_STORE, HttpError } from '../lib/http.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { adminEmails, createSession, destroySession, getUser } from '../lib/auth.js';
import { sendLoginEmail } from '../lib/email.js';
import { audit } from '../lib/audit.js';

const MAX_LINKS_PER_15_MIN = 3;

// Always answers { ok: true } so the response never reveals which emails are registered.
export async function requestLink({ request, env, url, exec }) {
  const body = await readJson(request, 2000);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isEmail(email)) throw new HttpError(422, 'A valid email is required');

  // Only known users (or configured admins) get a link. Strangers cannot trigger emails from our domain.
  const known = adminEmails(env).has(email) || (await env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND disabled = 0').bind(email).first());
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > datetime('now','-15 minutes')").bind(email).first();
  if (!known || recent.n >= MAX_LINKS_PER_15_MIN) return json({ ok: true }, 200, NO_STORE);

  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, datetime('now','+15 minutes'))")
    .bind(await sha256Hex(token), email)
    .run();

  // The token rides in the URL fragment: it is never sent to servers, logs or referrers.
  const origin = env.DEV_ECHO_LINK === '1' ? url.origin : env.SITE_ORIGIN || url.origin;
  const link = `${origin}/admin/verify.html#token=${token}`;

  // Local development only: hand the link back instead of emailing it.
  if (env.DEV_ECHO_LINK === '1') return json({ ok: true, dev_link: link }, 200, NO_STORE);

  // Send in the background so response timing does not reveal whether the email exists.
  // A failure is written to the audit log (shown on the Activity tab) so it is never silent.
  exec(
    sendLoginEmail(env, email, link).catch((err) => {
      console.error('login email failed', err);
      // Names only, never values: lets us see whether a secret is absent, misnamed, or empty.
      const keyLen = typeof env.BREVO_API_KEY === 'string' ? env.BREVO_API_KEY.length : null;
      return audit(env, null, 'login.email_failed', 'email', email, {
        error: String(err.message || err).slice(0, 300),
        brevoKeyLength: keyLen,
        settingNames: Object.keys(env).sort(),
      });
    })
  );
  return json({ ok: true }, 200, NO_STORE);
}

// Called by the verify page after the visitor clicks the link (POST, so mail scanners that
// pre-fetch links cannot burn the one-time token).
export async function verify({ request, env }) {
  const body = await readJson(request, 2000);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(400, 'This sign-in link is invalid or has expired.');

  // Atomic single use: only one request can flip used_at from NULL.
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') RETURNING email"
  )
    .bind(await sha256Hex(token))
    .first();
  if (!row) throw new HttpError(400, 'This sign-in link is invalid or has expired.');

  const email = row.email.toLowerCase();
  const isAdmin = adminEmails(env).has(email);
  let user = await env.DB.prepare('SELECT id, email, role, disabled FROM users WHERE email = ?').bind(email).first();
  if (!user && !isAdmin) throw new HttpError(400, 'This sign-in link is invalid or has expired.');
  if (user?.disabled) throw new HttpError(403, 'This account is disabled.');

  if (!user) {
    user = await env.DB.prepare("INSERT INTO users (email, role) VALUES (?, 'admin') RETURNING id, email, role").bind(email).first();
  } else if (isAdmin && user.role !== 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user.role = 'admin';
  }
  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();

  const cookie = await createSession(env, request, user.id);
  await audit(env, user, 'login', 'user', user.id);
  return json({ ok: true, user: { email: user.email, role: user.role } }, 200, { ...NO_STORE, 'set-cookie': cookie });
}

export async function logout({ request, env }) {
  const user = await getUser(env, request);
  const cookie = await destroySession(env, request);
  if (user) await audit(env, user, 'logout', 'user', user.id);
  return json({ ok: true }, 200, { ...NO_STORE, 'set-cookie': cookie });
}

export async function me({ request, env }) {
  const user = await getUser(env, request);
  return json({ user: user ? { email: user.email, role: user.role } : null }, 200, NO_STORE);
}
