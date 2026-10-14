import { HttpError } from './http.js';
import { randomToken, sha256Hex } from './crypto.js';

const SESSION_DAYS = 14;

// __Host- prefix pins the cookie to this exact host over HTTPS; plain name only for http://localhost.
const cookieName = (request) => (new URL(request.url).protocol === 'https:' ? '__Host-lawdb_session' : 'lawdb_session');

const readCookie = (request, name) => {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
};

export const adminEmails = (env) =>
  new Set((env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

function cookieHeader(request, value, maxAgeSeconds) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function createSession(env, request, userId) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
    env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < datetime('now', '-1 day')"),
    env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).bind(
      await sha256Hex(token),
      userId
    ),
  ]);
  return cookieHeader(request, token, SESSION_DAYS * 86400);
}

export async function destroySession(env, request) {
  const token = readCookie(request, cookieName(request));
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return cookieHeader(request, '', 0);
}

// Returns { id, email, role } or null.
export async function getUser(env, request) {
  const token = readCookie(request, cookieName(request));
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.disabled = 0`
  )
    .bind(await sha256Hex(token))
    .first();
}

export async function requireAdmin(env, request) {
  const user = await getUser(env, request);
  if (!user) throw new HttpError(401, 'Sign in required');
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  return user;
}

export async function requireUser(env, request) {
  const user = await getUser(env, request);
  if (!user) throw new HttpError(401, 'Sign in required');
  return user;
}
