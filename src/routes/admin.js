import { json, readJson, clampInt, NO_STORE, HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { runBackup } from '../lib/backup.js';
import { getFeedInfo, updateFeedSettings, checkFeedNow } from '../lib/feeds.js';
import { listPayments, assignPayment, dismissPayment } from '../lib/stripe.js';
import { addImage, removeImage, listImages } from '../lib/images.js';
import { audit } from '../lib/audit.js';
import { searchSummary, runSearchConsole, inspectUrl, gscKey } from '../lib/gsc.js';
import { mailInBackground, decisionEmail } from '../lib/email.js';
import { applyFirmEdit, prepareNewFirm, insertFirm, CASE_TYPES } from '../lib/firm-edit.js';

export { CASE_TYPES };

const reply = (body, status = 200) => json(body, status, NO_STORE);

export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'];

export async function stats({ request, env }) {
  await requireAdmin(env, request);
  const [firms, posts, leads, week, pending, mailFail, backup, reports, payReview, payLive] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(featured) AS featured FROM firms WHERE status = 'live'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM blog_posts'),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_at > datetime('now','-7 days')"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_members WHERE status = 'pending'"),
    env.DB.prepare("SELECT COUNT(*) AS n, MAX(at) AS last FROM audit_log WHERE action IN ('mail.failed','login.email_failed') AND at > datetime('now','-1 day')"),
    env.DB.prepare("SELECT MAX(at) AS last FROM audit_log WHERE action = 'backup.ok'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE form = 'report-listing' AND status = 'new'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_subscriptions WHERE status = 'needs_review'"),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM firm_subscriptions WHERE status IN ('active','past_due')"),
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
    mailFailures24h: mailFail.results[0].n,
    lastBackupAt: backup.results[0].last,
    openReports: reports.results[0].n,
    paymentsToReview: payReview.results[0].n,
    featuredSubscriptions: payLive.results[0].n,
    featuredMonthlyCents: payLive.results[0].cents,
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
// Does the claimant's email address belong to the firm's own website? A work address on the firm's domain is
// the strongest cheap signal that the person really is the firm. 'free' = Gmail and similar (proves nothing).
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.ca', 'hotmail.com', 'hotmail.ca', 'outlook.com', 'live.com', 'live.ca', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rogers.com', 'bell.net', 'sympatico.ca', 'shaw.ca', 'telus.net', 'videotron.ca', 'cogeco.ca']);
export function emailMatch(email, website) {
  const domain = String(email).split('@')[1]?.toLowerCase();
  if (!domain) return 'mismatch';
  if (FREE_MAIL.has(domain)) return 'free';
  let host;
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'nosite'; }
  return domain === host || domain.endsWith('.' + host) || host.endsWith('.' + domain) ? 'match' : 'mismatch';
}

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
      return { ...r, emailMatch: emailMatch(r.email, firm.website), featured: !!featured, isNewListing: r.firmStatus === 'pending' && createdBy != null, hasCoordinates: lat != null && lng != null, firm: { address: firm.address, phone: firm.phone, website: firm.website, tags: firm.tags } };
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


// ---------------------------------------------------------------- undo an edit
// Restores the values an edit replaced (taken from the activity log). Featured and page style are never touched.
export async function revertEdit({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const id = Number.parseInt(params.id, 10);
  const entry = await env.DB.prepare("SELECT entity_id, detail FROM audit_log WHERE id = ? AND action = 'firm.update'").bind(id).first();
  if (!entry) throw new HttpError(404, 'Edit not found');
  const body = {};
  for (const [k, v] of Object.entries(JSON.parse(entry.detail || '{}'))) {
    if (k === 'featured' || k === 'pageMode') continue;
    if (k === 'hours') body.hours = v.from ?? null;
    else if (k === 'tags' || k === 'caseTypes') body[k] = v.from ?? [];
    else body[k] = v.from ?? '';
  }
  if (!Object.keys(body).length) throw new HttpError(422, 'There is nothing to undo in this entry');
  const { changed } = await applyFirmEdit(env, admin, entry.entity_id, body, { admin: true });
  await audit(env, admin, 'firm.revert', 'firm', entry.entity_id, { undoes: id, restored: Object.keys(body) });
  return reply({ ok: true, changed });
}

// ---------------------------------------------------------------- people (owner accounts)
export async function listUsers({ request, env, url }) {
  await requireAdmin(env, request);
  const q = (url.searchParams.get('q') || '').trim();
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.disabled, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
            (SELECT COUNT(*) FROM firm_members m WHERE m.user_id = u.id AND m.status = 'approved') AS firms
     FROM users u WHERE u.role = 'member' AND (? = '' OR u.email LIKE ? ESCAPE '\\') ORDER BY u.id DESC LIMIT 50`
  ).bind(q, like).all();
  return reply({ users: results.map((r) => ({ ...r, disabled: !!r.disabled })) });
}

// Disabling signs the person out everywhere at once and blocks every later sign-in.
export async function setUserDisabled({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 200);
  if (typeof body.disabled !== 'boolean') throw new HttpError(422, 'disabled must be true or false');
  const user = await env.DB.prepare("SELECT id, email FROM users WHERE id = ? AND role = 'member'").bind(Number.parseInt(params.id, 10)).first();
  if (!user) throw new HttpError(404, 'Person not found');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET disabled = ? WHERE id = ?').bind(body.disabled ? 1 : 0, user.id),
    ...(body.disabled ? [env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)] : []),
  ]);
  await audit(env, admin, body.disabled ? 'user.disable' : 'user.enable', 'user', user.id, { email: user.email });
  return reply({ ok: true });
}

export async function backupNow({ request, env }) {
  const admin = await requireAdmin(env, request);
  try {
    const r = await runBackup(env, admin);
    return reply({ ok: true, ...r });
  } catch (err) {
    console.error('backup failed', err);
    throw new HttpError(500, 'Backup failed: ' + String(err.message || err).slice(0, 200));
  }
}


// ---------------------------------------------------------------- blog cards (any firm)
export async function feedGet({ request, env, params }) {
  await requireAdmin(env, request);
  return reply(await getFeedInfo(env, params.slug));
}

export async function feedUpdate({ request, env, params, exec }) {
  const admin = await requireAdmin(env, request);
  await updateFeedSettings(env, admin, params.slug, await readJson(request, 1000), exec);
  return reply({ ok: true, ...(await getFeedInfo(env, params.slug)) });
}

export async function feedRefresh({ request, env, params, exec }) {
  const admin = await requireAdmin(env, request);
  const result = await checkFeedNow(env, admin, params.slug, { admin: true }, exec);
  return reply({ ok: true, result, ...(await getFeedInfo(env, params.slug)) });
}

// ---------------------------------------------------------------- pictures (any firm)
export async function imagesList({ request, env, params }) {
  await requireAdmin(env, request);
  return reply({ images: await listImages(env, params.slug) });
}

export async function imagesAdd({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  return reply({ ok: true, image: await addImage(env, admin, params.slug, request, { admin: true }) }, 201);
}

export async function imagesRemove({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  await removeImage(env, admin, params.slug, params.id);
  return reply({ ok: true });
}


// ---------------------------------------------------------------- Featured payments
export async function paymentsList({ request, env }) {
  await requireAdmin(env, request);
  return reply(await listPayments(env));
}

export async function paymentsAssign({ request, env, params, url, exec }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 500);
  const r = await assignPayment(env, admin, params.id, body.slug, exec, env.SITE_ORIGIN || url.origin);
  if (r.error) throw new HttpError(r.status, r.error);
  return reply({ ok: true });
}

export async function paymentsDismiss({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const r = await dismissPayment(env, admin, params.id);
  if (r.error) throw new HttpError(r.status, r.error);
  return reply({ ok: true });
}

// ---------------------------------------------------------------- LawDB News (which blogs appear, and for whom)
export async function newsGet({ request, env }) {
  await requireAdmin(env, request);
  const [{ results }, setting] = await Promise.all([
    env.DB.prepare(
      `SELECT ff.firm_slug AS slug, json_extract(f.data, '$.name') AS name, f.city, f.province, f.featured, ff.enabled, ff.status, ff.kind, ff.feed_url AS feedUrl,
              ff.last_checked_at AS lastCheckedAt, ff.last_error AS lastError, (SELECT COUNT(*) FROM firm_posts p WHERE p.firm_slug = ff.firm_slug) AS posts
       FROM firm_feeds ff JOIN firms f ON f.slug = ff.firm_slug ORDER BY f.featured DESC, name`
    ).all(),
    env.DB.prepare("SELECT value FROM site_settings WHERE key = 'news_featured_only'").first(),
  ]);
  return reply({ featuredOnly: setting?.value === '1', firms: results.map((r) => ({ ...r, featured: !!r.featured, enabled: !!r.enabled })) });
}

export async function newsSettings({ request, env }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 200);
  if (typeof body.featuredOnly !== 'boolean') throw new HttpError(422, 'featuredOnly must be true or false');
  await env.DB.prepare("INSERT INTO site_settings (key, value) VALUES ('news_featured_only', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(body.featuredOnly ? '1' : '0').run();
  await audit(env, admin, 'news.setting', 'site', 'news_featured_only', { featuredOnly: body.featuredOnly });
  return reply({ ok: true, featuredOnly: body.featuredOnly });
}

// ---------------------------------------------------------------- Google Search Console (sitemap and page checks)
export async function searchGet({ request, env }) {
  await requireAdmin(env, request);
  return reply(await searchSummary(env));
}

export async function searchRun({ request, env }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 200);
  const part = body.part ?? 'all';
  if (!['all', 'sitemap', 'inspect'].includes(part)) throw new HttpError(422, 'part must be all, sitemap or inspect');
  const r = await runSearchConsole(env, { parts: part === 'all' ? ['sitemap', 'inspect'] : [part], actor: admin });
  return reply({ ...r, summary: await searchSummary(env) });
}

export async function searchInspect({ request, env }) {
  await requireAdmin(env, request);
  const body = await readJson(request, 600);
  const site = new URL(env.SITE_ORIGIN || 'https://lawdb.ca').origin;
  let u;
  try { u = new URL(String(body.url || '').trim(), site + '/'); } catch { throw new HttpError(422, 'That is not a web address.'); }
  if (u.origin !== site) throw new HttpError(422, `Only pages on ${site} can be checked.`);
  if (!gscKey(env)) throw new HttpError(409, 'Google Search Console is not connected yet.');
  try {
    return reply({ page: await inspectUrl(env, u.toString()) });
  } catch (err) {
    throw new HttpError(502, String(err.message || err).slice(0, 300));
  }
}
