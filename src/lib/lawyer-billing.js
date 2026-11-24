// Featured LAWYER billing, driven by the same signed Stripe webhook as the firm plan (src/lib/stripe.js hands these events over).
//
// - The checkout link carries client_reference_id = "lawyer:<firm slug>:<lawyer slug>" (see lawyerCheckoutUrl).
// - A payment from an approved owner of that firm switches the lawyer's `featured` on; anyone else's waits for the admin ('needs_review').
// - It only shows while the firm is Featured too (lawyersOf); the stored flag is kept either way and comes back with the firm's plan.
// - When the subscription ends the lawyer goes back to Basic, unless an admin had switched it on by hand before the payment.

import { audit } from './audit.js';
import { adminEmails } from './auth.js';
import { cleanLawyers } from './lawyers.js';
import { mailInBackground, paymentReviewEmail } from './email.js';

export const LAWYER_REF = 'lawyer:';
export const isLawyerRef = (ref) => String(ref || '').startsWith(LAWYER_REF);
export function parseLawyerRef(ref) {
  const m = /^lawyer:([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$/.exec(String(ref || '').trim().toLowerCase());
  return m ? { firm: m[1], lawyer: m[2] } : null;
}

export function lawyerCheckoutUrl(env, firmSlug, lawyerSlug, email) {
  const base = (env.STRIPE_LAWYER_PAYMENT_LINK || '').trim();
  if (!/^https:\/\/buy\.stripe\.com\//.test(base)) return null;
  const q = `client_reference_id=${encodeURIComponent(`${LAWYER_REF}${firmSlug}:${lawyerSlug}`)}${email ? `&prefilled_email=${encodeURIComponent(email)}` : ''}`;
  return `${base}${base.includes('?') ? '&' : '?'}${q}`;
}

const STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'canceled', canceled: 'canceled', incomplete_expired: 'canceled' };
const iso = (sec) => (Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ') : null);

// Flips `featured` on one lawyer of a firm. Returns true when something changed.
export async function setLawyerFeatured(env, firmSlug, lawyerSlug, value, actor, why) {
  const row = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(firmSlug).first();
  if (!row) return false;
  const firm = JSON.parse(row.data);
  const list = cleanLawyers(firm.lawyers, undefined, null, { stored: true });
  const i = list.findIndex((l) => l.slug === lawyerSlug);
  if (i < 0 || !!list[i].featured === value) return false;
  const next = { ...list[i] };
  if (value) next.featured = true; else delete next.featured;
  list[i] = cleanLawyers([next], undefined, null, { stored: true })[0] || next;
  list[i].slug = lawyerSlug;
  await env.DB.prepare("UPDATE firms SET data = json_set(data, '$.lawyers', json(?)), updated_at = datetime('now') WHERE slug = ?").bind(JSON.stringify(list), firmSlug).run();
  await audit(env, actor, 'firm.lawyer', 'firm', firmSlug, { lawyer: lawyerSlug, changes: { featured: { from: !value, to: value } }, why });
  return true;
}

// Makes a lawyer's Featured flag agree with their subscriptions.
export async function reconcileLawyer(env, firmSlug, lawyerSlug, why) {
  const { results: subs } = await env.DB.prepare('SELECT status, featured_before FROM lawyer_subscriptions WHERE firm_slug = ? AND lawyer_slug = ?').bind(firmSlug, lawyerSlug).all();
  const live = subs.some((s) => s.status === 'active' || s.status === 'past_due'); // past_due keeps it on while Stripe retries the card
  if (live) return setLawyerFeatured(env, firmSlug, lawyerSlug, true, null, why);
  if (!subs.some((s) => s.featured_before === 1) && subs.some((s) => s.status === 'canceled')) return setLawyerFeatured(env, firmSlug, lawyerSlug, false, null, why);
  return false;
}

async function ownerEmails(env, slug) {
  return (await env.DB.prepare("SELECT u.email FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_slug = ? AND m.status = 'approved' AND u.disabled = 0").bind(slug).all()).results.map((r) => r.email.toLowerCase());
}

export async function onLawyerCheckout(env, session, exec, origin) {
  if (session.mode !== 'subscription' || typeof session.subscription !== 'string') return audit(env, null, 'stripe.ignored', 'event', session.id, { reason: 'not a subscription checkout' });
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) return audit(env, null, 'stripe.ignored', 'event', session.id, { reason: 'not paid yet' });
  const email = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
  const ref = parseLawyerRef(session.client_reference_id);
  const firmRow = ref ? await env.DB.prepare("SELECT slug, data FROM firms WHERE slug = ? AND status = 'live'").bind(ref.firm).first() : null;
  const lawyer = firmRow ? cleanLawyers(JSON.parse(firmRow.data).lawyers, undefined, null, { stored: true }).find((l) => l.slug === ref.lawyer) : null;
  const matched = !!(lawyer && email && (await ownerEmails(env, ref.firm)).includes(email));

  const id = session.subscription;
  const existing = await env.DB.prepare('SELECT status FROM lawyer_subscriptions WHERE subscription_id = ?').bind(id).first();
  let status;
  if (existing?.status === 'canceled') status = 'canceled';
  else if (matched) status = existing?.status === 'past_due' ? 'past_due' : 'active';
  else status = 'needs_review';
  await env.DB.prepare(
    `INSERT INTO lawyer_subscriptions (subscription_id, customer_id, firm_slug, lawyer_slug, payer_email, status, amount_cents, currency, featured_before)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (subscription_id) DO UPDATE SET customer_id = excluded.customer_id, firm_slug = excluded.firm_slug, lawyer_slug = excluded.lawyer_slug,
       payer_email = excluded.payer_email, status = excluded.status, amount_cents = COALESCE(lawyer_subscriptions.amount_cents, excluded.amount_cents),
       currency = COALESCE(lawyer_subscriptions.currency, excluded.currency), featured_before = excluded.featured_before, updated_at = datetime('now')`
  ).bind(id, session.customer || null, lawyer ? ref.firm : null, lawyer ? ref.lawyer : null, email || null, status, Number.isFinite(session.amount_total) ? session.amount_total : null, session.currency || null, lawyer?.featured ? 1 : 0).run();
  await audit(env, null, 'stripe.lawyer_checkout', 'firm', ref?.firm || '(none)', { subscription: id, lawyer: ref?.lawyer || null, email, status, matched });

  if (status === 'needs_review') {
    const to = [...adminEmails(env)];
    if (to.length) mailInBackground(env, exec, { to, ...paymentReviewEmail(origin, { email, firmName: lawyer ? `${lawyer.name} (Featured lawyer, ${ref.firm})` : '(no lawyer named)' }) });
    return;
  }
  await reconcileLawyer(env, ref.firm, ref.lawyer, 'lawyer subscription paid');
}

// Returns true when the subscription is a lawyer one (so the firm handler leaves it alone).
export async function onLawyerSubscription(env, sub) {
  const id = sub.id;
  const existing = id && await env.DB.prepare('SELECT status, firm_slug, lawyer_slug FROM lawyer_subscriptions WHERE subscription_id = ?').bind(id).first();
  if (!existing) return false;
  const mapped = STATUS[sub.status];
  if (!mapped) return true;
  const item = sub.items?.data?.[0];
  const periodEnd = iso(sub.current_period_end ?? item?.current_period_end);
  const amount = Number.isFinite(item?.price?.unit_amount) ? item.price.unit_amount * (item.quantity || 1) : null;
  let status = existing.status;
  if (mapped === 'canceled') status = 'canceled';
  else if (mapped === 'past_due' && status === 'active') status = 'past_due';
  else if (mapped === 'active' && status === 'past_due') status = 'active';
  await env.DB.prepare("UPDATE lawyer_subscriptions SET status = ?, period_end = COALESCE(?, period_end), cancel_at_period_end = ?, amount_cents = COALESCE(?, amount_cents), updated_at = datetime('now') WHERE subscription_id = ?")
    .bind(status, periodEnd, sub.cancel_at_period_end || sub.cancel_at ? 1 : 0, amount, id).run();
  if (existing.status !== status) {
    await audit(env, null, 'stripe.lawyer_subscription', 'firm', existing.firm_slug || '(none)', { subscription: id, lawyer: existing.lawyer_slug, from: existing.status, to: status });
    if (existing.firm_slug && existing.lawyer_slug) await reconcileLawyer(env, existing.firm_slug, existing.lawyer_slug, `lawyer subscription ${status}`);
  }
  return true;
}
