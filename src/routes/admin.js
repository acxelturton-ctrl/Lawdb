import { json, readJson, clampInt, NO_STORE, HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);

export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'];

export async function stats({ request, env }) {
  await requireAdmin(env, request);
  const [firms, posts, leads, week] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n, SUM(featured) AS featured FROM firms'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM blog_posts'),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_at > datetime('now','-7 days')"),
  ]);
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const r of leads.results) byStatus[r.status] = r.n;
  return reply({
    firms: firms.results[0].n,
    featured: firms.results[0].featured || 0,
    blogPosts: posts.results[0].n,
    leads: byStatus,
    leadsLast7Days: week.results[0].n,
  });
}

// Keyset pagination (stable while new leads arrive): pass the previous page's `next` as `before`.
export async function listLeads({ request, env, url }) {
  await requireAdmin(env, request);
  const status = url.searchParams.get('status');
  if (status && !LEAD_STATUSES.includes(status)) throw new HttpError(422, 'Unknown status');
  const limit = clampInt(url.searchParams.get('limit'), 30, 1, 100);
  const before = clampInt(url.searchParams.get('before'), 0, 0, Number.MAX_SAFE_INTEGER);

  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (before) { where.push('id < ?'); args.push(before); }
  const { results } = await env.DB.prepare(
    `SELECT id, form, name, email, phone, message, payload, page, status, created_at FROM leads
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  )
    .bind(...args, limit + 1)
    .all();
  const page = results.slice(0, limit).map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
  return reply({ leads: page, next: results.length > limit ? page[page.length - 1].id : null });
}

export async function updateLead({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 1000);
  if (!LEAD_STATUSES.includes(body.status)) throw new HttpError(422, `status must be one of: ${LEAD_STATUSES.join(', ')}`);
  const id = Number.parseInt(params.id, 10);
  const before = await env.DB.prepare('SELECT status FROM leads WHERE id = ?').bind(id).first();
  if (!before) throw new HttpError(404, 'Lead not found');
  await env.DB.prepare('UPDATE leads SET status = ? WHERE id = ?').bind(body.status, id).run();
  await audit(env, admin, 'lead.status', 'lead', id, { from: before.status, to: body.status });
  return reply({ ok: true });
}

export async function listFirms({ request, env, url }) {
  await requireAdmin(env, request);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = clampInt(url.searchParams.get('limit'), 25, 1, 100);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { results } = await env.DB.prepare(
    `SELECT slug, name, city, province, featured, rating, review_count, updated_at FROM firms
     WHERE ? = '' OR name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' ORDER BY name LIMIT ? OFFSET ?`
  )
    .bind(q, like, like, limit, offset)
    .all();
  return reply({ firms: results.map((r) => ({ ...r, featured: !!r.featured })) });
}

export async function getFirm({ request, env, params }) {
  await requireAdmin(env, request);
  const row = await env.DB.prepare('SELECT data, updated_at FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  return reply({ firm: JSON.parse(row.data), updatedAt: row.updated_at });
}

// Only these fields can be edited from the admin page. Everything else (slug, rating, review
// count, coordinates) is controlled by import scripts, not by hand.
const FIRM_FIELDS = {
  name: (v) => str(v, 1, 200),
  blurb: (v) => str(v, 0, 500),
  phone: (v) => {
    const s = str(v, 0, 30);
    if (s && !/^\+?[0-9 ()\-.]{7,30}$/.test(s)) throw new HttpError(422, 'phone: use digits, spaces and + ( ) - only');
    return s;
  },
  website: (v) => {
    const s = str(v, 0, 300);
    if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw new HttpError(422, 'website must start with http:// or https://');
    return s;
  },
  address: (v) => str(v, 0, 300),
  featured: (v) => {
    if (typeof v !== 'boolean') throw new HttpError(422, 'featured must be true or false');
    return v;
  },
  tags: (v) => {
    if (!Array.isArray(v) || v.length > 10) throw new HttpError(422, 'tags must be a list of at most 10 items');
    return v.map((t) => str(t, 1, 60));
  },
};

function str(v, min, max) {
  if (typeof v !== 'string') throw new HttpError(422, 'Expected text');
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(422, `Text must be ${min}-${max} characters`);
  return s;
}

export async function updateFirm({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 10000);
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(422, 'Nothing to update');
  const unknown = keys.filter((k) => !(k in FIRM_FIELDS));
  if (unknown.length) throw new HttpError(422, `Cannot edit: ${unknown.join(', ')}`);

  const row = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  const firm = JSON.parse(row.data);

  const changes = {};
  for (const k of keys) {
    const next = FIRM_FIELDS[k](body[k]);
    if (JSON.stringify(firm[k]) !== JSON.stringify(next)) {
      changes[k] = { from: firm[k] ?? null, to: next };
      firm[k] = next;
    }
  }
  if (!Object.keys(changes).length) return reply({ ok: true, changed: [] });

  // `data` is the source of truth; the indexed columns are derived from it.
  await env.DB.prepare("UPDATE firms SET data = ?, name = ?, featured = ?, updated_at = datetime('now') WHERE slug = ?")
    .bind(JSON.stringify(firm), firm.name, firm.featured ? 1 : 0, params.slug)
    .run();
  await audit(env, admin, 'firm.update', 'firm', params.slug, changes);
  return reply({ ok: true, changed: Object.keys(changes), firm });
}

export async function listAudit({ request, env, url }) {
  await requireAdmin(env, request);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const { results } = await env.DB.prepare('SELECT id, at, actor_email, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all();
  return reply({ entries: results.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) });
}
