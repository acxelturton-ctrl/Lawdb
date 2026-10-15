import { json, readJson, isEmail, NO_STORE, HttpError } from '../lib/http.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { adminEmails, createSession, destroySession, getUser } from '../lib/auth.js';
import { sendLoginEmail } from '../lib/email.js';
import { providersConfigured, startOAuth, finishOAuth, welcomeOnce } from '../lib/oauth.js';
import { audit } from '../lib/audit.js';

const MAX_LINKS_PER_15_MIN = 3;
const MAX_SIGNUPS_PER_IP_HOUR = 6;
const MAX_SIGNUPS_PER_DAY = 150; // Brevo's free plan sends 300 emails a day; keep room for sign-ins and notices

// Always answers { ok: true } so the response never reveals which emails are registered.
export async function requestLink({ request, env, url, exec }) {
  const body = await readJson(request, 2000);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isEmail(email)) throw new HttpError(422, 'A valid email is required');

  // Known users (and configured admins) get a link.
  const known = adminEmails(env).has(email) || (await env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND disabled = 0').bind(email).first());
  // Firm owners may create an account from the same form (signup: true). Strangers can then
  // trigger emails from our domain, so brand-new addresses are limited per requester and per day.
  const signup = body.signup === true;
  if (!known && !signup) return json({ ok: true }, 200, NO_STORE);
  const ipHash = await sha256Hex('ip:' + (request.headers.get('cf-connecting-ip') || 'local'));
  if (!known) {
    const [byIp, today] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE signup = 1 AND ip_hash = ? AND created_at > datetime('now','-1 hour')").bind(ipHash).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE signup = 1 AND created_at > datetime('now','-1 day')").first(),
    ]);
    if (byIp.n >= MAX_SIGNUPS_PER_IP_HOUR || today.n >= MAX_SIGNUPS_PER_DAY) {
      await audit(env, null, 'signup.throttled', 'email', email, { fromThisAddressLastHour: byIp.n, allLastDay: today.n });
      return json({ ok: true }, 200, NO_STORE);
    }
  }
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > datetime('now','-15 minutes')").bind(email).first();
  if (recent.n >= MAX_LINKS_PER_15_MIN) {
    // Same response as success (no leak), but leave a trace so a silent limit is never a mystery.
    await audit(env, null, 'login.throttled', 'email', email, { linksInLast15Min: recent.n });
    return json({ ok: true }, 200, NO_STORE);
  }

  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at, signup, ip_hash) VALUES (?, ?, datetime('now','+15 minutes'), ?, ?)")
    .bind(await sha256Hex(token), email, signup ? 1 : 0, ipHash)
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
      return audit(env, null, 'login.email_failed', 'email', email, { error: String(err.message || err).slice(0, 300) });
    })
  );
  return json({ ok: true }, 200, NO_STORE);
}

// Called by the verify page after the visitor clicks the link (POST, so mail scanners that
// pre-fetch links cannot burn the one-time token).
export async function verify({ request, env, url, exec }) {
  const body = await readJson(request, 2000);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(400, 'This sign-in link is invalid or has expired.');

  // Atomic single use: only one request can flip used_at from NULL.
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') RETURNING email, signup"
  )
    .bind(await sha256Hex(token))
    .first();
  if (!row) throw new HttpError(400, 'This sign-in link is invalid or has expired.');

  const email = row.email.toLowerCase();
  const isAdmin = adminEmails(env).has(email);
  let user = await env.DB.prepare('SELECT id, email, role, disabled FROM users WHERE email = ?').bind(email).first();
  if (!user && !isAdmin && !row.signup) throw new HttpError(400, 'This sign-in link is invalid or has expired.');
  if (user?.disabled) throw new HttpError(403, 'This account is disabled.');

  if (!user) {
    user = await env.DB.prepare("INSERT INTO users (email, role) VALUES (?, ?) RETURNING id, email, role").bind(email, isAdmin ? 'admin' : 'member').first();
  } else if (isAdmin && user.role !== 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user.role = 'admin';
  } else if (!isAdmin && user.role === 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'member' WHERE id = ?").bind(user.id).run(); // taken off ADMIN_EMAILS
    user.role = 'member';
  }
  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  await welcomeOnce(env, exec, env.DEV_ECHO_LINK === '1' ? url.origin : env.SITE_ORIGIN || url.origin, user, '');

  const cookie = await createSession(env, request, user.id);
  await audit(env, user, 'login', 'user', user.id);
  return json({ ok: true, user: { email: user.email, role: user.role } }, 200, { ...NO_STORE, 'set-cookie': cookie });
}

export const providers = ({ env }) => json(providersConfigured(env), 200, NO_STORE);
export const oauthStart = (key) => ({ request, env, url }) => startOAuth(env, request, url, key);
export const oauthCallback = (key) => ({ request, env, url, exec }) => finishOAuth(env, request, url, exec, key);

export async function logout({ request, env }) {
  const user = await getUser(env, request);
  const cookie = await destroySession(env, request);
  if (user) await audit(env, user, 'logout', 'user', user.id);
  return json({ ok: true }, 200, { ...NO_STORE, 'set-cookie': cookie });
}

// "Sign out everywhere": ends every session this person has, on every device.
export async function logoutAll({ request, env }) {
  const user = await getUser(env, request);
  if (user) {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    await audit(env, user, 'logout.all', 'user', user.id);
  }
  return json({ ok: true }, 200, { ...NO_STORE, 'set-cookie': await destroySession(env, request) });
}

export async function me({ request, env }) {
  const user = await getUser(env, request);
  return json({ user: user ? { email: user.email, role: user.role } : null }, 200, NO_STORE);
}
