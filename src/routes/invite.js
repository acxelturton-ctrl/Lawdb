// Owner invites. After a phone call an admin invites the firm's owner by email; the link signs them in and gives them that
// firm at once (no claim-and-wait). Admin side: create/list. Public side: accept (token in the URL fragment, POSTed by a button
// press so mail scanners cannot burn it).
import { json, readJson, isEmail, NO_STORE, HttpError } from '../lib/http.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { adminEmails, createSession, requireAdmin } from '../lib/auth.js';
import { inviteEmail, mailInBackground } from '../lib/email.js';
import { audit } from '../lib/audit.js';

const DAYS_VALID = 14;
const MAX_PER_FIRM_DAY = 5;
const MAX_PER_DAY = 60;
const origin = (env, url) => (env.DEV_ECHO_LINK === '1' ? url.origin : env.SITE_ORIGIN || url.origin);
const reply = (data, status = 200) => json(data, status, NO_STORE);

export async function create({ request, env, url, params, exec }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 1000);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isEmail(email)) throw new HttpError(422, 'A valid email address is required');
  const firm = await env.DB.prepare("SELECT slug, name, status, page_mode AS pageMode FROM firms WHERE slug = ?").bind(params.slug).first();
  if (!firm) throw new HttpError(404, 'Firm not found');
  if (firm.status !== 'live') throw new HttpError(409, 'Only a live firm can be given to an owner. Approve the listing first.');
  const [perFirm, today] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_invites WHERE firm_slug = ? AND created_at > datetime('now','-1 day')").bind(firm.slug).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_invites WHERE created_at > datetime('now','-1 day')").first(),
  ]);
  if (perFirm.n >= MAX_PER_FIRM_DAY) throw new HttpError(429, 'This firm already had several invites today. Use one of the links you already have, or try again tomorrow.');
  if (today.n >= MAX_PER_DAY) throw new HttpError(429, 'Daily invite limit reached. Try again tomorrow.');

  const switchPage = body.switchPage === true && firm.pageMode === 'static';
  const token = randomToken();
  await env.DB.prepare("INSERT INTO firm_invites (token_hash, email, firm_slug, switch_page, invited_by, expires_at) VALUES (?,?,?,?,?, datetime('now', ?))")
    .bind(await sha256Hex(token), email, firm.slug, switchPage ? 1 : 0, admin.id, `+${DAYS_VALID} days`).run();
  const link = `${origin(env, url)}/account/welcome#invite=${token}`;
  mailInBackground(env, exec, { to: email, ...inviteEmail(link, { firmName: firm.name, days: DAYS_VALID }) });
  await audit(env, admin, 'owner.invite', 'firm', firm.slug, { email, switchPage });
  // The admin also gets the link, so it can be read out, texted or pasted if the email is slow.
  return reply({ ok: true, link, email, expiresInDays: DAYS_VALID }, 201);
}

export async function list({ request, env, params }) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    "SELECT email, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt, (expires_at <= datetime('now') AND used_at IS NULL) AS expired FROM firm_invites WHERE firm_slug = ? ORDER BY id DESC LIMIT 10"
  ).bind(params.slug).all();
  return reply({ invites: results });
}

export async function accept({ request, env }) {
  const body = await readJson(request, 2000);
  const token = typeof body.token === 'string' ? body.token : '';
  const bad = () => new HttpError(400, 'This invite link is invalid or has expired. Ask LawDB to send a new one.');
  if (!/^[0-9a-f]{64}$/.test(token)) throw bad();
  const inv = await env.DB.prepare(
    "UPDATE firm_invites SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') RETURNING email, firm_slug AS slug, switch_page AS switchPage, invited_by AS invitedBy"
  ).bind(await sha256Hex(token)).first();
  if (!inv) throw bad();
  const firm = await env.DB.prepare("SELECT slug, name, status, page_mode AS pageMode FROM firms WHERE slug = ?").bind(inv.slug).first();
  if (!firm || firm.status !== 'live') throw bad();

  const email = inv.email.toLowerCase();
  let user = await env.DB.prepare('SELECT id, email, role, disabled, name FROM users WHERE email = ?').bind(email).first();
  if (user?.disabled) throw new HttpError(403, 'This account is disabled.');
  if (!user) {
    user = await env.DB.prepare('INSERT INTO users (email, role) VALUES (?, ?) RETURNING id, email, role, name').bind(email, adminEmails(env).has(email) ? 'admin' : 'member').first();
  }
  const contact = user.name || email.split('@')[0];
  const writes = [
    env.DB.prepare(
      `INSERT INTO firm_members (user_id, firm_slug, status, contact_name, message, decided_at, decided_by, terms_accepted_at)
       VALUES (?,?, 'approved', ?, 'Invited by LawDB', datetime('now'), ?, datetime('now'))
       ON CONFLICT (user_id, firm_slug) DO UPDATE SET status = 'approved', decided_at = datetime('now'), decided_by = excluded.decided_by`
    ).bind(user.id, firm.slug, contact, inv.invitedBy),
    // They are here to edit their firm, so skip the member welcome steps and the generic welcome email (the invite already welcomed them).
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now'), onboarded_at = COALESCE(onboarded_at, datetime('now')), welcomed_at = COALESCE(welcomed_at, datetime('now')) WHERE id = ?").bind(user.id),
  ];
  if (inv.switchPage && firm.pageMode === 'static') writes.push(env.DB.prepare("UPDATE firms SET page_mode = 'dynamic', updated_at = datetime('now') WHERE slug = ?").bind(firm.slug));
  await env.DB.batch(writes);
  const cookie = await createSession(env, request, user.id);
  await audit(env, user, 'owner.invite_accept', 'firm', firm.slug, { email, switchPage: !!inv.switchPage });
  return json({ ok: true, slug: firm.slug, name: firm.name, role: user.role }, 200, { ...NO_STORE, 'set-cookie': cookie });
}
