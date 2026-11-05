// Verified by LawDB: a check that a firm's lawyer is on the province's public law society directory, that the person managing the profile is who they say
// they are, and that the office details match. The admin makes the checks by hand (looking the lawyer up in the directory) and records them here.
//
// What the public sees: "Verified by LawDB", the date, which checks were made, and a link to the law society's own directory so a visitor can look for
// themselves. What the public never sees: the name or number the firm gave us. What it does NOT say: that the lawyer is in good standing today, has no
// discipline history, or is any good. It is not an endorsement, and the page says so.
//
// We only LINK to the directories. Several of them say their data is not for commercial use, so nothing is copied from them.
import { HttpError } from './http.js';
import { audit } from './audit.js';

// The province's law society and the page of its public directory (checked against each society's own website).
export const LAW_SOCIETIES = {
  ON: { name: 'Law Society of Ontario', directory: 'https://lso.ca/public-resources/finding-a-lawyer-or-paralegal/lawyer-and-paralegal-directory' },
  QC: { name: 'Barreau du Québec', directory: 'https://www.barreau.qc.ca/en/find-a-lawyer/' },
  BC: { name: 'Law Society of British Columbia', directory: 'https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm' },
  AB: { name: 'Law Society of Alberta', directory: 'https://www.lawsociety.ab.ca/public/findalawyer/' },
  MB: { name: 'Law Society of Manitoba', directory: 'https://lawsociety.mb.ca/for-the-public/finding-a-lawyer/lawyer-lookup/' },
};

// Verification is free for every firm. Set this to true to make it a Featured benefit instead (a Basic owner could then no longer ask for it;
// verifications already made stay).
export const VERIFICATION_REQUIRES_FEATURED = false;

const society = (code) => ({ code, ...LAW_SOCIETIES[code] });
const SOCIETIES = Object.entries(LAW_SOCIETIES).map(([code, s]) => ({ code, name: s.name }));
const NAME = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .,'’-]{1,79}$/;
const REF = /^[A-Za-z0-9 -]{1,30}$/;

// What a firm sends when it asks: the law society (the firm's province by default), the registered lawyer's name, and optionally their number.
export function cleanRequest(body, province) {
  const code = String(body.lawSociety || province || '').toUpperCase();
  if (!Object.hasOwn(LAW_SOCIETIES, code)) throw new HttpError(422, `lawSociety must be one of: ${Object.keys(LAW_SOCIETIES).join(', ')}`);
  const registrant = typeof body.registrant === 'string' ? body.registrant.replace(/\s+/g, ' ').trim() : '';
  if (!NAME.test(registrant)) throw new HttpError(422, "Give the name of a lawyer at the firm, as the law society lists them (letters only, up to 80 characters).");
  const ref = typeof body.registrationRef === 'string' ? body.registrationRef.trim() : '';
  if (ref && !REF.test(ref)) throw new HttpError(422, 'The law society number can have letters, digits, spaces and dashes, up to 30 characters.');
  return { lawSociety: code, registrant, registrationRef: ref || null };
}

export async function getVerification(env, slug) {
  return env.DB.prepare('SELECT * FROM firm_verifications WHERE firm_slug = ?').bind(slug).first();
}

const checks = (r) => ({ identity: !!r.checked_identity, registration: !!r.checked_registration, office: !!r.checked_office });

// What the firm's owner and the admin see: everything, including what the firm gave us.
export function fullView(row, province) {
  if (!row) return { status: 'none', lawSociety: society(Object.hasOwn(LAW_SOCIETIES, province) ? province : 'ON'), requiresFeatured: VERIFICATION_REQUIRES_FEATURED, societies: SOCIETIES };
  return {
    status: row.status, lawSociety: society(row.law_society), registrant: row.registrant_name, registrationRef: row.registration_ref || '',
    requestedAt: row.requested_at, verifiedAt: row.verified_at || null, checked: checks(row), note: row.note || '', requiresFeatured: VERIFICATION_REQUIRES_FEATURED, societies: SOCIETIES,
  };
}

// What every visitor sees, and only for a verified firm: the date, what was checked and the law society. Never the name or number.
export function publicView(row) {
  if (!row || row.status !== 'verified') return null;
  const c = checks(row);
  return { at: String(row.verified_at || '').slice(0, 10), society: society(row.law_society), checked: c };
}

// Which of these firms are verified (a set of slugs), for the dashboards.
export async function verifiedSlugs(env, slugs) {
  if (!slugs.length) return new Set();
  const { results } = await env.DB.prepare(`SELECT firm_slug FROM firm_verifications WHERE status = 'verified' AND firm_slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all();
  return new Set(results.map((r) => r.firm_slug));
}

// The firm asks (or changes what it gave us before it is checked).
export async function requestVerification(env, user, slug, body, { province, featured }) {
  if (VERIFICATION_REQUIRES_FEATURED && !featured) throw new HttpError(403, 'Verification is a Featured benefit. Upgrade to Featured from your dashboard.');
  const existing = await getVerification(env, slug);
  if (existing && existing.status === 'verified') throw new HttpError(409, 'This firm is already verified.');
  const v = cleanRequest(body, province);
  await env.DB.prepare(
    `INSERT INTO firm_verifications (firm_slug, status, law_society, registrant_name, registration_ref, requested_by) VALUES (?, 'requested', ?, ?, ?, ?)
     ON CONFLICT (firm_slug) DO UPDATE SET law_society = excluded.law_society, registrant_name = excluded.registrant_name, registration_ref = excluded.registration_ref, requested_by = excluded.requested_by`
  ).bind(slug, v.lawSociety, v.registrant, v.registrationRef, user.id).run();
  await audit(env, user, 'firm.verification_request', 'firm', slug, { lawSociety: v.lawSociety });
  return v;
}

// The admin records the checks. The registration check is the heart of it, so it is required; the lawyer looked up is named so the record shows who was checked.
export async function markVerified(env, admin, slug, body) {
  const c = body.checks && typeof body.checks === 'object' ? body.checks : {};
  for (const k of Object.keys(c)) if (!['identity', 'registration', 'office'].includes(k) || typeof c[k] !== 'boolean') throw new HttpError(422, 'checks: identity, registration and office, each true or false');
  if (c.registration !== true) throw new HttpError(422, "Look the lawyer up in the law society's directory and tick that you found them before verifying.");
  const existing = await getVerification(env, slug);
  const province = (await env.DB.prepare('SELECT province FROM firms WHERE slug = ?').bind(slug).first())?.province;
  const v = cleanRequest({ lawSociety: body.lawSociety || existing?.law_society, registrant: body.registrant ?? existing?.registrant_name, registrationRef: body.registrationRef ?? existing?.registration_ref ?? '' }, province);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  await env.DB.prepare(
    `INSERT INTO firm_verifications (firm_slug, status, law_society, registrant_name, registration_ref, checked_identity, checked_registration, checked_office, verified_by, verified_at, note)
     VALUES (?, 'verified', ?, ?, ?, ?, 1, ?, ?, datetime('now'), ?)
     ON CONFLICT (firm_slug) DO UPDATE SET status = 'verified', law_society = excluded.law_society, registrant_name = excluded.registrant_name, registration_ref = excluded.registration_ref,
       checked_identity = excluded.checked_identity, checked_registration = 1, checked_office = excluded.checked_office, verified_by = excluded.verified_by, verified_at = datetime('now'), note = excluded.note`
  ).bind(slug, v.lawSociety, v.registrant, v.registrationRef, c.identity ? 1 : 0, c.office ? 1 : 0, admin.id, note || null).run();
  await audit(env, admin, 'firm.verify', 'firm', slug, { lawSociety: v.lawSociety, checked: { identity: !!c.identity, registration: true, office: !!c.office } });
  return v;
}

export async function removeVerification(env, admin, slug, reason) {
  const existing = await getVerification(env, slug);
  if (!existing) throw new HttpError(404, 'This firm has no verification or request.');
  await env.DB.prepare('DELETE FROM firm_verifications WHERE firm_slug = ?').bind(slug).run();
  await audit(env, admin, existing.status === 'verified' ? 'firm.unverify' : 'firm.verification_decline', 'firm', slug, { reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : '' });
}

// Requests waiting for the admin, oldest first.
export async function pendingRequests(env, limit = 10) {
  const [list, count] = await env.DB.batch([
    env.DB.prepare(`SELECT v.firm_slug AS slug, f.name, f.city, f.province, v.law_society AS lawSociety, v.requested_at AS requestedAt FROM firm_verifications v JOIN firms f ON f.slug = v.firm_slug WHERE v.status = 'requested' ORDER BY v.requested_at, v.firm_slug LIMIT ?`).bind(limit),
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_verifications WHERE status = 'requested'"),
  ]);
  return { count: count.results[0].n, list: list.results };
}
