import { json, readJson, clampInt, NO_STORE, HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { mailInBackground, decisionEmail } from '../lib/email.js';
import { applyFirmEdit, prepareNewFirm, insertFirm, CASE_TYPES } from '../lib/firm-edit.js';

export { CASE_TYPES };

const reply = (body, status = 200) => json(body, status, NO_STORE);

export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'];

export async function stats({ request, env }) {
  await requireAdmin(env, request);
  const [firms, posts, leads, week, pending] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(featured) AS featured FROM firms WHERE status = 'live'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM blog_posts'),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_at > datetime('now','-7 days')"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_members WHERE status = 'pending'"),
  ]);
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const r of leads.results) byStatus[r.status] = r.n;
  return reply({
    firms: firms.results[0].n,
    featured: firms.results[0].featured || 0,
    blogPosts: posts.results[0].n,
    leads: byStatus,
    leadsLast7Days: week.results[0].n,
    pendingApprovals: pending.results[0].n,
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
    `SELECT slug, name, city, province, featured, rating, review_count, status, updated_at FROM firms
     WHERE ? = '' OR name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' ORDER BY name LIMIT ? OFFSET ?`
  )
    .bind(q, like, like, limit, offset)
    .all();
  return reply({ firms: results.map((r) => ({ ...r, featured: !!r.featured })) });
}

export async function getFirm({ request, env, params }) {
  await requireAdmin(env, request);
  const row = await env.DB.prepare('SELECT data, hours, page_mode, about, status, updated_at FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  return reply({ status: row.status, firm: { ...JSON.parse(row.data), about: row.about || '' }, hours: row.hours ? JSON.parse(row.hours) : null, pageMode: row.page_mode, updatedAt: row.updated_at });
}

export async function updateFirm({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 10000);
  const { changed, firm } = await applyFirmEdit(env, admin, params.slug, body, { admin: true });
  return reply({ ok: true, changed, ...(changed.length ? { firm } : {}) });
}

export async function listAudit({ request, env, url }) {
  await requireAdmin(env, request);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const { results } = await env.DB.prepare('SELECT id, at, actor_email, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all();
  return reply({ entries: results.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) });
}


// ---------------------------------------------------------------- create a firm
export async function createFirm({ request, env }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 20000);
  const built = await prepareNewFirm(env, body, { requireCoords: true });
  await insertFirm(env, built, { status: 'live', createdBy: admin.id });
  await audit(env, admin, 'firm.create', 'firm', built.firm.slug, { name: built.firm.name, city: built.firm.city, province: built.firm.province });
  return reply({ ok: true, slug: built.firm.slug, url: `/firms/${built.firm.slug}` }, 201);
}


// ---------------------------------------------------------------- owner approvals
// A person asked to manage a firm (claim) or to list a new one. Nothing they request takes effect until approved here.
export async function listMembers({ request, env, url }) {
  await requireAdmin(env, request);
  const decided = url.searchParams.get('decided') === '1';
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.status, m.contact_name AS contactName, m.job_title AS jobTitle, m.message, m.created_at AS requestedAt, m.decided_at AS decidedAt,
            u.email, f.slug, f.name AS firmName, f.city, f.province, f.status AS firmStatus, f.featured, f.page_mode AS pageMode, f.lat, f.lng, f.created_by AS createdBy, f.data,
            (SELECT GROUP_CONCAT(u2.email, ', ') FROM firm_members m2 JOIN users u2 ON u2.id = m2.user_id
              WHERE m2.firm_slug = f.slug AND m2.status = 'approved' AND m2.id != m.id) AS otherOwners
     FROM firm_members m JOIN users u ON u.id = m.user_id JOIN firms f ON f.slug = m.firm_slug
     WHERE ${decided ? "m.status != 'pending'" : "m.status = 'pending'"}
     ORDER BY ${decided ? 'COALESCE(m.decided_at, m.created_at) DESC LIMIT 50' : 'm.id ASC LIMIT 100'}`
  ).all();
  return reply({
    members: results.map(({ data, createdBy, lat, lng, featured, ...r }) => {
      const firm = JSON.parse(data);
      return { ...r, featured: !!featured, isNewListing: r.firmStatus === 'pending' && createdBy != null, hasCoordinates: lat != null && lng != null, firm: { address: firm.address, phone: firm.phone, website: firm.website, tags: firm.tags } };
    }),
  });
}

export async function decideMember({ request, env, url, params, exec }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 1000);
  if (body.status !== 'approved' && body.status !== 'rejected') throw new HttpError(422, "status must be 'approved' or 'rejected'");
  const m = await env.DB.prepare(
    `SELECT m.id, m.status, m.firm_slug AS slug, u.email, f.name, f.city, f.status AS firmStatus, f.page_mode AS pageMode, f.lat, f.lng, f.data
     FROM firm_members m JOIN users u ON u.id = m.user_id JOIN firms f ON f.slug = m.firm_slug WHERE m.id = ?`
  ).bind(Number.parseInt(params.id, 10)).first();
  if (!m) throw new HttpError(404, 'Request not found');
  if (m.status === body.status) return reply({ ok: true, unchanged: true });

  const writes = [];
  const detail = { firm: m.slug, owner: m.email, from: m.status, to: body.status };
  if (body.status === 'approved') {
    if (m.firmStatus === 'pending') {
      // A brand-new listing needs a map position before it can go public.
      let lat = m.lat, lng = m.lng;
      if (body.lat != null || body.lng != null) { lat = Number(body.lat); lng = Number(body.lng); }
      if (!(lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52)) throw new HttpError(422, 'This new listing needs map coordinates (lat and lng, inside Canada) before it can go live.');
      const firm = { ...JSON.parse(m.data), lat, lng };
      writes.push(env.DB.prepare("UPDATE firms SET status = 'live', lat = ?, lng = ?, data = ?, updated_at = datetime('now') WHERE slug = ?").bind(lat, lng, JSON.stringify(firm), m.slug));
      detail.wentLive = true;
    }
    // The owner's edits only show on a database-built page; the hand-built page ignores them.
    if (body.switchPage === true && m.pageMode === 'static') {
      writes.push(env.DB.prepare("UPDATE firms SET page_mode = 'dynamic', updated_at = datetime('now') WHERE slug = ?").bind(m.slug));
      detail.pageMode = 'dynamic';
    }
  }
  writes.push(env.DB.prepare("UPDATE firm_members SET status = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?").bind(body.status, admin.id, m.id));
  await env.DB.batch(writes);
  await audit(env, admin, body.status === 'approved' ? 'member.approve' : 'member.reject', 'firm', m.slug, detail);
  if (m.status === 'pending' || body.status === 'approved') mailInBackground(env, exec, { to: m.email, ...decisionEmail(env.SITE_ORIGIN || url.origin, { firmName: m.name, approved: body.status === 'approved' }) });
  return reply({ ok: true });
}
