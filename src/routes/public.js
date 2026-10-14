import { json, cached, clampInt, HttpError, isEmail } from '../lib/http.js';
import { mailInBackground, leadEmail } from '../lib/email.js';

export async function listFirms({ url, env }) {
  const p = url.searchParams;
  const where = ["status = 'live'"];
  const args = [];
  if (p.get('province')) { where.push('province = ?'); args.push(p.get('province').toUpperCase()); }
  if (p.get('city')) { where.push('city = ? COLLATE NOCASE'); args.push(p.get('city')); }
  if (p.get('region')) { where.push('region = ?'); args.push(p.get('region')); }
  if (p.get('featured') === '1') where.push('featured = 1');
  if (p.get('q')) {
    where.push("(name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
    const like = `%${p.get('q').replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like);
  }
  const limit = clampInt(p.get('limit'), 500, 1, 500);
  const offset = clampInt(p.get('offset'), 0, 0, 100000);
  const sql =
    `SELECT data FROM firms ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ` +
    `ORDER BY featured DESC, rating DESC, review_count DESC, name LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...args, limit, offset).all();
  return cached(results.map((r) => JSON.parse(r.data)));
}

export async function getFirm({ params, env }) {
  const row = await env.DB.prepare("SELECT data, hours, about FROM firms WHERE slug = ? AND status = 'live'").bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  return cached({ ...JSON.parse(row.data), about: row.about || '', hours: row.hours ? JSON.parse(row.hours) : null });
}

export async function listBlog({ url, env }) {
  const province = url.searchParams.get('province');
  const stmt = province
    ? env.DB.prepare('SELECT data FROM blog_posts WHERE province = ? ORDER BY sort_order').bind(province.toUpperCase())
    : env.DB.prepare('SELECT data FROM blog_posts ORDER BY sort_order');
  const { results } = await stmt.all();
  return cached(results.map((r) => JSON.parse(r.data)));
}

const LIMITS = { name: 200, phone: 50, message: 5000, page: 300, field: 2000, fields: 40 };
const MAX_LEAD_EMAILS_PER_FIRM_HOUR = 20;
const RESERVED = new Set(['access_key', 'botcheck', 'name', 'email', 'phone', 'message', 'form', 'page']);

export async function createLead({ request, env, url, exec }) {
  let input;
  try {
    const type = request.headers.get('content-type') || '';
    input = type.includes('application/json') ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    throw new HttpError(400, 'Invalid request body');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid request body');

  // Honeypot: real people never fill the hidden "botcheck" field. Pretend success to bots.
  if (input.botcheck) return json({ ok: true });

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = str(input.name, LIMITS.name);
  const email = str(input.email, 254);
  const phone = str(input.phone, LIMITS.phone);
  const message = str(input.message, LIMITS.message);
  const form = str(input.form, 50) || 'contact';
  const page = str(input.page, LIMITS.page) || request.headers.get('referer') || '';

  if (!name) throw new HttpError(422, 'Name is required');
  if (!isEmail(email)) throw new HttpError(422, 'A valid email is required');

  // Everything else submitted is kept (capped) so no form field is ever lost.
  const extra = {};
  for (const [k, v] of Object.entries(input).slice(0, LIMITS.fields)) {
    if (RESERVED.has(k)) continue;
    if (typeof v === 'string') extra[k.slice(0, 60)] = v.slice(0, LIMITS.field);
  }

  // Basic throttle: max 5 submissions per email per 10 minutes.
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE email = ? AND created_at > datetime('now','-10 minutes')")
    .bind(email)
    .first();
  if (recent && recent.n >= 5) throw new HttpError(429, 'Too many submissions, please try again later');

  // A form on a firm's own profile page names that firm: route the enquiry to it.
  const firmSlug = str(input.firm, 100);
  const firm = firmSlug ? await env.DB.prepare("SELECT slug, name FROM firms WHERE slug = ? AND status = 'live'").bind(firmSlug).first() : null;

  await env.DB.prepare('INSERT INTO leads (form,name,email,phone,message,payload,page,firm_slug) VALUES (?,?,?,?,?,?,?,?)')
    .bind(form, name, email, phone || null, message || null, JSON.stringify(extra), page || null, firm ? firm.slug : null)
    .run();

  // Tell the firm's approved owners right away. Capped per firm per hour so a flood of fake
  // enquiries cannot turn into a flood of email (every enquiry is still saved and shown in the dashboard).
  if (firm) {
    const [owners, sent] = await Promise.all([
      env.DB.prepare("SELECT u.email FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_slug = ? AND m.status = 'approved' AND u.disabled = 0").bind(firm.slug).all(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE firm_slug = ? AND created_at > datetime('now','-1 hour')").bind(firm.slug).first(),
    ]);
    if (owners.results.length && sent.n <= MAX_LEAD_EMAILS_PER_FIRM_HOUR) {
      mailInBackground(env, exec, { to: owners.results.map((o) => o.email), ...leadEmail(env.SITE_ORIGIN || url.origin, firm.name, { name, email, phone, message }) });
    }
  }

  return json({ ok: true }, 201);
}
