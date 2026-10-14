// "Continue with Google" and "Continue with LinkedIn". Standard OpenID Connect sign-in (authorization code + PKCE), done on the server.
//
// Safety rules:
//  - the secret is a Cloudflare secret and never leaves the server; the browser only ever sees redirects;
//  - every attempt has a one-time `state` (only its hash is stored, valid 10 minutes) and a PKCE verifier;
//  - an account is matched by e-mail address, and ONLY if the provider says that e-mail is verified;
//  - ADMIN_EMAILS still decides who is an admin; disabled accounts cannot sign in; new accounts per day are capped.
import { randomToken, sha256Hex } from './crypto.js';
import { adminEmails, createSession } from './auth.js';
import { isEmail } from './http.js';
import { audit } from './audit.js';
import { mailInBackground, welcomeEmail } from './email.js';

const PROVIDERS = {
  google: {
    name: 'Google', idVar: 'GOOGLE_CLIENT_ID', secretVar: 'GOOGLE_CLIENT_SECRET', scope: 'openid email profile', extra: { prompt: 'select_account' },
    auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', user: 'https://openidconnect.googleapis.com/v1/userinfo',
  },
  linkedin: {
    name: 'LinkedIn', idVar: 'LINKEDIN_CLIENT_ID', secretVar: 'LINKEDIN_CLIENT_SECRET', scope: 'openid profile email', extra: {},
    auth: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken', user: 'https://api.linkedin.com/v2/userinfo',
  },
};
const MAX_NEW_ACCOUNTS_PER_DAY = 150;
const dev = (env) => env.DEV_ECHO_LINK === '1';

function config(env, key) {
  const p = PROVIDERS[key];
  if (!p || !env[p.idVar] || !env[p.secretVar]) return null;
  const o = (suffix, fallback) => (dev(env) && env[`${key.toUpperCase()}_${suffix}`]) || fallback; // local tests point these at a pretend provider
  return { ...p, id: env[p.idVar], secret: env[p.secretVar], auth: o('AUTH_URL', p.auth), token: o('TOKEN_URL', p.token), user: o('USERINFO_URL', p.user) };
}

export const providersConfigured = (env) => ({ google: !!config(env, 'google'), linkedin: !!config(env, 'linkedin') });

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const siteOrigin = (env, url) => (dev(env) ? url.origin : (env.SITE_ORIGIN || url.origin)).replace(/\/+$/, '');
// Only places on our own site, never an address someone else supplied.
const safeNext = (n) => (typeof n === 'string' && /^\/(account\/|firms\/[a-z0-9-]+$|news(\/|$|\?))/.test(n) && !n.includes('//') && !n.includes('\\') ? n : '/account/');
const back = (origin, query) => Response.redirect(`${origin}/account/?${query}`, 302);

export async function startOAuth(env, request, url, key) {
  const c = config(env, key);
  const origin = siteOrigin(env, url);
  if (!c) return back(origin, 'signin=unavailable');
  const state = randomToken();
  const verifier = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE created_at < datetime('now', '-30 minutes')"),
    env.DB.prepare('INSERT INTO oauth_states (state_hash, provider, verifier, next_path) VALUES (?, ?, ?, ?)').bind(await sha256Hex(state), key, verifier, safeNext(url.searchParams.get('next'))),
  ]);
  const q = new URLSearchParams({
    response_type: 'code', client_id: c.id, redirect_uri: `${origin}/api/auth/${key}/callback`, scope: c.scope, state,
    code_challenge: b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), code_challenge_method: 'S256', ...c.extra,
  });
  return Response.redirect(`${c.auth}?${q}`, 302);
}

async function readProfile(c, code, verifier, redirectUri) {
  const tok = await fetch(c.token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret, code_verifier: verifier }),
  });
  const t = await tok.json().catch(() => ({}));
  if (!tok.ok || !t.access_token) throw new Error(`token exchange failed (${tok.status})`);
  const res = await fetch(c.user, { headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  const p = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`profile lookup failed (${res.status})`);
  return p;
}

// Sends the welcome email the first time an account is signed in (any method), exactly once.
export async function welcomeOnce(env, exec, origin, user, name) {
  const first = await env.DB.prepare("UPDATE users SET welcomed_at = datetime('now') WHERE id = ? AND welcomed_at IS NULL RETURNING id").bind(user.id).first();
  if (first) mailInBackground(env, exec, { to: user.email, ...welcomeEmail(origin, { name }) });
}

export async function finishOAuth(env, request, url, exec, key) {
  const c = config(env, key);
  const origin = siteOrigin(env, url);
  if (!c) return back(origin, 'signin=unavailable');
  const fail = async (reason) => { await audit(env, null, 'login.oauth_failed', 'provider', key, { reason }); return back(origin, 'signin=failed'); };
  if (url.searchParams.get('error')) return back(origin, 'signin=cancelled');
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || !/^[0-9a-f]{64}$/.test(state)) return fail('missing code or state');
  const row = await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND created_at > datetime('now', '-10 minutes') RETURNING provider, verifier, next_path").bind(await sha256Hex(state)).first();
  if (!row || row.provider !== key) return fail('unknown, used or expired state');

  let p;
  try { p = await readProfile(c, code, row.verifier, `${origin}/api/auth/${key}/callback`); } catch (err) { return fail(String(err.message).slice(0, 120)); }
  const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
  if (!isEmail(email) || !(p.email_verified === true || p.email_verified === 'true')) return fail('no verified e-mail address');

  const isAdmin = adminEmails(env).has(email);
  let user = await env.DB.prepare('SELECT id, email, role, disabled, name FROM users WHERE email = ?').bind(email).first();
  if (user?.disabled) return fail('account disabled');
  let isNew = false;
  if (!user) {
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'signup.oauth' AND at > datetime('now', '-1 day')").first();
    if (today.n >= MAX_NEW_ACCOUNTS_PER_DAY) return fail('too many new accounts today');
    user = await env.DB.prepare('INSERT INTO users (email, role, provider) VALUES (?, ?, ?) RETURNING id, email, role, name').bind(email, isAdmin ? 'admin' : 'member', key).first();
    isNew = true;
    await audit(env, user, 'signup.oauth', 'user', user.id, { provider: key });
  } else if (isAdmin && user.role !== 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
  } else if (!isAdmin && user.role === 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'member' WHERE id = ?").bind(user.id).run();
  }
  const name = typeof p.name === 'string' ? p.name.replace(/[<>]/g, '').trim().slice(0, 80) : '';
  if (name && !user.name) await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  await welcomeOnce(env, exec, origin, user, user.name || name);

  const cookie = await createSession(env, request, user.id);
  await audit(env, user, 'login', 'user', user.id, { provider: key });
  return new Response(null, { status: 302, headers: { location: origin + row.next_path, 'set-cookie': cookie, 'cache-control': 'no-store' } });
}
