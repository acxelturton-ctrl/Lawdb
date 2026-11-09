// Firm-owner area: claim or create a listing, then (once an admin approves) edit it and see its enquiries.
// Every route needs a signed-in user; firm routes additionally need an APPROVED membership of that exact firm.

import { json, readJson, clampInt, NO_STORE, HttpError } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { applyFirmEdit, prepareNewFirm, insertFirm, str } from '../lib/firm-edit.js';
import { profileStrength } from '../lib/profile-strength.js';
import { getVerification, fullView, requestVerification, verifiedSlugs, LAW_SOCIETIES } from '../lib/verification.js';
import { geocode } from '../lib/geocode.js';
import { mailInBackground, newClaimEmail, verificationRequestEmail } from '../lib/email.js';
import { adminEmails } from '../lib/auth.js';
import { LEAD_STATUSES } from './admin.js';
import { isFeatured, leadSummary, leadsCsv } from '../lib/leads.js';
import { getFeedInfo, updateFeedSettings, checkFeedNow } from '../lib/feeds.js';
import { planInfo } from '../lib/stripe.js';
import { firmAnalytics, lockedSummary, analyticsCsv, RANGES } from '../lib/firm-analytics.js';
import { startTrial } from '../lib/trial.js';
import { MAX_LOCATIONS, mainOf, locationsOf, syncLocationFeatured } from '../lib/locations.js';
import { addImage, removeImage, listImages, imageInfo } from '../lib/images.js';
import { providerPicture } from '../lib/oauth.js';

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
    `SELECT m.id, m.firm_slug AS slug, m.status, m.created_at AS requestedAt, f.name, f.city, f.province, f.status AS firmStatus, f.featured AS featured,
       CASE WHEN m.status = 'approved' THEN (SELECT COUNT(*) FROM leads l WHERE l.firm_slug = m.firm_slug AND l.status = 'new' AND l.seen_at IS NULL) ELSE 0 END AS newLeads,
       t.ends_at AS trialEnds,
       (SELECT l.main_slug FROM firm_locations l WHERE l.location_slug = m.firm_slug) AS mainSlug,
       (SELECT COUNT(*) FROM firm_locations l WHERE l.main_slug = m.firm_slug) AS locationCount
     FROM firm_members m JOIN firms f ON f.slug = m.firm_slug LEFT JOIN firm_trials t ON t.firm_slug = m.firm_slug AND t.status = 'active'
     WHERE m.user_id = ? ORDER BY m.id DESC`
  ).bind(user.id).all();
  const prof = await profileOf(env, user.id);
  // The profile strength of each firm the person manages (a number and the next few things to do), for the dashboard.
  const approved = results.filter((m) => m.status === 'approved').map((m) => m.slug);
  const strength = new Map();
  if (approved.length) {
    const rows = (await env.DB.prepare(`SELECT slug, data, hours, about FROM firms WHERE slug IN (${approved.map(() => '?').join(',')})`).bind(...approved).all()).results;
    const verified = await verifiedSlugs(env, approved);
    for (const r of rows) { const s = profileStrength(JSON.parse(r.data), { about: r.about, hours: r.hours, verified: verified.has(r.slug) }); strength.set(r.slug, { score: s.score, todo: s.todo.slice(0, 3) }); }
  }
  return reply({ user: { email: user.email, role: user.role, ...prof }, memberships: results.map((m) => ({ ...m, featured: !!m.featured, ...(strength.has(m.slug) ? { strength: strength.get(m.slug) } : {}) })) });
}

// Your profile: shown to nobody else for now; it personalises your dashboard and emails.
export const KINDS = ['lawyer', 'staff', 'public', 'other'];
export const GOALS = ['find', 'clients', 'staff', 'follow', 'study', 'other'];
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const KIND_OF_GOAL = { find: 'public', clients: 'lawyer', staff: 'staff', follow: 'lawyer', study: 'other', other: 'other' };
const profileOf = async (env, id) => {
  const p = await env.DB.prepare('SELECT name, kind, city, province, job_title AS jobTitle, employer, goal, onboarded_at, avatar_at, cover_at, photo_offer_url AS offerUrl, photo_offer_provider AS offerProvider FROM users WHERE id = ?').bind(id).first();
  return { name: p?.name || '', kind: p?.kind || '', city: p?.city || '', province: p?.province || '', jobTitle: p?.jobTitle || '', employer: p?.employer || '', goal: p?.goal || '', onboarded: !!p?.onboarded_at, avatar: p?.avatar_at ? `/api/account/avatar?v=${p.avatar_at.replace(/\D/g, '')}` : '', cover: p?.cover_at ? `/api/account/cover?v=${p.cover_at.replace(/\D/g, '')}` : '',
    // a picture LinkedIn or Google sent at sign-in that the person has not answered yet
    photoOffer: p?.offerUrl && !p?.avatar_at ? { provider: p.offerProvider, name: p.offerProvider === 'linkedin' ? 'LinkedIn' : 'Google', url: p.offerUrl } : null };
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
  const row = await env.DB.prepare('SELECT rowid AS id, data, hours, about, status, updated_at, enquiry_email FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  const firm = { ...JSON.parse(row.data), about: row.about || '' };
  const verified = (await getVerification(env, params.slug))?.status === 'verified';
  return reply({ id: row.id, slug: params.slug, status: row.status, firm, hours: row.hours ? JSON.parse(row.hours) : null, updatedAt: row.updated_at, enquiryEmail: row.enquiry_email || '', strength: profileStrength(firm, { about: row.about, hours: row.hours, verified }) });
}

export async function updateFirm({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const body = await readJson(request, 20000);
  const { changed, firm } = await applyFirmEdit(env, user, params.slug, body, { admin: false });
  return reply({ ok: true, changed, firm });
}

export async function listLeads({ request, env, params, url }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const summary = await leadSummary(env, params.slug);
  if (!(await isFeatured(env, params.slug))) {
    // Basic firms still get every enquiry by email; reading and managing them here is a Featured benefit.
    const plan = await planInfo(env, user, params.slug);
    return reply({ locked: true, summary: { total: summary.total, new: summary.new, week: summary.week, month: summary.month }, upgradeUrl: plan.upgradeUrl, price: plan.price, leads: [], next: null });
  }
  if (url.searchParams.get('peek') === '1') return reply({ locked: false, summary, leads: [], next: null }); // plan and numbers only; nothing is marked as opened
  const limit = clampInt(url.searchParams.get('limit'), 30, 1, 100);
  const before = clampInt(url.searchParams.get('before'), 0, 0, Number.MAX_SAFE_INTEGER);
  const status = LEAD_STATUSES.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = ['firm_slug = ?'], args = [params.slug];
  if (status) { where.push('status = ?'); args.push(status); } else where.push("status != 'spam'");
  if (before) { where.push('id < ?'); args.push(before); }
  if (like) { where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')"); args.push(like, like, like, like); }
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, message, status, note, created_at, (seen_at IS NULL) AS unread FROM leads WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`
  ).bind(...args, limit + 1).all();
  const page = results.slice(0, limit);
  const unseen = page.filter((r) => r.unread).map((r) => r.id);
  if (unseen.length) await env.DB.prepare(`UPDATE leads SET seen_at = datetime('now') WHERE firm_slug = ? AND seen_at IS NULL AND id IN (${unseen.map(() => '?').join(',')})`).bind(params.slug, ...unseen).run();
  return reply({ locked: false, summary, leads: page.map((r) => ({ ...r, unread: !!r.unread })), next: results.length > limit ? page[page.length - 1].id : null, keptMonths: 12 });
}

export async function exportLeads({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  if (!(await isFeatured(env, params.slug))) throw new HttpError(403, 'Exporting enquiries is a Featured benefit.');
  const { results } = await env.DB.prepare("SELECT created_at, name, email, phone, message, status, note FROM leads WHERE firm_slug = ? AND status != 'spam' ORDER BY id DESC LIMIT 5000").bind(params.slug).all();
  await audit(env, user, 'lead.export', 'firm', params.slug, { rows: results.length });
  return new Response(leadsCsv(results), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="lawdb-enquiries-${params.slug}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export async function updateLead({ request, env, params }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 3000);
  const hasStatus = 'status' in body, hasNote = 'note' in body;
  if (!hasStatus && !hasNote) throw new HttpError(422, 'Nothing to change');
  if (hasStatus && !LEAD_STATUSES.includes(body.status)) throw new HttpError(422, `status must be one of: ${LEAD_STATUSES.join(', ')}`);
  let note = null;
  if (hasNote) {
    note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 1000) throw new HttpError(422, 'A note can be up to 1000 characters.');
    note = note || null;
  }
  const id = Number.parseInt(params.id, 10);
  const lead = await env.DB.prepare('SELECT firm_slug, status FROM leads WHERE id = ?').bind(id).first();
  if (!lead || !lead.firm_slug) throw new HttpError(404, 'Lead not found');
  await requireOwner(env, user, lead.firm_slug);
  if (!(await isFeatured(env, lead.firm_slug))) throw new HttpError(403, 'Managing enquiries here is a Featured benefit.');
  if (hasStatus) await env.DB.prepare('UPDATE leads SET status = ? WHERE id = ?').bind(body.status, id).run();
  if (hasNote) await env.DB.prepare('UPDATE leads SET note = ? WHERE id = ?').bind(note, id).run();
  await audit(env, user, hasStatus ? 'lead.status' : 'lead.note', 'lead', id, hasStatus ? { from: lead.status, to: body.status } : {});
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


// ---------------------------------------------------------------- analytics and the free month (own firm)
const rangeOf = (url) => { const n = clampInt(url.searchParams.get('days'), 30, 1, 90); return RANGES.includes(n) ? n : 30; };

// Featured firms (and firms in their free month) get the full dashboard. Basic firms get their own 30-day headline numbers and an invitation, so they
// can see what they are missing without seeing the detail.
export async function analytics({ request, env, params, url }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const plan = await planInfo(env, user, params.slug);
  const name = (await env.DB.prepare('SELECT name FROM firms WHERE slug = ?').bind(params.slug).first())?.name || params.slug;
  const planBits = { featured: plan.featured, trial: plan.trial, trialAvailable: plan.trialAvailable, trialDays: plan.trialDays, upgradeUrl: plan.upgradeUrl, price: plan.price, subscription: plan.subscription };
  if (!plan.featured) return reply({ locked: true, name, summary: await lockedSummary(env, params.slug), plan: planBits });
  const member = await env.DB.prepare("SELECT reports_off AS off FROM firm_members WHERE user_id = ? AND firm_slug = ? AND status = 'approved'").bind(user.id, params.slug).first();
  return reply({ locked: false, name, report: await firmAnalytics(env, params.slug, rangeOf(url)), reportsOff: !!member?.off, plan: planBits });
}

export async function analyticsCsvDownload({ request, env, params, url }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  if (!(await isFeatured(env, params.slug))) throw new HttpError(403, 'Downloading your analytics is a Featured benefit.');
  const firm = await env.DB.prepare('SELECT name FROM firms WHERE slug = ?').bind(params.slug).first();
  const csv = analyticsCsv(await firmAnalytics(env, params.slug, rangeOf(url)), firm?.name || params.slug);
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="lawdb-analytics-${params.slug}.csv"`, ...NO_STORE } });
}

// One click, no card: the firm is Featured for a month (see lib/trial.js for the rules).
export async function trialStart({ request, env, params, url, exec }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  await startTrial(env, { slug: params.slug, actor: user, source: 'owner', origin: env.SITE_ORIGIN || url.origin, exec });
  return reply({ ok: true, plan: await planInfo(env, user, params.slug) }, 201);
}

// Switch the weekly "your week on LawDB" email on or off, for this owner and this firm.
export async function reportsSwitch({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const body = await readJson(request, 200);
  if (typeof body.off !== 'boolean') throw new HttpError(422, 'off must be true or false');
  await env.DB.prepare("UPDATE firm_members SET reports_off = ? WHERE user_id = ? AND firm_slug = ? AND status = 'approved'").bind(body.off ? 1 : 0, user.id, params.slug).run();
  return reply({ ok: true, reportsOff: body.off });
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

async function mediaLimit(env, user) {
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_user_id = ? AND action IN ('avatar.set','cover.set') AND at > datetime('now','-1 hour')").bind(user.id).first();
  if (recent.n >= AVATAR_RULES.perHour) throw new HttpError(429, 'Too many picture changes this hour. Please try again later.');
}

// Checks the real file (type, size, shape) and keeps it as the person's photo or cover.
async function storeMedia(kind, env, user, body, detail = null) {
  const m = MEDIA[kind];
  const kb = Math.round(m.maxBytes / 1024);
  if (!body.length) throw new HttpError(422, 'No picture was sent.');
  if (body.length > m.maxBytes) throw new HttpError(413, `${m.label}s can be up to ${kb} KB. Try another picture.`);
  const info = imageInfo(body);
  if (!info) throw new HttpError(415, 'Please choose a JPEG, PNG or WebP picture.');
  if (info.width < m.minW || info.height < m.minH) throw new HttpError(422, `The picture is too small (at least ${m.minW} by ${m.minH} pixels).`);
  if (info.width > m.maxSide || info.height > m.maxSide) throw new HttpError(422, `The picture is too large. Each side can be at most ${m.maxSide} pixels.`);
  await env.IMAGES.put(`${m.prefix}/${user.id}`, body, { httpMetadata: { contentType: MIME[info.format] } });
  await env.DB.prepare(`UPDATE users SET ${m.type} = ?, ${m.at} = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?`).bind(MIME[info.format], user.id).run();
  await audit(env, user, `${kind}.set`, 'user', user.id, { bytes: body.length, width: info.width, height: info.height, ...detail });
}

async function mediaSet(kind, { request, env }) {
  const m = MEDIA[kind];
  const user = await requireUser(env, request);
  if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
  await mediaLimit(env, user);
  const kb = Math.round(m.maxBytes / 1024);
  const declared = Number(request.headers.get('content-length'));
  if (declared && declared > m.maxBytes + 1024) throw new HttpError(413, `${m.label}s can be up to ${kb} KB. The page shrinks it for you; try another picture.`);
  await storeMedia(kind, env, user, new Uint8Array(await request.arrayBuffer()));
  return reply({ ok: true, profile: await profileOf(env, user.id) });
}

// "Use your LinkedIn photo?" The person's answer to the offer made at sign-in (migration 0027). Yes: LawDB fetches the picture from the provider
// once, checks it like any upload and keeps its own copy as the profile photo (provider addresses expire, and we never hot-link). No: remembered, never asked again.
// LinkedIn does not hand cover photos, job titles or employers to ordinary sign-in apps, so only the profile photo is offered.
const PICTURE_MAX_BYTES = 3 * 1024 * 1024;
export async function photoOffer({ request, env }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 200);
  const row = await env.DB.prepare('SELECT photo_offer_url AS url, photo_offer_provider AS provider, avatar_at AS avatarAt FROM users WHERE id = ?').bind(user.id).first();
  if (!row?.url) throw new HttpError(404, 'There is no photo waiting for an answer.');
  const settle = (declined) => env.DB.prepare('UPDATE users SET photo_offer_url = NULL, photo_offer_provider = NULL, photo_offer_declined = ? WHERE id = ?').bind(declined ? 1 : 0, user.id).run();
  if (body.accept !== true) {
    await settle(true);
    await audit(env, user, 'photo_offer.declined', 'user', user.id, { provider: row.provider });
    return reply({ ok: true, profile: await profileOf(env, user.id) });
  }
  if (row.avatarAt) { await settle(false); return reply({ ok: true, profile: await profileOf(env, user.id) }); }
  if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
  await mediaLimit(env, user);
  const url = providerPicture(row.provider, row.url, env);
  const failed = async (why) => { await settle(false); throw new HttpError(422, `We could not copy that photo from ${row.provider === 'linkedin' ? 'LinkedIn' : 'Google'} (${why}). You can add a photo from your own files instead.`); };
  if (!url) return failed('the address is not valid');
  let bytes;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { accept: 'image/*', 'user-agent': 'LawDB/1.0 (+https://lawdb.ca)' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return failed(`it answered ${res.status}`);
    if (!providerPicture(row.provider, res.url, env)) return failed('it moved somewhere else');
    if (Number(res.headers.get('content-length') || 0) > PICTURE_MAX_BYTES) return failed('it is too big');
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > PICTURE_MAX_BYTES) return failed('it is too big');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return failed('it could not be reached');
  }
  try { await storeMedia('avatar', env, user, bytes, { from: row.provider }); } catch (err) { if (err instanceof HttpError) return failed(err.message.replace(/\.$/, '').toLowerCase()); throw err; }
  await settle(false);
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

// Verified by LawDB: what the firm sees (its own request and, once checked, what was checked), and asking for it. The admin makes the checks (admin.js).
export async function verificationGet({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const firm = await env.DB.prepare('SELECT province FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!firm) throw new HttpError(404, 'Firm not found');
  return reply(fullView(await getVerification(env, params.slug), firm.province));
}

export async function verificationRequest({ request, env, params, url, exec }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const body = await readJson(request, 1000);
  const firm = await env.DB.prepare('SELECT name, province, featured FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!firm) throw new HttpError(404, 'Firm not found');
  const v = await requestVerification(env, user, params.slug, body, { province: firm.province, featured: !!firm.featured });
  const to = [...adminEmails(env)];
  if (to.length) mailInBackground(env, exec, { to, ...verificationRequestEmail(env.SITE_ORIGIN || url.origin, { firmName: firm.name, slug: params.slug, society: LAW_SOCIETIES[v.lawSociety].name, registrant: v.registrant, email: user.email }) });
  return reply(fullView(await getVerification(env, params.slug), firm.province), 201);
}

// ---------------------------------------------------------------- office pages (one Featured plan, a page for every office)
// What an owner sees in their Locations card: the firm's office pages, and whether another can be added now.
async function locationsState(env, slug) {
  const firm = await env.DB.prepare('SELECT name, status, featured FROM firms WHERE slug = ?').bind(slug).first();
  if (!firm) throw new HttpError(404, 'Firm not found');
  const ofMain = await mainOf(env, slug);
  if (ofMain) return { isLocation: true, main: { slug: ofMain.slug, name: ofMain.name }, items: [], max: MAX_LOCATIONS, canAdd: false, reason: `This page is an office of ${ofMain.name}. Add offices from ${ofMain.name}.` };
  const items = await locationsOf(env, slug);
  let reason = null;
  if (firm.status !== 'live') reason = 'Office pages can be added once this listing is live.';
  else if (!firm.featured) reason = 'A page for every office is included with Featured.';
  else if (items.length >= MAX_LOCATIONS) reason = `A firm can have up to ${MAX_LOCATIONS} office pages here. Write to info@lawdb.ca if you need more.`;
  return { isLocation: false, items, max: MAX_LOCATIONS, canAdd: !reason, reason, featured: !!firm.featured };
}

export async function locationsGet({ request, env, params }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  return reply(await locationsState(env, params.slug));
}

// A new office page. It is a listing of its own (its own address, phone and website, in its own city), hidden until an admin approves it, and it is Featured
// whenever the main listing is. Only a Featured firm can add one.
export async function locationAdd({ request, env, params, url, exec }) {
  const user = await requireUser(env, request);
  await requireOwner(env, user, params.slug);
  const state = await locationsState(env, params.slug);
  if (!state.canAdd) throw new HttpError(409, state.reason);
  const body = await readJson(request, 8000);
  delete body.lat; delete body.lng;
  await assertRoomForRequest(env, user);

  const main = await env.DB.prepare('SELECT name, data FROM firms WHERE slug = ?').bind(params.slug).first();
  const mainFirm = JSON.parse(main.data);
  const input = {
    name: typeof body.name === 'string' && body.name.trim() ? str(body.name, 2, 200) : main.name,
    city: body.city, province: body.province, address: body.address, phone: body.phone || '',
    website: body.website || mainFirm.website || '',
    tags: mainFirm.tags || [], caseTypes: mainFirm.caseTypes || [],
  };
  if (!String(input.address || '').trim()) throw new HttpError(422, 'The office needs a street address.');
  const dupe = await env.DB.prepare("SELECT slug FROM firms WHERE name = ? COLLATE NOCASE AND city = ? COLLATE NOCASE").bind(String(input.name).trim(), String(input.city || '').trim()).first();
  if (dupe) throw new HttpError(409, 'A page for this firm in that city already exists.');
  const probe = await prepareNewFirm(env, input, { checkText: true });
  const coords = await geocode(env, { address: probe.firm.address, city: probe.firm.city, province: probe.firm.province });
  const built = coords ? { ...probe, firm: { ...probe.firm, lat: coords.lat, lng: coords.lng } } : probe;
  await insertFirm(env, built, { status: 'pending', createdBy: user.id });
  const slug = built.firm.slug;
  const mine = await env.DB.prepare('SELECT contact_name, job_title FROM firm_members WHERE user_id = ? AND firm_slug = ?').bind(user.id, params.slug).first();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO firm_locations (location_slug, main_slug, created_by) VALUES (?, ?, ?)').bind(slug, params.slug, user.id),
    env.DB.prepare("INSERT INTO firm_members (user_id, firm_slug, contact_name, job_title, message, terms_accepted_at) VALUES (?,?,?,?,?,datetime('now'))")
      .bind(user.id, slug, mine?.contact_name || 'Owner', mine?.job_title || null, `Office page of ${main.name} (${params.slug})`),
  ]);
  await syncLocationFeatured(env, params.slug, user, 'office page added');
  await audit(env, user, 'member.add_location', 'firm', slug, { main: params.slug, name: built.firm.name, city: built.firm.city });
  notifyAdmins(env, exec, env.SITE_ORIGIN || url.origin, { email: user.email, contactName: mine?.contact_name || 'Owner', jobTitle: mine?.job_title || '', message: `Office page of ${main.name}`, firmName: built.firm.name, city: built.firm.city, isNew: true });
  return reply({ ok: true, slug, status: 'pending' }, 201);
}
