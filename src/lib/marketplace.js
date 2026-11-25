// Lead Marketplace: verified law firms preview inquiries (practice area, place, urgency, a one-line summary) and unlock the ones they want with prepaid credits.
// Each inquiry goes to ONE firm. The words used everywhere are "inquiry", "unlock" and "advertising": the price is a flat advertising fee that never depends on
// whether the person hires the firm (docs/MARKETPLACE_LEGAL.md). Nothing here is reachable until the admin opens the marketplace (config key "open").
import { HttpError, isEmail } from './http.js';
import { audit } from './audit.js';
import { PRACTICE } from './practice.js';

export const AREAS = Object.keys(PRACTICE);
export const AREA_LABEL = Object.fromEntries(Object.entries(PRACTICE).map(([k, v]) => [k, v[1]]));
export const PROVINCE_CODES = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'NU', 'YT'];
export const URGENCY = { today: 'Needs help today', week: 'This week', month: 'Within a month', planning: 'Planning ahead', unspecified: 'Not said' };
export const REPORT_REASONS = { disconnected: 'The phone number is disconnected', spam: 'It is spam', fake: 'It is fake', other: 'Something else' };

// ---------------------------------------------------------------- consent
// The wording a person sees next to the tick box, with a version id so the exact words behind any stored agreement can be looked up. The server writes it (the
// browser only says "yes"); `record` also keeps the form it came from, the time, a short browser string and the one-way hash of the address (no raw address).
export const CONSENT = {
  version: 'mp-inquiry-2026-11-v1',
  text: 'I agree that LawDB may share my inquiry and contact details with one law firm that pays to receive it. Only one firm will receive it. LawDB may also contact me about my inquiry.',
};
export function consentRecord(form, { userAgent = '', ipHash = '', now = new Date() } = {}) {
  return { form, version: CONSENT.version, text: CONSENT.text, at: now.toISOString(), userAgent: String(userAgent).slice(0, 200), ipHash };
}

// ---------------------------------------------------------------- settings
export const DEFAULTS = {
  open: false,                       // nothing below is reachable until this is true
  prices: { business: 200, criminal: 125, traffic: 60, injury: 150, employment: 100, family: 80, litigation: 100, wills: 60, immigration: 80, realestate: 60 }, // credits (dollars)
  fullHours: 48,                     // full price for the first 48 hours
  discountPercent: 40,               // then this much off, until it expires
  expiryDays: 7,                     // and then it is gone
  headStartMinutes: 20,              // Featured firms see a new inquiry this long before everyone else
  holdAreas: [],                     // practice areas whose inquiries always wait for the admin (the sensitive-wording check always applies)
  welcomeCredits: 0,                 // credits a firm gets the first time it opens the marketplace (the brief says "consider 1 to 2"; a credit is a dollar, so it is off)
  alertWaveSize: 15, alertGapMinutes: 5, alertMaxWaves: 3,
  reportHours: 48,
};

export async function getConfig(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM marketplace_config').all();
  const cfg = { ...DEFAULTS, prices: { ...DEFAULTS.prices } };
  for (const r of results) {
    if (!(r.key in DEFAULTS)) continue;
    try { const v = JSON.parse(r.value); cfg[r.key] = r.key === 'prices' ? { ...DEFAULTS.prices, ...v } : v; } catch { /* keep the default */ }
  }
  return cfg;
}

const num = (v, min, max, what) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(422, `${what} must be a number from ${min} to ${max}`);
  return n;
};
// What the admin may change, checked. Unknown keys are refused.
export function cleanConfig(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!(k in DEFAULTS)) throw new HttpError(422, `Unknown setting: ${k}`);
    if (k === 'open') { if (typeof v !== 'boolean') throw new HttpError(422, 'open must be true or false'); out.open = v; }
    else if (k === 'prices') {
      if (!v || typeof v !== 'object') throw new HttpError(422, 'prices must be an object of practice area to credits');
      out.prices = {};
      for (const [a, p] of Object.entries(v)) { if (!AREAS.includes(a)) throw new HttpError(422, `Unknown practice area: ${a}`); out.prices[a] = Math.round(num(p, 1, 5000, `The price for ${a}`)); }
    }
    else if (k === 'holdAreas') { if (!Array.isArray(v) || v.some((a) => !AREAS.includes(a))) throw new HttpError(422, 'holdAreas must be a list of practice areas'); out.holdAreas = [...new Set(v)]; }
    else if (k === 'fullHours') out.fullHours = num(v, 0.00001, 24 * 30, 'fullHours');
    else if (k === 'discountPercent') out.discountPercent = Math.round(num(v, 0, 90, 'discountPercent'));
    else if (k === 'expiryDays') out.expiryDays = num(v, 0.00001, 30, 'expiryDays');
    else if (k === 'headStartMinutes') out.headStartMinutes = num(v, 0, 24 * 60, 'headStartMinutes');
    else if (k === 'welcomeCredits') out.welcomeCredits = Math.round(num(v, 0, 1000, 'welcomeCredits'));
    else if (k === 'alertWaveSize') out.alertWaveSize = Math.round(num(v, 1, 50, 'alertWaveSize'));
    else if (k === 'alertGapMinutes') out.alertGapMinutes = num(v, 1, 240, 'alertGapMinutes');
    else if (k === 'alertMaxWaves') out.alertMaxWaves = Math.round(num(v, 1, 10, 'alertMaxWaves'));
    else if (k === 'reportHours') out.reportHours = num(v, 1, 24 * 14, 'reportHours');
  }
  return out;
}

export async function saveConfig(env, admin, body) {
  const changes = cleanConfig(body);
  if (!Object.keys(changes).length) throw new HttpError(422, 'Nothing to change');
  const cur = await getConfig(env);
  const stmts = Object.entries(changes).map(([k, v]) => env.DB.prepare("INSERT INTO marketplace_config (key, value, updated_by) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by").bind(k, JSON.stringify(v), admin?.id ?? null));
  await env.DB.batch(stmts);
  await audit(env, admin, 'marketplace.config', 'marketplace', 'config', Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { from: cur[k], to: v }])));
  return getConfig(env);
}

export async function isOpen(env) {
  const r = await env.DB.prepare("SELECT value FROM marketplace_config WHERE key = 'open'").first();
  return !!r && r.value === 'true';
}

// ---------------------------------------------------------------- time
export const sqlTime = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');
export const parseSql = (s) => new Date(String(s).replace(' ', 'T') + 'Z');

// ---------------------------------------------------------------- the one-line summary (never the person's words)
// A summary is built only from a fixed vocabulary, by looking for keywords in what the person wrote, so a name, an employer, a date or any other detail that could
// identify them cannot get into it.
const VOCAB = {
  family: [[/separat|split up|left (my|our)/i, 'separation'], [/divorc/i, 'divorce'], [/custody|parenting|access to (my|the) (kid|child)/i, 'parenting time'], [/child support|spousal support|support pay/i, 'support'], [/property|assets|house|pension/i, 'dividing property'], [/protection order|restraining/i, 'a protection order']],
  injury: [[/car|motor|vehicle|collision|crash|rear[- ]ended/i, 'a car accident'], [/slip|fell|fall\b|trip/i, 'a fall'], [/dog|bitten/i, 'a dog bite'], [/disabilit|ltd\b/i, 'disability benefits'], [/insurance|claim/i, 'an insurance claim'], [/head|brain|concuss/i, 'a head injury'], [/work(place)? injur|wsib|workers/i, 'a workplace injury']],
  criminal: [[/impaired|dui|over 80|drunk/i, 'an impaired driving charge'], [/assault/i, 'an assault charge'], [/theft|shoplift|fraud/i, 'a theft or fraud charge'], [/drug|possession|traffick/i, 'a drug charge'], [/bail|released/i, 'bail'], [/pardon|record suspension|criminal record/i, 'a criminal record']],
  immigration: [[/work permit/i, 'a work permit'], [/study permit|student/i, 'a study permit'], [/visa|visitor/i, 'a visa'], [/refugee|asylum/i, 'a refugee claim'], [/sponsor|spous|partner/i, 'sponsorship'], [/citizenship/i, 'citizenship'], [/permanent resident|express entry|\bpr\b/i, 'permanent residence'], [/deport|removal|inadmissib/i, 'removal or inadmissibility']],
  wills: [[/\bwill\b|wills\b/i, 'a will'], [/power of attorney|poa\b/i, 'a power of attorney'], [/estate|probate|executor|inherit/i, 'an estate'], [/trust/i, 'a trust']],
  realestate: [[/buy|purchas/i, 'buying a home'], [/sell|sale/i, 'selling a home'], [/mortgage|refinanc/i, 'a mortgage'], [/closing|title|transfer/i, 'a closing'], [/condo/i, 'a condo']],
  employment: [[/fired|terminat|dismiss|let go|laid off|layoff/i, 'being let go'], [/severance/i, 'severance'], [/harass|bully/i, 'harassment'], [/discriminat/i, 'discrimination'], [/overtime|wages|unpaid|owed/i, 'unpaid wages'], [/contract/i, 'an employment contract']],
  business: [[/incorporat/i, 'incorporating'], [/shareholder/i, 'a shareholder issue'], [/partner/i, 'a partnership'], [/contract|agreement/i, 'a contract'], [/buy|sell/i, 'buying or selling a business'], [/franchis/i, 'a franchise']],
  litigation: [[/sue|lawsuit|statement of claim/i, 'a lawsuit'], [/debt|owed|collect/i, 'a debt'], [/landlord|tenant|evict/i, 'a landlord and tenant issue'], [/small claims/i, 'small claims'], [/contract|breach/i, 'a contract dispute']],
  traffic: [[/speed/i, 'speeding'], [/stunt/i, 'stunt driving'], [/suspen/i, 'a licence suspension'], [/demerit/i, 'demerit points'], [/ticket|fine\b|provincial offence/i, 'a ticket']],
};
const joinAnd = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
export function publicSummary({ practiceArea, city, province, description }) {
  const label = AREA_LABEL[practiceArea] || 'Legal';
  const where = [String(city || '').replace(/[^A-Za-zÀ-ÿ .'’-]/g, '').trim().slice(0, 40), province].filter(Boolean).join(', ');
  const topics = [];
  for (const [re, phrase] of VOCAB[practiceArea] || []) if (re.test(String(description || '')) && !topics.includes(phrase)) topics.push(phrase);
  const lead = `${label} inquiry${where ? ' in ' + where : ''}`;
  return topics.length ? `${lead}: ${joinAnd(topics.slice(0, 3))}.` : `${lead}.`;
}

// The practice area for an enquiry sent through a firm's page: the one of the firm's own areas that the message mentions most, else the firm's first.
export function guessArea(message, firmAreas = []) {
  const own = firmAreas.filter((a) => AREAS.includes(a));
  if (!own.length) return 'litigation';
  const score = (a) => (VOCAB[a] || []).filter(([re]) => re.test(String(message || ''))).length;
  return own.reduce((best, a) => (score(a) > score(best) ? a : best), own[0]);
}

// ---------------------------------------------------------------- screening (automatic approval, with a manual review flag)
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'throwawaymail.com', 'maildrop.cc', 'fakeinbox.com']);
const SPAM = /\b(viagra|cialis|casino|crypto|bitcoin|forex|backlinks?|seo (services?|packages?)|loan offer|click here|make money|work from home|free gift)\b/i;
const SENSITIVE = [
  [/\b(suicid|kill myself|end my life|self[- ]harm)/i, 'self-harm'],
  [/\b(child abuse|abus(e|ed|ing) (my |a |the )?(child|kid|son|daughter)|sexual(ly)? (assault|abus)|\brape\b|molest)/i, 'abuse or a sexual offence'],
  [/\b(domestic violence|domestic abuse|battered|abusive (partner|husband|wife|spouse|boyfriend|girlfriend|ex)|afraid for my (safety|life)|(husband|wife|partner|spouse|boyfriend|girlfriend|ex|boss) (hit|beat|choked|strangled|threatened|assaulted) me)/i, 'violence or safety'], // not a bare "hit me": "a car hit me" is an ordinary injury claim
  [/\b(kill (him|her|them)|bomb|shoot(ing)?|threaten(ed|ing)? to kill)/i, 'a threat'],
  [/\b(kidnap|abduct|human traffick)/i, 'a serious offence'],
  [/\b(minor|under 18|underage|my \d{1,2}[- ]year[- ]old)/i, 'a minor is involved'],
];
const digits = (s) => String(s || '').replace(/\D/g, '');

// Returns { verdict: 'approved' | 'held' | 'rejected', reason }. Rejected is junk (the person is told nothing different); held waits for the admin.
export function screenInquiry({ name, email, phone, description, practiceArea, province }, cfg = DEFAULTS) {
  const n = String(name || '').trim(), d = String(description || '').trim(), e = String(email || '').trim().toLowerCase();
  if (n.length < 2 || n.length > 100 || !/[A-Za-zÀ-ÿ]/.test(n)) return { verdict: 'rejected', reason: 'no usable name' };
  if (!isEmail(e) || DISPOSABLE.has(e.split('@')[1])) return { verdict: 'rejected', reason: 'email is not usable' };
  if (phone && digits(phone).length < 10) return { verdict: 'rejected', reason: 'phone number too short' };
  if (d.length < 25 || d.length > 3000) return { verdict: 'rejected', reason: 'description is empty or too short' };
  const letters = (d.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters / d.length < 0.6 || /(.)\1{7,}/.test(d) || /\S{60,}/.test(d)) return { verdict: 'rejected', reason: 'looks like gibberish' };
  if (SPAM.test(d) || (d.match(/https?:\/\/|www\./gi) || []).length > 1) return { verdict: 'rejected', reason: 'looks like spam' };
  if (!AREAS.includes(practiceArea) || !PROVINCE_CODES.includes(province)) return { verdict: 'rejected', reason: 'no practice area or province' };
  for (const [re, why] of SENSITIVE) if (re.test(d)) return { verdict: 'held', reason: `sensitive: ${why}` };
  if ((cfg.holdAreas || []).includes(practiceArea)) return { verdict: 'held', reason: `${AREA_LABEL[practiceArea]} inquiries wait for review` };
  return { verdict: 'approved', reason: '' };
}

// ---------------------------------------------------------------- prices
// Full price for the first `fullHours`, then `discountPercent` off, and gone after `expiryDays`.
export function priceFor(cfg, area, approvedAt, now = new Date()) {
  const base = cfg.prices[area] ?? 100;
  const ageHours = (now - parseSql(approvedAt)) / 3600e3;
  if (ageHours >= cfg.expiryDays * 24) return { expired: true, credits: 0, tier: 'expired' };
  if (ageHours < cfg.fullHours) return { expired: false, credits: base, tier: 'full' };
  return { expired: false, credits: Math.max(1, Math.round(base * (100 - cfg.discountPercent) / 100)), tier: 'discount' };
}

// ---------------------------------------------------------------- inquiries (intake)
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Creates an inquiry from a form the person filled in, after they agreed to the wording. `source` is 'general' (the "find me a lawyer" form) or 'firm-page' (the optional
// tick box on a firm's form, with `sourceLeadId` and `sourceFirm`). Returns { id, status }. Junk is stored as rejected, with its details cleared.
export async function createInquiry(env, input, { source, sourceLeadId = null, sourceFirm = null, userAgent = '', ipHash = '' }) {
  const cfg = await getConfig(env);
  const practiceArea = clean(input.practiceArea, 20), province = clean(input.province, 3).toUpperCase(), city = clean(input.city, 60);
  const urgency = Object.hasOwn(URGENCY, input.urgency) ? input.urgency : 'unspecified';
  const person = { name: clean(input.name, 100), email: clean(input.email, 254).toLowerCase(), phone: clean(input.phone, 30), description: clean(input.description, 3000) };
  const verdict = screenInquiry({ ...person, practiceArea, province }, cfg);
  const now = new Date();
  const approved = verdict.verdict === 'approved';
  const status = verdict.verdict === 'rejected' ? 'rejected' : verdict.verdict === 'held' ? 'held' : 'approved';
  const summary = publicSummary({ practiceArea, city, province, description: person.description });
  const res = await env.DB.prepare(
    `INSERT INTO marketplace_leads (source, source_lead_id, source_firm, practice_area, province, city, urgency, summary_public, details, consent, status, hold_reason, approved_at, expires_at, alert_next_at, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(source, sourceLeadId, sourceFirm, AREAS.includes(practiceArea) ? practiceArea : 'litigation', PROVINCE_CODES.includes(province) ? province : 'ON', city, urgency, summary,
    status === 'rejected' ? null : JSON.stringify(person), JSON.stringify(consentRecord(source, { userAgent, ipHash, now })), status, status === 'approved' ? null : verdict.reason || null,
    approved ? sqlTime(now) : null, approved ? sqlTime(new Date(now.getTime() + cfg.expiryDays * 86400e3)) : null, approved ? sqlTime(now) : null, ipHash || null).run();
  return { id: res.meta.last_row_id, status, reason: verdict.reason };
}

// ---------------------------------------------------------------- firms
export async function firmState(env, slug) {
  const row = await env.DB.prepare(
    `SELECT f.slug, f.name, f.city, f.province, f.featured, f.status, f.data, v.status AS vstatus, m.balance, m.practice_areas, m.provinces, m.cities, m.alerts
     FROM firms f LEFT JOIN firm_verifications v ON v.firm_slug = f.slug LEFT JOIN marketplace_firms m ON m.firm_slug = f.slug WHERE f.slug = ?`
  ).bind(slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  const own = JSON.parse(row.data).caseTypes || [];
  const list = (s) => String(s || '').split(',').filter(Boolean);
  return {
    slug: row.slug, name: row.name, city: row.city, province: row.province, featured: !!row.featured, live: row.status === 'live', verified: row.vstatus === 'verified',
    joined: row.balance !== null, balance: row.balance ?? 0, alerts: row.alerts || 'instant',
    prefs: { practiceAreas: list(row.practice_areas).length ? list(row.practice_areas) : own.filter((a) => AREAS.includes(a)), provinces: list(row.provinces).length ? list(row.provinces) : [row.province], cities: list(row.cities),
      customAreas: list(row.practice_areas).length > 0, customProvinces: list(row.provinces).length > 0 },
  };
}

// A firm that is live and verified may use the marketplace; everyone else sees nothing but the reason.
export function eligibility(state) {
  if (!state.live) return { ok: false, reason: 'Your listing is not live yet.' };
  if (!state.verified) return { ok: false, reason: 'Only firms verified by LawDB can use the Lead Marketplace. Ask for verification from the My firm tab; it is free.' };
  return { ok: true };
}

// First time in: a balance row (and the welcome credits, if the admin set any, written to the ledger in the same batch).
export async function joinMarketplace(env, slug) {
  const cfg = await getConfig(env);
  await env.DB.prepare('INSERT OR IGNORE INTO marketplace_firms (firm_slug, balance) VALUES (?, 0)').bind(slug).run();
  if (cfg.welcomeCredits > 0) {
    try { // one welcome row per firm (a unique index): the second try fails, and the batch with it, so the credits are never added twice
      await env.DB.batch([
        env.DB.prepare("INSERT INTO marketplace_ledger (firm_slug, type, amount, note) VALUES (?, 'promo', ?, 'Welcome credits')").bind(slug, cfg.welcomeCredits),
        env.DB.prepare('UPDATE marketplace_firms SET balance = balance + ? WHERE firm_slug = ?').bind(cfg.welcomeCredits, slug),
      ]);
    } catch (e) { if (!/UNIQUE/i.test(String(e.message))) throw e; }
  }
}

export async function savePrefs(env, slug, body) {
  await joinMarketplace(env, slug);
  const list = (v, ok, what) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || (ok && !ok.includes(x)))) throw new HttpError(422, `${what} is not valid`);
    return [...new Set(v.map((x) => x.trim()))].filter(Boolean);
  };
  const areas = list(body.practiceAreas, AREAS, 'practiceAreas'), provinces = list(body.provinces, PROVINCE_CODES, 'provinces'), cities = list(body.cities, null, 'cities');
  if (cities && cities.length > 20) throw new HttpError(422, 'Up to 20 cities');
  if (body.alerts !== undefined && !['instant', 'daily', 'off'].includes(body.alerts)) throw new HttpError(422, 'alerts must be instant, daily or off');
  const sets = [], args = [];
  if (areas) { sets.push('practice_areas = ?'); args.push(areas.join(',')); }
  if (provinces) { sets.push('provinces = ?'); args.push(provinces.join(',')); }
  if (cities) { sets.push('cities = ?'); args.push(cities.map((c) => clean(c, 60)).join(',').replace(/,{2,}/g, ',')); }
  if (body.alerts) { sets.push('alerts = ?'); args.push(body.alerts); }
  if (sets.length) await env.DB.prepare(`UPDATE marketplace_firms SET ${sets.join(', ')} WHERE firm_slug = ?`).bind(...args, slug).run();
}

// ---------------------------------------------------------------- the board (blurred previews)
// What a firm sees: no name, email, phone or description, only the preview. Featured firms see a new inquiry `headStartMinutes` before everyone else.
// An inquiry that came through a firm's own page is never offered to that firm (it already has it).
export async function board(env, state, { widen = false, area = '', province = '', city = '' } = {}) {
  const cfg = await getConfig(env);
  const where = ["status = 'approved'", "expires_at > datetime('now')", 'firm_slug IS NULL', '(source_firm IS NULL OR source_firm != ?)'];
  const args = [state.slug];
  if (!state.featured) { where.push("datetime(approved_at, '+' || CAST(? * 60 AS INTEGER) || ' seconds') <= datetime('now')"); args.push(cfg.headStartMinutes); }
  const areas = area ? [area] : widen ? [] : state.prefs.practiceAreas, provs = province ? [province] : widen ? [] : state.prefs.provinces;
  if (areas.length) { where.push(`practice_area IN (${areas.map(() => '?').join(',')})`); args.push(...areas); }
  if (provs.length) { where.push(`province IN (${provs.map(() => '?').join(',')})`); args.push(...provs); }
  const cities = city ? [city] : widen ? [] : state.prefs.cities;
  if (cities.length) { where.push(`city COLLATE NOCASE IN (${cities.map(() => '?').join(',')})`); args.push(...cities); }
  const { results } = await env.DB.prepare(
    `SELECT id, practice_area, province, city, urgency, summary_public, approved_at, expires_at, source FROM marketplace_leads WHERE ${where.join(' AND ')} ORDER BY approved_at DESC, id DESC LIMIT 60`
  ).bind(...args).all();
  const now = new Date();
  return results.map((r) => {
    const p = priceFor(cfg, r.practice_area, r.approved_at, now);
    return {
      id: r.id, practiceArea: r.practice_area, practiceAreaLabel: AREA_LABEL[r.practice_area], province: r.province, city: r.city, urgency: r.urgency, urgencyLabel: URGENCY[r.urgency] || URGENCY.unspecified,
      summary: r.summary_public, postedAt: r.approved_at, ageMinutes: Math.max(0, Math.round((now - parseSql(r.approved_at)) / 60000)), expiresAt: r.expires_at,
      price: p.credits, priceTier: p.tier, headStart: state.featured && (now - parseSql(r.approved_at)) / 60000 < cfg.headStartMinutes,
    };
  }).filter((r) => r.price > 0);
}

// ---------------------------------------------------------------- unlocking (one buyer, one charge)
// All in one batch, in this order, and D1 runs a batch as one transaction with no other writer in between, so two firms can never buy the same inquiry and one firm can
// never be charged twice:
//   1. the inquiry becomes this firm's, but only if it is still approved, in time, offered to this firm, and the firm is verified with enough credits;
//   2. the firm's balance goes down by the price paid, only if step 1 happened (the inquiry is now this firm's with the charge still pending);
//   3. the ledger row (also only if step 1 happened; the unique index allows one unlock row per inquiry);
//   4. the charge is marked done.
// If step 1 changed nothing, steps 2 to 4 find nothing to do. The balance can never go below zero (a CHECK on the column).
export async function unlockLead(env, state, leadId) {
  const elig = eligibility(state);
  if (!elig.ok) throw new HttpError(403, elig.reason);
  const cfg = await getConfig(env);
  const lead = await env.DB.prepare("SELECT id, practice_area, approved_at, status, source_firm FROM marketplace_leads WHERE id = ?").bind(leadId).first();
  if (!lead || lead.status !== 'approved') throw new HttpError(409, 'This inquiry is no longer available.');
  if (lead.source_firm === state.slug) throw new HttpError(409, 'This inquiry was sent to your firm already.');
  const price = priceFor(cfg, lead.practice_area, lead.approved_at);
  if (price.expired) throw new HttpError(409, 'This inquiry is no longer available.');
  if (!state.featured && (Date.now() - parseSql(lead.approved_at)) / 60000 < cfg.headStartMinutes) throw new HttpError(409, 'This inquiry is no longer available.'); // not yet shown to Basic firms
  if (state.balance < price.credits) throw new HttpError(402, `You need ${price.credits} credits to unlock this inquiry and have ${state.balance}. Add credits and try again.`);
  const headStart = state.featured ? "1 = 1" : "datetime(approved_at, '+' || CAST(? * 60 AS INTEGER) || ' seconds') <= datetime('now')";
  const claim = env.DB.prepare(
    `UPDATE marketplace_leads SET status = 'unlocked', firm_slug = ?, unlocked_at = datetime('now'), price_paid = ?, charge_pending = 1
     WHERE id = ? AND status = 'approved' AND expires_at > datetime('now') AND firm_slug IS NULL AND (source_firm IS NULL OR source_firm != ?) AND ${headStart}
       AND EXISTS (SELECT 1 FROM marketplace_firms m JOIN firm_verifications v ON v.firm_slug = m.firm_slug AND v.status = 'verified' WHERE m.firm_slug = ? AND m.balance >= ?)`
  ).bind(state.slug, price.credits, leadId, state.slug, ...(state.featured ? [] : [cfg.headStartMinutes]), state.slug, price.credits);
  const res = await env.DB.batch([
    claim,
    env.DB.prepare("UPDATE marketplace_firms SET balance = balance - ? WHERE firm_slug = ? AND EXISTS (SELECT 1 FROM marketplace_leads WHERE id = ? AND firm_slug = ? AND charge_pending = 1)").bind(price.credits, state.slug, leadId, state.slug),
    env.DB.prepare("INSERT INTO marketplace_ledger (firm_slug, type, amount, lead_id, note) SELECT ?, 'unlock', -price_paid, id, ? FROM marketplace_leads WHERE id = ? AND firm_slug = ? AND charge_pending = 1").bind(state.slug, `Unlocked inquiry #${leadId} (${price.tier} price)`, leadId, state.slug),
    env.DB.prepare('UPDATE marketplace_leads SET charge_pending = 0 WHERE id = ? AND firm_slug = ? AND charge_pending = 1').bind(leadId, state.slug),
  ]);
  if (res[0].meta.changes !== 1) throw new HttpError(409, 'Someone else unlocked this inquiry first, or it is no longer available. You were not charged.');
  await audit(env, null, 'marketplace.unlock', 'firm', state.slug, { lead: leadId, credits: price.credits, tier: price.tier });
  return { price: price.credits, tier: price.tier, ...(await unlockedLead(env, state.slug, leadId)) };
}

// The details of an inquiry this firm unlocked (and only this firm).
export async function unlockedLead(env, slug, leadId) {
  const r = await env.DB.prepare(
    `SELECT l.id, l.practice_area, l.province, l.city, l.urgency, l.summary_public, l.details, l.unlocked_at, l.price_paid, r.status AS report_status, r.reason AS report_reason, r.resolution_note
     FROM marketplace_leads l LEFT JOIN marketplace_reports r ON r.lead_id = l.id WHERE l.id = ? AND l.firm_slug = ? AND l.status = 'unlocked'`
  ).bind(leadId, slug).first();
  if (!r) throw new HttpError(404, 'Inquiry not found');
  return shapeUnlocked(r, await getConfig(env));
}
function shapeUnlocked(r, cfg) {
  const d = r.details ? JSON.parse(r.details) : {};
  const hours = (Date.now() - parseSql(r.unlocked_at)) / 3600e3;
  return {
    id: r.id, practiceAreaLabel: AREA_LABEL[r.practice_area], province: r.province, city: r.city, urgencyLabel: URGENCY[r.urgency] || URGENCY.unspecified, summary: r.summary_public,
    name: d.name || '', email: d.email || '', phone: d.phone || '', description: d.description || '', unlockedAt: r.unlocked_at, pricePaid: r.price_paid,
    report: r.report_status ? { status: r.report_status, reason: r.report_reason, note: r.resolution_note || '' } : null,
    canReport: !r.report_status && hours <= cfg.reportHours, reportUntil: sqlTime(new Date(parseSql(r.unlocked_at).getTime() + cfg.reportHours * 3600e3)),
  };
}
export async function unlockedList(env, slug) {
  const cfg = await getConfig(env);
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.practice_area, l.province, l.city, l.urgency, l.summary_public, l.details, l.unlocked_at, l.price_paid, r.status AS report_status, r.reason AS report_reason, r.resolution_note
     FROM marketplace_leads l LEFT JOIN marketplace_reports r ON r.lead_id = l.id WHERE l.firm_slug = ? AND l.status = 'unlocked' ORDER BY l.unlocked_at DESC, l.id DESC LIMIT 200`
  ).bind(slug).all();
  return results.map((r) => shapeUnlocked(r, cfg));
}

// ---------------------------------------------------------------- bad leads
export async function reportLead(env, state, leadId, body) {
  const reason = String(body?.reason || '');
  if (!Object.hasOwn(REPORT_REASONS, reason)) throw new HttpError(422, `reason must be one of: ${Object.keys(REPORT_REASONS).join(', ')}`);
  const cfg = await getConfig(env);
  const lead = await env.DB.prepare("SELECT id, unlocked_at FROM marketplace_leads WHERE id = ? AND firm_slug = ? AND status = 'unlocked'").bind(leadId, state.slug).first();
  if (!lead) throw new HttpError(404, 'Inquiry not found');
  if ((Date.now() - parseSql(lead.unlocked_at)) / 3600e3 > cfg.reportHours) throw new HttpError(409, `An inquiry can be reported within ${cfg.reportHours} hours of unlocking it.`);
  const note = clean(body?.note, 500);
  try {
    await env.DB.prepare('INSERT INTO marketplace_reports (lead_id, firm_slug, reason, note) VALUES (?, ?, ?, ?)').bind(leadId, state.slug, reason, note || null).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'This inquiry was reported already.');
    throw e;
  }
  await audit(env, null, 'marketplace.report', 'firm', state.slug, { lead: leadId, reason });
  return { ok: true };
}

// The admin decides. A refund is credit only, only for clear junk (never because the person did not hire the firm), once per inquiry.
export async function decideReport(env, admin, reportId, body) {
  const action = body?.action;
  if (!['approve', 'deny'].includes(action)) throw new HttpError(422, 'action must be approve or deny');
  const note = clean(body?.note, 500);
  const rep = await env.DB.prepare("SELECT r.id, r.lead_id, r.firm_slug, l.price_paid FROM marketplace_reports r JOIN marketplace_leads l ON l.id = r.lead_id WHERE r.id = ? AND r.status = 'open'").bind(reportId).first();
  if (!rep) throw new HttpError(404, 'This report is not waiting for a decision.');
  const by = admin?.id ?? null;
  if (action === 'deny') {
    await env.DB.prepare("UPDATE marketplace_reports SET status = 'denied', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE id = ? AND status = 'open'").bind(by, note || null, reportId).run();
  } else {
    // The report must be (now) approved for the refund row to be written, and there is one refund row per inquiry (a unique index): a second approval, or an approval after
    // a denial, writes nothing or fails the whole batch. The balance moves only if the refund row exists.
    await env.DB.batch([
      env.DB.prepare("UPDATE marketplace_reports SET status = 'approved', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE id = ? AND status = 'open'").bind(by, note || null, reportId),
      env.DB.prepare("INSERT INTO marketplace_ledger (firm_slug, type, amount, lead_id, note, actor_user_id) SELECT ?, 'refund', ?, ?, ?, ? FROM marketplace_reports WHERE id = ? AND status = 'approved'").bind(rep.firm_slug, rep.price_paid, rep.lead_id, `Refund for inquiry #${rep.lead_id}: ${note || 'reported as junk'}`, by, reportId),
      env.DB.prepare("UPDATE marketplace_firms SET balance = balance + ? WHERE firm_slug = ? AND EXISTS (SELECT 1 FROM marketplace_ledger WHERE lead_id = ? AND type = 'refund')").bind(rep.price_paid, rep.firm_slug, rep.lead_id),
    ]);
  }
  await audit(env, admin, `marketplace.report_${action}`, 'firm', rep.firm_slug, { report: reportId, lead: rep.lead_id, credits: action === 'approve' ? rep.price_paid : 0 });
  return { ok: true, firmSlug: rep.firm_slug, leadId: rep.lead_id, credits: action === 'approve' ? rep.price_paid : 0 };
}

// ---------------------------------------------------------------- credits
// Admin grant or adjustment (a negative adjustment cannot take the balance below zero: the column's CHECK refuses it and nothing is written).
export async function grantCredits(env, admin, slug, amount, note, type = 'promo') {
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100000) throw new HttpError(422, 'amount must be a whole number of credits, not zero');
  if (!['promo', 'adjust'].includes(type)) throw new HttpError(422, 'type must be promo or adjust');
  if (n < 0 && type !== 'adjust') throw new HttpError(422, 'Only an adjustment can take credits away');
  if (!(await env.DB.prepare('SELECT 1 FROM firms WHERE slug = ?').bind(slug).first())) throw new HttpError(404, 'Firm not found');
  await joinMarketplace(env, slug);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE marketplace_firms SET balance = balance + ? WHERE firm_slug = ?').bind(n, slug),
      env.DB.prepare('INSERT INTO marketplace_ledger (firm_slug, type, amount, note, actor_user_id) VALUES (?, ?, ?, ?, ?)').bind(slug, type, n, clean(note, 300) || (n > 0 ? 'Credits added by LawDB' : 'Adjustment'), admin?.id ?? null),
    ]);
  } catch (e) {
    if (/CHECK/i.test(String(e.message))) throw new HttpError(409, 'That would take the balance below zero.');
    throw e;
  }
  await audit(env, admin, 'marketplace.credits', 'firm', slug, { amount: n, type, note: clean(note, 300) });
  return (await env.DB.prepare('SELECT balance FROM marketplace_firms WHERE firm_slug = ?').bind(slug).first()).balance;
}

// A Stripe top-up (a payment link with client_reference_id "mp:<slug>"). One ledger row per Stripe session, so a repeated webhook adds nothing.
export async function creditTopUp(env, { slug, amountCents, sessionId }) {
  const credits = Math.floor(Number(amountCents) / 100);
  if (!(credits >= 1) || !sessionId) return { ok: false, reason: 'no amount or session' };
  if (!(await env.DB.prepare('SELECT 1 FROM firms WHERE slug = ?').bind(slug).first())) return { ok: false, reason: 'unknown firm' };
  await env.DB.prepare('INSERT OR IGNORE INTO marketplace_firms (firm_slug, balance) VALUES (?, 0)').bind(slug).run();
  try { // one ledger row per Stripe session (a unique index): a repeated webhook fails here, and the batch with it, so nothing is added twice
    await env.DB.batch([
      env.DB.prepare("INSERT INTO marketplace_ledger (firm_slug, type, amount, stripe_ref, note) VALUES (?, 'topup', ?, ?, 'Credit top-up')").bind(slug, credits, sessionId),
      env.DB.prepare('UPDATE marketplace_firms SET balance = balance + ? WHERE firm_slug = ?').bind(credits, slug),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return { ok: true, added: false, credits };
    throw e;
  }
  await audit(env, null, 'marketplace.topup', 'firm', slug, { credits, session: sessionId });
  return { ok: true, added: true, credits };
}

export async function ledger(env, slug, limit = 100) {
  const { results } = await env.DB.prepare('SELECT id, type, amount, lead_id AS leadId, note, created_at AS createdAt FROM marketplace_ledger WHERE firm_slug = ? ORDER BY id DESC LIMIT ?').bind(slug, limit).all();
  return results;
}

// ---------------------------------------------------------------- housekeeping
// Expired inquiries are marked and their details cleared (data we no longer need is not kept). Run every five minutes.
export async function expireLeads(env) {
  const res = await env.DB.prepare("UPDATE marketplace_leads SET status = 'expired', details = NULL WHERE status = 'approved' AND expires_at <= datetime('now')").run();
  return res.meta.changes;
}
