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
import { getFeedInfo, updateFeedSettings, checkFeedNow } from '../lib/feeds.js';
import { planInfo } from '../lib/stripe.js';
import { addImage, removeImage, listImages, imageInfo } from '../lib/images.js';

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
    `SELECT m.id, m.firm_slug AS slug, m.status, m.created_at AS requestedAt, f.name, f.city, f.province, f.status AS firmStatus, f.page_mode AS pageMode, f.featured AS featured
     FROM firm_members m JOIN firms f ON f.slug = m.firm_slug WHERE m.user_id = ? ORDER BY m.id DESC`
  ).bind(user.id).all();
  const prof = await profileOf(env, user.id);
  return reply({ user: { email: user.email, role: user.role, ...prof }, memberships: results.map((m) => ({ ...m, featured: !!m.featured })) });
}

// Your profile: shown to nobody else for now; it personalises your dashboard and emails.
export const KINDS = ['lawyer', 'staff', 'public', 'other'];
export const GOALS = ['find', 'clients', 'staff', 'follow', 'study', 'other'];
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const KIND_OF_GOAL = { find: 'public', clients: 'lawyer', staff: 'staff', follow: 'lawyer', study: 'other', other: 'other' };
const profileOf = async (env, id) => {
  const p = await env.DB.prepare('SELECT name, kind, city, province, job_title AS jobTitle, employer, goal, onboarded_at, avatar_at, cover_at FROM users WHERE id = ?').bind(id).first();
  return { name: p?.name || '', kind: p?.kind || '', city: p?.city || '', province: p?.province || '', jobTitle: p?.jobTitle || '', employer: p?.employer || '', goal: p?.goal || '', onboarded: !!p?.onboarded_at, avatar: p?.avatar_at ? `/api/account/avatar?v=${p.avatar_at.replace(/\D/g, '')}` : '', cover: p?.cover_at ? `/api/account/cover?v=${p.cover_at.replace(/\D/g, '')}` : '' };
};
const plain = (v, label, max) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length > max || /[<>]/.test(t)) throw new HttpError(422, `${label}: use up to ${max} characters, without < or >.`);
  return t || null;
};
export async function updateProfile({ request, env }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 2000);
  const sets = [];
  const args = [];
  const put = (col, val) => { sets.push(`${col} = ?`); args.push(val); };
  if ('name' in body) put('name', plain(body.name, 'Name', 80));
  if ('city' in body) put('city', plain(body.city, 'Location', 80));
  if ('province' in body) {
    if (body.province !== '' && !PROVINCES.includes(body.province)) throw new HttpError(422, 'Choose a province or territory from the list.');
    put('province', body.province || null);
  }
  if ('jobTitle' in body) put('job_title', plain(body.jobTitle, 'Job title', 80));
  if ('employer' in body) put('employer', plain(body.employer, 'Law firm or employer', 100));
  if ('goal' in body) {
    if (body.goal !== '' && !GOALS.includes(body.goal)) throw new HttpError(422, 'Choose one of the options.');
    put('goal', body.goal || null);
    if (body.goal && !('kind' in body)) put('kind', KIND_OF_GOAL[body.goal]);
  }
  if ('kind' in body) {
    if (body.kind !== '' && !KINDS.includes(body.kind)) throw new HttpError(422, 'Choose one of the options.');
    put('kind', body.kind || null);
  }
  if (body.complete === true) sets.push("onboarded_at = COALESCE(onboarded_at, datetime('now'))");
  if (!sets.length) throw new HttpError(422, 'Send something to save.');
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args, user.id).run();
  return reply({ ok: true, profile: await profileOf(env, user.id) });
}

// Places people can pick in the welcome steps: the cities LawDB lists, with how many firms each has.
export async function cities({ env }) {
  const { results } = await env.DB.prepare("SELECT city, province, COUNT(*) AS firms FROM firms WHERE status = 'live' GROUP BY city, province ORDER BY firms DESC, city").all();
  return json({ cities: results }, 200, { 'cache-control': 'public, max-age=3600' });
}

// Find a listing to claim. Only live listings, and only the fields a stranger needs to recognise their firm.
export async function search({ request, env, url }) {
  await requireUser(env, request);
  const q = (url.searchParams.get('q') || '').trim();
  const bySlug = (url.searchParams.get('slug') || '').trim();
  if (bySlug) { // a "Claim this listing" button on a firm page opens that exact firm
    const row = await env.DB.prepare(
      `SELECT f.slug, f.name, f.city, f.province, EXISTS (SELECT 1 FROM firm_members m WHERE m.firm_slug = f.slug AND m.status = 'approved') AS managed FROM firms f WHERE f.status = 'live' AND f.slug = ?`
    ).bind(bySlug).first();
    return reply({ firms: row ? [{ ...row, managed: !!row.managed }] : [] });
  }
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
  // Everyone who manages a firm confirms they are authorised and accept the firm terms; the time is recorded.
  if (body.acceptTerms !== true) throw new HttpError(422, 'Please confirm that you are authorised to manage this firm and accept the Terms for firms.');
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
  await env.DB.prepare("INSERT INTO firm_members (user_id, firm_slug, contact_name, job_title, message, terms_accepted_at) VALUES (?,?,?,?,?,datetime('now'))")
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

  const probe = await prepareNewFirm(env, body, { checkText: true }); // validates everything first
  const coords = await geocode(env, { address: probe.firm.address, city: probe.firm.city, province: probe.firm.province });
  const built = coords ? { ...probe, firm: { ...probe.firm, lat: coords.lat, lng: coords.lng } } : probe;
  await insertFirm(env, built, { status: 'pending', createdBy: user.id });
  await env.DB.prepare("INSERT INTO firm_members (user_id, firm_slug, contact_name, job_title, message, terms_accepted_at) VALUES (?,?,?,?,?,datetime('now'))")
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


// ---------------------------------------------------------------- blog cards (own firm)
export async function feedGet({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  return reply(await getFeedInfo(env, params.slug));
}

export async function feedUpdate({ request, env, params, exec }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  await updateFeedSettings(env, user, params.slug, await readJson(request, 1000), exec);
  return reply({ ok: true, ...(await getFeedInfo(env, params.slug)) });
}

export async function feedRefresh({ request, env, params, exec }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const result = await checkFeedNow(env, user, params.slug, { admin: false }, exec);
  return reply({ ok: true, result, ...(await getFeedInfo(env, params.slug)) });
}

// ---------------------------------------------------------------- pictures
export async function imagesList({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  return reply({ images: await listImages(env, params.slug) });
}

export async function imagesAdd({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  return reply({ ok: true, image: await addImage(env, user, params.slug, request, { admin: false }) }, 201);
}

export async function imagesRemove({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  await removeImage(env, user, params.slug, params.id);
  return reply({ ok: true });
}


// ---------------------------------------------------------------- plan and billing (own firm)
export async function planGet({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  return reply(await planInfo(env, user, params.slug));
}


// ---------------------------------------------------------------- profile photo and cover
// One small picture per person for each, private to them for now (nothing public shows members). The browser crops and shrinks first
// (a square for the photo, 3:1 for the cover); the server still checks the real file type from its first bytes, accepts only JPEG, PNG or WebP,
// and caps size and shape.
const MEDIA = {
  avatar: { prefix: 'avatars', type: 'avatar_type', at: 'avatar_at', maxBytes: 600 * 1024, minW: 64, minH: 64, maxSide: 2000, label: 'Profile photo' },
  cover: { prefix: 'covers', type: 'cover_type', at: 'cover_at', maxBytes: 900 * 1024, minW: 600, minH: 150, maxSide: 3000, label: 'Cover photo' },
};
export const AVATAR_RULES = { perHour: 10 };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

async function mediaSet(kind, { request, env }) {
  const m = MEDIA[kind];
  const user = await requireUser(env, request);
  if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_user_id = ? AND action IN ('avatar.set','cover.set') AND at > datetime('now','-1 hour')").bind(user.id).first();
  if (recent.n >= AVATAR_RULES.perHour) throw new HttpError(429, 'Too many picture changes this hour. Please try again later.');
  const kb = Math.round(m.maxBytes / 1024);
  const declared = Number(request.headers.get('content-length'));
  if (declared && declared > m.maxBytes + 1024) throw new HttpError(413, `${m.label}s can be up to ${kb} KB. The page shrinks it for you; try another picture.`);
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length) throw new HttpError(422, 'No picture was sent.');
  if (body.length > m.maxBytes) throw new HttpError(413, `${m.label}s can be up to ${kb} KB. Try another picture.`);
  const info = imageInfo(body);
  if (!info) throw new HttpError(415, 'Please choose a JPEG, PNG or WebP picture.');
  if (info.width < m.minW || info.height < m.minH) throw new HttpError(422, `The picture is too small (at least ${m.minW} by ${m.minH} pixels).`);
  if (info.width > m.maxSide || info.height > m.maxSide) throw new HttpError(422, `The picture is too large. Each side can be at most ${m.maxSide} pixels.`);
  await env.IMAGES.put(`${m.prefix}/${user.id}`, body, { httpMetadata: { contentType: MIME[info.format] } });
  await env.DB.prepare(`UPDATE users SET ${m.type} = ?, ${m.at} = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?`).bind(MIME[info.format], user.id).run();
  await audit(env, user, `${kind}.set`, 'user', user.id, { bytes: body.length, width: info.width, height: info.height });
  return reply({ ok: true, profile: await profileOf(env, user.id) });
}

async function mediaGet(kind, { request, env }) {
  const m = MEDIA[kind];
  const user = await requireUser(env, request);
  const row = await env.DB.prepare(`SELECT ${m.type} AS type FROM users WHERE id = ? AND ${m.at} IS NOT NULL`).bind(user.id).first();
  const obj = row && env.IMAGES ? await env.IMAGES.get(`${m.prefix}/${user.id}`) : null;
  if (!obj) return new Response('Not found', { status: 404, headers: NO_STORE });
  return new Response(obj.body, { headers: {
    'content-type': row.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'cross-origin-resource-policy': 'same-origin',
  } });
}

async function mediaRemove(kind, { request, env }) {
  const m = MEDIA[kind];
  const user = await requireUser(env, request);
  await env.DB.prepare(`UPDATE users SET ${m.type} = NULL, ${m.at} = NULL WHERE id = ?`).bind(user.id).run();
  if (env.IMAGES) await env.IMAGES.delete(`${m.prefix}/${user.id}`).catch((err) => console.error(`${kind} delete failed`, user.id, err));
  await audit(env, user, `${kind}.remove`, 'user', user.id, null);
  return reply({ ok: true, profile: await profileOf(env, user.id) });
}

export const avatarSet = (ctx) => mediaSet('avatar', ctx);
export const avatarGet = (ctx) => mediaGet('avatar', ctx);
export const avatarRemove = (ctx) => mediaRemove('avatar', ctx);
export const coverSet = (ctx) => mediaSet('cover', ctx);
export const coverGet = (ctx) => mediaGet('cover', ctx);
export const coverRemove = (ctx) => mediaRemove('cover', ctx);
