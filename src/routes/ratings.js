// Member ratings of firms. Stars show straight away; a comment is shown only after an admin approves it. A person rates a firm once (rating again replaces it),
// never a firm they manage, and at most 10 new ratings a day. Commenters are never named publicly.
import { json, readJson, NO_STORE, HttpError } from '../lib/http.js';
import { getUser, requireUser, requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);
export const RATING_LIMITS = { newPerDay: 10, commentMin: 10, commentMax: 600, publicComments: 6 };
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

// Plain text only: no links, addresses, phone numbers or markup in a comment.
export function checkComment(raw) {
  const c = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!c) return '';
  if (c.length < RATING_LIMITS.commentMin) throw new HttpError(422, `A comment needs at least ${RATING_LIMITS.commentMin} characters, or leave it empty.`);
  if (c.length > RATING_LIMITS.commentMax) throw new HttpError(422, `Please keep the comment under ${RATING_LIMITS.commentMax} characters.`);
  if (/[<>]|https?:|www\.|\S@\S|\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/i.test(c)) throw new HttpError(422, 'Please leave out links, email addresses, phone numbers and markup.');
  return c;
}

const liveFirm = async (env, slug) => {
  if (!SLUG.test(slug || '')) throw new HttpError(422, 'Choose a firm to rate.');
  if (!(await env.DB.prepare("SELECT 1 FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first())) throw new HttpError(404, 'Firm not found');
};

async function summary(env, slug, userId) {
  const rows = (await env.DB.prepare("SELECT stars, COUNT(*) AS n FROM firm_ratings WHERE firm_slug = ? AND status = 'live' GROUP BY stars").bind(slug).all()).results;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0; let sum = 0;
  for (const r of rows) { distribution[r.stars] = r.n; count += r.n; sum += r.n * r.stars; }
  const comments = (await env.DB.prepare(
    "SELECT stars, comment, updated_at AS at FROM firm_ratings WHERE firm_slug = ? AND status = 'live' AND comment_status = 'approved' ORDER BY updated_at DESC LIMIT ?"
  ).bind(slug, RATING_LIMITS.publicComments).all()).results;
  const mine = userId ? await env.DB.prepare('SELECT stars, comment, comment_status AS commentStatus, status FROM firm_ratings WHERE user_id = ? AND firm_slug = ?').bind(userId, slug).first() : null;
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution, comments, mine: mine || null };
}

// Public: the totals, the approved comments, and (if signed in) your own rating.
export async function list({ request, env, params }) {
  const user = await getUser(env, request);
  await liveFirm(env, params.slug);
  const managed = user ? !!(await env.DB.prepare('SELECT 1 FROM firm_members WHERE user_id = ? AND firm_slug = ?').bind(user.id, params.slug).first()) : false;
  return reply({ signedIn: !!user, canRate: !!user && !managed, manages: managed, ...(await summary(env, params.slug, user?.id)) });
}

export async function rate({ request, env }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 3000);
  const slug = String(body.slug || '').toLowerCase();
  await liveFirm(env, slug);
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(422, 'Choose 1 to 5 stars.');
  const comment = 'comment' in body ? checkComment(body.comment) : undefined;
  if (await env.DB.prepare('SELECT 1 FROM firm_members WHERE user_id = ? AND firm_slug = ?').bind(user.id, slug).first()) throw new HttpError(403, 'You manage this firm, so you cannot rate it.');
  const existing = await env.DB.prepare('SELECT comment, comment_status AS cs FROM firm_ratings WHERE user_id = ? AND firm_slug = ?').bind(user.id, slug).first();
  if (!existing) {
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM firm_ratings WHERE user_id = ? AND created_at > datetime('now', '-1 day')").bind(user.id).first();
    if (today.n >= RATING_LIMITS.newPerDay) throw new HttpError(429, 'You have rated a lot of firms today. Please come back tomorrow.');
  }
  let text = existing?.comment || null;
  let cs = existing?.cs || 'none';
  if (comment !== undefined && comment !== (existing?.comment || '')) { text = comment || null; cs = comment ? 'pending' : 'none'; } // a new or changed comment is checked again
  await env.DB.prepare(
    `INSERT INTO firm_ratings (user_id, firm_slug, stars, comment, comment_status) VALUES (?,?,?,?,?)
     ON CONFLICT (user_id, firm_slug) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, comment_status = excluded.comment_status, updated_at = datetime('now')`
  ).bind(user.id, slug, stars, text, cs).run();
  return reply({ ok: true, ...(await summary(env, slug, user.id)) });
}

export async function mine({ request, env }) {
  const user = await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT r.firm_slug AS slug, json_extract(f.data, '$.name') AS name, r.stars, r.comment, r.comment_status AS commentStatus, r.updated_at AS at
     FROM firm_ratings r JOIN firms f ON f.slug = r.firm_slug WHERE r.user_id = ? ORDER BY r.updated_at DESC`
  ).bind(user.id).all();
  return reply({ ratings: results });
}

export async function remove({ request, env, params }) {
  const user = await requireUser(env, request);
  await env.DB.prepare('DELETE FROM firm_ratings WHERE user_id = ? AND firm_slug = ?').bind(user.id, String(params.slug || '').toLowerCase()).run();
  return reply({ ok: true });
}

// ---------------------------------------------------------------- admin
export async function adminList({ request, env }) {
  await requireAdmin(env, request);
  const cols = `r.user_id AS userId, r.firm_slug AS slug, json_extract(f.data, '$.name') AS firm, u.email, r.stars, r.comment, r.comment_status AS commentStatus, r.status, r.updated_at AS at`;
  const [pending, recent] = await Promise.all([
    env.DB.prepare(`SELECT ${cols} FROM firm_ratings r JOIN firms f ON f.slug = r.firm_slug JOIN users u ON u.id = r.user_id WHERE r.comment_status = 'pending' ORDER BY r.updated_at LIMIT 100`).all(),
    env.DB.prepare(`SELECT ${cols} FROM firm_ratings r JOIN firms f ON f.slug = r.firm_slug JOIN users u ON u.id = r.user_id ORDER BY r.updated_at DESC LIMIT 40`).all(),
  ]);
  return reply({ pending: pending.results, recent: recent.results });
}

export async function adminDecide({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 500);
  const where = [Number(params.userId), String(params.slug)];
  if (!Number.isInteger(where[0])) throw new HttpError(422, 'Bad request');
  const actions = { approve: "comment_status = 'approved'", reject: "comment_status = 'rejected'", hide: "status = 'hidden'", show: "status = 'live'" };
  if (!actions[body.action]) throw new HttpError(422, 'Choose approve, reject, hide or show.');
  const r = await env.DB.prepare(`UPDATE firm_ratings SET ${actions[body.action]} WHERE user_id = ? AND firm_slug = ?`).bind(...where).run();
  if (!r.meta.changes) throw new HttpError(404, 'Rating not found');
  await audit(env, admin, `rating.${body.action}`, 'firm', where[1], { userId: where[0] });
  return reply({ ok: true });
}
