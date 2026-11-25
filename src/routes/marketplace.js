// Lead Marketplace routes: the public intake (only while the admin has opened it), the firm dashboard (behind the firm login, verified firms only) and the admin.
// A visitor or an unverified firm never gets a preview: every firm route checks the signed-in owner, the verification and the open switch before it reads a lead.
import { json, cached, readJson, clampInt, NO_STORE, HttpError, isEmail } from '../lib/http.js';
import { requireUser, requireAdmin, adminEmails } from '../lib/auth.js';
import { sha256Hex } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { mailInBackground, marketplaceReceivedEmail, marketplaceHeldEmail, marketplaceReportEmail, marketplaceReportDecisionEmail } from '../lib/email.js';
import * as mk from '../lib/marketplace.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);
const originOf = (env, url) => env.SITE_ORIGIN || url.origin;

// ---------------------------------------------------------------- public
export async function status({ env }) {
  return cached({ open: await mk.isOpen(env) }, 60);
}

const ipHashOf = (request) => sha256Hex('ip:' + (request.headers.get('cf-connecting-ip') || 'local'));

// A firm's own "send an inquiry" form carries an optional box; the general "find me a lawyer" form always asks. Either way the person must have ticked the consent
// box, and what is stored is the wording of the version shown (src/lib/marketplace.js CONSENT), written here.
export async function submitInquiry({ request, env, url, exec }) {
  const input = await readJson(request);
  if (input.botcheck) return reply({ ok: true }, 201); // a hidden field only a robot fills in: pretend it worked
  if (!(await mk.isOpen(env))) throw new HttpError(503, 'This service is not open yet.');
  if (input.consent !== 'yes') throw new HttpError(422, 'Please tick the box to agree to how your inquiry is shared.');
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  if (!text(input.name, 100)) throw new HttpError(422, 'Your name is required.');
  if (!isEmail(text(input.email, 254))) throw new HttpError(422, 'A valid email is required.');
  if (!mk.AREAS.includes(text(input.practiceArea, 20))) throw new HttpError(422, 'Choose the kind of lawyer you need.');
  if (!mk.PROVINCE_CODES.includes(text(input.province, 3).toUpperCase())) throw new HttpError(422, 'Choose your province.');
  if (text(input.description, 3000).length < 25) throw new HttpError(422, 'Please tell us a little more about what you need (a sentence or two).');
  const ipHash = await ipHashOf(request);
  const [fromIp, same] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM marketplace_leads WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')").bind(ipHash).first(),
    env.DB.prepare("SELECT 1 FROM marketplace_leads WHERE json_extract(details, '$.email') = ? AND practice_area = ? AND created_at > datetime('now', '-1 day')").bind(text(input.email, 254).toLowerCase(), text(input.practiceArea, 20)).first(),
  ]);
  if (fromIp.n >= 5) throw new HttpError(429, 'Too many requests from your connection. Please try again later.');
  if (same) return reply({ ok: true }, 201); // the same request twice is one request
  const lead = await mk.createInquiry(env, input, { source: 'general', userAgent: request.headers.get('user-agent') || '', ipHash });
  announce(env, exec, originOf(env, url), lead, input);
  return reply({ ok: true }, 201);
}

// The person gets a plain confirmation (not for junk), and the admin hears about anything held for review.
export function announce(env, exec, origin, lead, input) {
  const label = mk.AREA_LABEL[input.practiceArea] || 'Legal';
  if (lead.status !== 'rejected' && typeof input.email === 'string') mailInBackground(env, exec, { to: input.email.trim().toLowerCase(), ...marketplaceReceivedEmail(origin, { name: input.name, practiceAreaLabel: label }) });
  if (lead.status === 'held') {
    const to = [...adminEmails(env)];
    if (to.length) mailInBackground(env, exec, { to, ...marketplaceHeldEmail(origin, { id: lead.id, reason: lead.reason, practiceAreaLabel: label, province: String(input.province || '').toUpperCase() }) });
  }
}

// ---------------------------------------------------------------- firm dashboard
async function ownerOf(env, request, slug) {
  const user = await requireUser(env, request);
  const m = await env.DB.prepare("SELECT 1 FROM firm_members WHERE user_id = ? AND firm_slug = ? AND status = 'approved'").bind(user.id, slug).first();
  if (!m) throw new HttpError(403, 'You do not manage this firm');
  return user;
}
// The firm, the switch, and the eligibility, checked in the same way by every route that reads a lead.
async function openAndEligible(env, slug) {
  if (!(await mk.isOpen(env))) throw new HttpError(404, 'The Lead Marketplace is not open yet.');
  const state = await mk.firmState(env, slug);
  const e = mk.eligibility(state);
  if (!e.ok) throw new HttpError(403, e.reason);
  await mk.joinMarketplace(env, slug); // first visit: a balance row (and the welcome credits, if set)
  return mk.firmState(env, slug);
}

// Top-up buttons: Stripe payment links the admin set in STRIPE_TOPUP_LINKS ({"50": "https://buy.stripe.com/..."}), each opened with the firm's slug as client_reference_id.
function topUps(env, user, slug) {
  let links = {};
  try { links = JSON.parse(env.STRIPE_TOPUP_LINKS || '{}'); } catch { /* none */ }
  return Object.entries(links).filter(([c, u]) => /^\d{1,5}$/.test(c) && /^https:\/\/buy\.stripe\.com\//.test(String(u))).sort((a, b) => a[0] - b[0])
    .map(([credits, u]) => ({ credits: Number(credits), url: `${u}${u.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent('mp:' + slug)}&prefilled_email=${encodeURIComponent(user.email)}` }));
}

export async function firmGet({ request, env, params }) {
  const user = await ownerOf(env, request, params.slug);
  const open = await mk.isOpen(env);
  const state = await mk.firmState(env, params.slug);
  if (!open) return reply({ open: false });
  const elig = mk.eligibility(state);
  if (!elig.ok) return reply({ open: true, eligible: false, reason: elig.reason, firm: { name: state.name, verified: state.verified, live: state.live } });
  const s = await openAndEligible(env, params.slug);
  const cfg = await mk.getConfig(env);
  return reply({
    open: true, eligible: true, firm: { name: s.name, featured: s.featured }, balance: s.balance, prefs: s.prefs, alerts: s.alerts, topUps: topUps(env, user, params.slug),
    areas: mk.AREA_LABEL, provinces: mk.PROVINCE_CODES,
    rules: { headStartMinutes: cfg.headStartMinutes, fullHours: cfg.fullHours, discountPercent: cfg.discountPercent, expiryDays: cfg.expiryDays, reportHours: cfg.reportHours },
  });
}
export async function firmPrefs({ request, env, params }) {
  await ownerOf(env, request, params.slug);
  await openAndEligible(env, params.slug);
  await mk.savePrefs(env, params.slug, await readJson(request));
  const s = await mk.firmState(env, params.slug);
  return reply({ ok: true, prefs: s.prefs, alerts: s.alerts });
}
export async function firmBoard({ request, env, params, url }) {
  await ownerOf(env, request, params.slug);
  const state = await openAndEligible(env, params.slug);
  const q = url.searchParams;
  const leads = await mk.board(env, state, { widen: q.get('widen') === '1', area: q.get('area') || '', province: (q.get('province') || '').toUpperCase(), city: (q.get('city') || '').slice(0, 60) });
  return reply({ leads, balance: state.balance });
}
export async function firmUnlock({ request, env, params }) {
  await ownerOf(env, request, params.slug);
  const state = await openAndEligible(env, params.slug);
  const unlocked = await mk.unlockLead(env, state, clampInt(params.id, 0, 0, Number.MAX_SAFE_INTEGER));
  return reply({ ok: true, lead: unlocked, balance: (await mk.firmState(env, params.slug)).balance });
}
export async function firmUnlocked({ request, env, params }) {
  await ownerOf(env, request, params.slug);
  await openAndEligible(env, params.slug);
  return reply({ leads: await mk.unlockedList(env, params.slug) });
}
export async function firmReport({ request, env, params, url, exec }) {
  await ownerOf(env, request, params.slug);
  const state = await openAndEligible(env, params.slug);
  const body = await readJson(request);
  const id = clampInt(params.id, 0, 0, Number.MAX_SAFE_INTEGER);
  await mk.reportLead(env, state, id, body);
  const to = [...adminEmails(env)];
  if (to.length) mailInBackground(env, exec, { to, ...marketplaceReportEmail(originOf(env, url), { firmName: state.name, leadId: id, reason: mk.REPORT_REASONS[body.reason], note: String(body.note || '').slice(0, 500) }) });
  return reply({ ok: true });
}
export async function firmLedger({ request, env, params }) {
  await ownerOf(env, request, params.slug);
  await openAndEligible(env, params.slug);
  return reply({ ledger: await mk.ledger(env, params.slug) });
}

// ---------------------------------------------------------------- admin
export async function adminOverview({ request, env }) {
  await requireAdmin(env, request);
  const [cfg, leads, money, firms, reports] = await Promise.all([
    mk.getConfig(env),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM marketplace_leads GROUP BY status').all(),
    env.DB.prepare("SELECT type, COUNT(*) AS n, SUM(amount) AS credits FROM marketplace_ledger GROUP BY type").all(),
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS balance FROM marketplace_firms').first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM marketplace_reports WHERE status = 'open'").first(),
  ]);
  const by = Object.fromEntries(money.results.map((r) => [r.type, r]));
  const sold = -(by.unlock?.credits || 0), refunded = by.refund?.credits || 0;
  return reply({
    config: cfg, defaults: mk.DEFAULTS, areas: mk.AREA_LABEL,
    stats: { leads: Object.fromEntries(leads.results.map((r) => [r.status, r.n])), unlocks: by.unlock?.n || 0, creditsSold: sold, creditsRefunded: refunded, netRevenue: sold - refunded, topUps: by.topup?.credits || 0, topUpCount: by.topup?.n || 0, granted: (by.promo?.credits || 0) + (by.adjust?.credits || 0), firms: firms.n, balances: firms.balance, openReports: reports.n },
  });
}
export async function adminConfig({ request, env }) {
  const admin = await requireAdmin(env, request);
  return reply({ config: await mk.saveConfig(env, admin, await readJson(request)) });
}
export async function adminLeads({ request, env, url }) {
  await requireAdmin(env, request);
  const st = url.searchParams.get('status') || 'held';
  if (!['held', 'approved', 'unlocked', 'expired', 'rejected'].includes(st)) throw new HttpError(422, 'Unknown status');
  const { results } = await env.DB.prepare('SELECT id, source, source_firm, practice_area, province, city, urgency, summary_public, details, status, hold_reason, created_at, approved_at, expires_at, firm_slug, unlocked_at, price_paid FROM marketplace_leads WHERE status = ? ORDER BY id DESC LIMIT 100').bind(st).all();
  return reply({ leads: results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null, practiceAreaLabel: mk.AREA_LABEL[r.practice_area] })) });
}
// A held inquiry waits for this: approve it (it is listed from now, with its seven days) or reject it (its details are cleared).
export async function adminLeadDecision({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const { action } = await readJson(request);
  if (!['approve', 'reject'].includes(action)) throw new HttpError(422, 'action must be approve or reject');
  const id = clampInt(params.id, 0, 0, Number.MAX_SAFE_INTEGER);
  const cfg = await mk.getConfig(env);
  const now = new Date();
  const res = action === 'approve'
    ? await env.DB.prepare("UPDATE marketplace_leads SET status = 'approved', approved_at = ?, expires_at = ?, alert_next_at = ?, hold_reason = NULL WHERE id = ? AND status = 'held'").bind(mk.sqlTime(now), mk.sqlTime(new Date(now.getTime() + cfg.expiryDays * 86400e3)), mk.sqlTime(now), id).run()
    : await env.DB.prepare("UPDATE marketplace_leads SET status = 'rejected', details = NULL WHERE id = ? AND status = 'held'").bind(id).run();
  if (!res.meta.changes) throw new HttpError(409, 'This inquiry is not waiting for review.');
  await audit(env, admin, `marketplace.lead_${action}`, 'marketplace', String(id), {});
  return reply({ ok: true });
}
export async function adminReports({ request, env, url }) {
  await requireAdmin(env, request);
  const st = url.searchParams.get('status') === 'all' ? null : 'open';
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.lead_id AS leadId, r.firm_slug AS firmSlug, f.name AS firmName, r.reason, r.note, r.status, r.created_at AS createdAt, r.resolved_at AS resolvedAt, r.resolution_note AS resolutionNote, l.price_paid AS pricePaid, l.details, l.practice_area AS practiceArea
     FROM marketplace_reports r JOIN marketplace_leads l ON l.id = r.lead_id LEFT JOIN firms f ON f.slug = r.firm_slug ${st ? "WHERE r.status = 'open'" : ''} ORDER BY r.id DESC LIMIT 100`).all();
  return reply({ reports: results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null, reasonLabel: mk.REPORT_REASONS[r.reason] })) });
}
export async function adminReportDecision({ request, env, params, url, exec }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const out = await mk.decideReport(env, admin, clampInt(params.id, 0, 0, Number.MAX_SAFE_INTEGER), body);
  const owners = await env.DB.prepare("SELECT u.email FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_slug = ? AND m.status = 'approved' AND u.disabled = 0").bind(out.firmSlug).all();
  const firm = await env.DB.prepare('SELECT name FROM firms WHERE slug = ?').bind(out.firmSlug).first();
  const to = owners.results.map((o) => o.email);
  if (to.length) mailInBackground(env, exec, { to, ...marketplaceReportDecisionEmail(originOf(env, url), { firmName: firm?.name || out.firmSlug, slug: out.firmSlug, leadId: out.leadId, approved: body.action === 'approve', credits: out.credits, note: String(body.note || '').slice(0, 500) }) });
  return reply({ ok: true, credits: out.credits });
}
export async function adminFirms({ request, env }) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    `SELECT m.firm_slug AS slug, f.name, f.city, f.province, f.featured, m.balance, m.alerts, (SELECT COUNT(*) FROM marketplace_leads l WHERE l.firm_slug = m.firm_slug) AS unlocks, v.status AS verification
     FROM marketplace_firms m JOIN firms f ON f.slug = m.firm_slug LEFT JOIN firm_verifications v ON v.firm_slug = m.firm_slug ORDER BY m.balance DESC, m.firm_slug LIMIT 200`).all();
  return reply({ firms: results.map((r) => ({ ...r, featured: !!r.featured })) });
}
export async function adminLedger({ request, env, url }) {
  await requireAdmin(env, request);
  const firm = url.searchParams.get('firm');
  const { results } = await env.DB.prepare(`SELECT id, firm_slug AS firmSlug, type, amount, lead_id AS leadId, stripe_ref AS stripeRef, note, created_at AS createdAt FROM marketplace_ledger ${firm ? 'WHERE firm_slug = ?' : ''} ORDER BY id DESC LIMIT 200`).bind(...(firm ? [firm] : [])).all();
  return reply({ ledger: results });
}
export async function adminGrant({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const b = await readJson(request);
  return reply({ ok: true, balance: await mk.grantCredits(env, admin, params.slug, b.amount, b.note, b.type || 'promo') });
}
