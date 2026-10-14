// Firm-owner area: claim or create a listing, then (once an admin approves) edit it and see its enquiries.
// Every route needs a signed-in user; firm routes additionally need an APPROVED membership of that exact firm.

import { json, readJson, clampInt, NO_STORE, HttpError } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { applyFirmEdit, prepareNewFirm, insertFirm, str } from '../lib/firm-edit.js';
import { geocode } from '../lib/geocode.js';
import { mailInBackground, newClaimEmail } from '../lib/email.js';
import { adminEmails } from '../lib/auth.js';
import { LEAD_STATUSES } from './admin.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);

const MAX_PENDING = 3;
const MAX_MEMBERSHIPS = 10;

async function requireOwner(env, user, slug) {
  const m = await env.DB.prepare("SELECT 1 FROM firm_members WHERE user_id = ? AND firm_slug = ? AND status = 'approved'").bind(user.id, slug).first();
  if (!m) throw new HttpError(403, 'You do not manage this firm');
}

function notifyAdmins(env, exec, origin, details) {
  const to = [...adminEmails(env)];
  if (to.length) mailInBackground(env, exec, { to, ...newClaimEmail(origin, details) });
}

export async function me({ request, env }) {
  const user = await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.firm_slug AS slug, m.status, m.created_at AS requestedAt, f.name, f.city, f.province, f.status AS firmStatus, f.page_mode AS pageMode
     FROM firm_members m JOIN firms f ON f.slug = m.firm_slug WHERE m.user_id = ? ORDER BY m.id DESC`
  ).bind(user.id).all();
  return reply({ user: { email: user.email, role: user.role }, memberships: results });
}

// Find a listing to claim. Only live listings, and only the fields a stranger needs to recognise their firm.
export async function search({ request, env, url }) {
  await requireUser(env, request);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return reply({ firms: [] });
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { results } = await env.DB.prepare(
    `SELECT f.slug, f.name, f.city, f.province,
       EXISTS (SELECT 1 FROM firm_members m WHERE m.firm_slug = f.slug AND m.status = 'approved') AS managed
     FROM firms f WHERE f.status = 'live' AND (f.name LIKE ? ESCAPE '\\' OR f.city LIKE ? ESCAPE '\\') ORDER BY f.name LIMIT 10`
  ).bind(like, like).all();
  return reply({ firms: results.map((r) => ({ ...r, managed: !!r.managed })) });
}

function contactFrom(body) {
  return {
    contactName: str(body.contactName, 2, 100),
    jobTitle: 'jobTitle' in body ? str(body.jobTitle, 0, 100) : '',
    message: 'message' in body ? str(body.message, 0, 1000) : '',
  };
}

async function assertRoomForRequest(env, user) {
  const c = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending FROM firm_members WHERE user_id = ?").bind(user.id).first();
  if ((c.pending || 0) >= MAX_PENDING) throw new HttpError(429, `You already have ${MAX_PENDING} requests waiting for approval. Please wait for those first.`);
  if (c.total >= MAX_MEMBERSHIPS) throw new HttpError(429, 'You have reached the limit of firms per account. Contact info@lawdb.ca.');
}

export async function claim({ request, env, url, exec }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 4000);
  const contact = contactFrom(body);
  const firm = await env.DB.prepare("SELECT slug, name, city FROM firms WHERE slug = ? AND status = 'live'").bind(String(body.slug || '')).first();
  if (!firm) throw new HttpError(404, 'Firm not found');
  const existing = await env.DB.prepare('SELECT status FROM firm_members WHERE user_id = ? AND firm_slug = ?').bind(user.id, firm.slug).first();
  if (existing) {
    throw new HttpError(409, existing.status === 'approved' ? 'You already manage this firm.' : existing.status === 'pending' ? 'Your request is already waiting for approval.' : 'Your earlier request was declined. Contact info@lawdb.ca if that was a mistake.');
  }
  await assertRoomForRequest(env, user);
  await env.DB.prepare('INSERT INTO firm_members (user_id, firm_slug, contact_name, job_title, message) VALUES (?,?,?,?,?)')
    .bind(user.id, firm.slug, contact.contactName, contact.jobTitle || null, contact.message || null).run();
  await audit(env, user, 'member.claim', 'firm', firm.slug, { contactName: contact.contactName });
  notifyAdmins(env, exec, env.SITE_ORIGIN || url.origin, { email: user.email, ...contact, firmName: firm.name, city: firm.city, isNew: false });
  return reply({ ok: true, slug: firm.slug, status: 'pending' }, 201);
}

// A firm that is not listed yet. It stays hidden from the public until an admin approves it.
export async function createListing({ request, env, url, exec }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 20000);
  const contact = contactFrom(body);
  delete body.lat; delete body.lng; // owners do not supply coordinates; they are looked up from the address
  await assertRoomForRequest(env, user);

  const dupe = await env.DB.prepare("SELECT slug FROM firms WHERE name = ? COLLATE NOCASE AND city = ? COLLATE NOCASE AND status = 'live'")
    .bind(String(body.name || '').trim(), String(body.city || '').trim()).first();
  if (dupe) return reply({ error: 'This firm is already listed. Search for it and claim it instead.', slug: dupe.slug }, 409);

  const probe = await prepareNewFirm(env, body, {}); // validates everything first
  const coords = await geocode(env, { address: probe.firm.address, city: probe.firm.city, province: probe.firm.province });
  const built = coords ? { ...probe, firm: { ...probe.firm, lat: coords.lat, lng: coords.lng } } : probe;
  await insertFirm(env, built, { status: 'pending', createdBy: user.id });
  await env.DB.prepare('INSERT INTO firm_members (user_id, firm_slug, contact_name, job_title, message) VALUES (?,?,?,?,?)')
    .bind(user.id, built.firm.slug, contact.contactName, contact.jobTitle || null, contact.message || null).run();
  await audit(env, user, 'member.create_listing', 'firm', built.firm.slug, { name: built.firm.name, city: built.firm.city });
  notifyAdmins(env, exec, env.SITE_ORIGIN || url.origin, { email: user.email, ...contact, firmName: built.firm.name, city: built.firm.city, isNew: true });
  return reply({ ok: true, slug: built.firm.slug, status: 'pending' }, 201);
}

export async function getFirm({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const row = await env.DB.prepare('SELECT data, hours, page_mode, about FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  return reply({ firm: { ...JSON.parse(row.data), about: row.about || '' }, hours: row.hours ? JSON.parse(row.hours) : null, pageMode: row.page_mode });
}

export async function updateFirm({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const body = await readJson(request, 10000);
  const { changed, firm, pageMode } = await applyFirmEdit(env, user, params.slug, body, { admin: false });
  return reply({ ok: true, changed, firm, pageMode });
}

export async function listLeads({ request, env, params, url }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const limit = clampInt(url.searchParams.get('limit'), 30, 1, 100);
  const before = clampInt(url.searchParams.get('before'), 0, 0, Number.MAX_SAFE_INTEGER);
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, message, status, created_at FROM leads WHERE firm_slug = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`
  ).bind(...[params.slug, ...(before ? [before] : []), limit + 1]).all();
  const page = results.slice(0, limit);
  return reply({ leads: page, next: results.length > limit ? page[page.length - 1].id : null });
}

export async function updateLead({ request, env, params }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 1000);
  if (!LEAD_STATUSES.includes(body.status)) throw new HttpError(422, `status must be one of: ${LEAD_STATUSES.join(', ')}`);
  const id = Number.parseInt(params.id, 10);
  const lead = await env.DB.prepare('SELECT firm_slug, status FROM leads WHERE id = ?').bind(id).first();
  if (!lead || !lead.firm_slug) throw new HttpError(404, 'Lead not found');
  await requireOwner(env, user, lead.firm_slug);
  await env.DB.prepare('UPDATE leads SET status = ? WHERE id = ?').bind(body.status, id).run();
  await audit(env, user, 'lead.status', 'lead', id, { from: lead.status, to: body.status });
  return reply({ ok: true });
}
