// Stripe Featured subscriptions, driven entirely by Stripe's signed webhooks (no Stripe API key is needed or stored).
//
// - A payment from an approved owner of the firm named in the checkout link makes the firm Featured.
// - A payment we cannot match (different email, no firm named) is parked for the admin; nobody becomes Featured by guesswork.
// - When the subscription ends the firm goes back to Basic, unless it was already Featured before it paid (set by hand).

import { audit } from './audit.js';
import { adminEmails } from './auth.js';
import { mailInBackground, featuredOnEmail, featuredOffEmail, paymentReviewEmail, paymentFailedEmail } from './email.js';

export const FEATURED_PRICE_LABEL = '$199 / month';
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe-Signature: t=<unix seconds>,v1=<hex hmac of "t.body">  (several v1 values may be present)
export async function verifyStripeSignature(rawBody, header, secret, nowMs = Date.now()) {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = (parts.find((p) => p[0] === 't') || [])[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1] || '');
  if (!/^\d{9,12}$/.test(t || '') || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > 300) return false; // too old or too far in the future: could be a replay
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`)));
  return sigs.some((s) => constantTimeEqual(s, mac));
}

// ---------------------------------------------------------------- featured flag
export async function setFeatured(env, slug, value, actor, why) {
  const row = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(slug).first();
  if (!row) return false;
  const firm = JSON.parse(row.data);
  if (!!firm.featured === value) return false;
  firm.featured = value;
  await env.DB.prepare("UPDATE firms SET data = ?, featured = ?, updated_at = datetime('now') WHERE slug = ?").bind(JSON.stringify(firm), value ? 1 : 0, slug).run();
  await audit(env, actor, 'firm.featured', 'firm', slug, { featured: value, why });
  return true;
}

export const ownerEmails = async (env, slug) =>
  (await env.DB.prepare("SELECT u.email FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_slug = ? AND m.status = 'approved' AND u.disabled = 0").bind(slug).all()).results.map((r) => r.email);

// Makes the firm's Featured flag agree with its subscriptions.
export async function reconcileFeatured(env, slug, why) {
  const { results: subs } = await env.DB.prepare('SELECT status, featured_before FROM firm_subscriptions WHERE firm_slug = ?').bind(slug).all();
  const live = subs.some((s) => s.status === 'active' || s.status === 'past_due'); // past_due keeps it on while Stripe retries the card
  const keep = subs.some((s) => s.featured_before === 1);
  if (live) return setFeatured(env, slug, true, null, why);
  if (!keep && subs.some((s) => s.status === 'canceled')) return setFeatured(env, slug, false, null, why);
  return false;
}

// ---------------------------------------------------------------- events
const STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'canceled', canceled: 'canceled', incomplete_expired: 'canceled' };
const iso = (sec) => (Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ') : null);

async function firmName(env, slug) {
  const r = slug && (await env.DB.prepare('SELECT json_extract(data, \'$.name\') AS name FROM firms WHERE slug = ?').bind(slug).first());
  return r ? r.name : slug;
}

async function onCheckoutCompleted(env, session, exec, origin) {
  if (session.mode !== 'subscription' || typeof session.subscription !== 'string') return audit(env, null, 'stripe.ignored', 'event', session.id, { reason: 'not a subscription checkout' });
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) return audit(env, null, 'stripe.ignored', 'event', session.id, { reason: 'not paid yet' });
  const email = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
  const slug = String(session.client_reference_id || '').trim().toLowerCase();
  const firm = slug ? await env.DB.prepare("SELECT slug, featured FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first() : null;
  const matched = !!(firm && email && (await ownerEmails(env, slug)).map((e) => e.toLowerCase()).includes(email));

  const id = session.subscription;
  const existing = await env.DB.prepare('SELECT status FROM firm_subscriptions WHERE subscription_id = ?').bind(id).first();
  let status;
  if (existing?.status === 'canceled') status = 'canceled';
  else if (matched) status = existing?.status === 'past_due' ? 'past_due' : 'active';
  else status = 'needs_review';
  await env.DB.prepare(
    `INSERT INTO firm_subscriptions (subscription_id, customer_id, firm_slug, payer_email, status, amount_cents, currency, featured_before)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (subscription_id) DO UPDATE SET customer_id = excluded.customer_id, firm_slug = excluded.firm_slug, payer_email = excluded.payer_email,
       status = excluded.status, amount_cents = COALESCE(firm_subscriptions.amount_cents, excluded.amount_cents), currency = COALESCE(firm_subscriptions.currency, excluded.currency),
       featured_before = excluded.featured_before, updated_at = datetime('now')`
  ).bind(id, session.customer || null, firm ? slug : null, email || null, status, Number.isFinite(session.amount_total) ? session.amount_total : null, session.currency || null, firm?.featured ? 1 : 0).run();
  await audit(env, null, 'stripe.checkout', 'firm', slug || '(none)', { subscription: id, email, status, matched });

  if (status === 'needs_review') {
    const to = [...adminEmails(env)];
    if (to.length) mailInBackground(env, exec, { to, ...paymentReviewEmail(origin, { email, firmName: firm ? await firmName(env, slug) : '(no firm named)' }) });
    return;
  }
  if (status === 'active' || status === 'past_due') {
    const changed = await reconcileFeatured(env, slug, 'subscription paid');
    const owners = await ownerEmails(env, slug);
    if (changed && owners.length) mailInBackground(env, exec, { to: owners, ...featuredOnEmail(origin, { firmName: await firmName(env, slug) }) });
  }
}

async function onSubscription(env, sub, exec, origin) {
  const id = sub.id;
  const mapped = STATUS[sub.status];
  if (!id || !mapped) return; // 'incomplete' and the like: wait for the real thing
  const item = sub.items?.data?.[0];
  const periodEnd = iso(sub.current_period_end ?? item?.current_period_end);
  const amount = Number.isFinite(item?.price?.unit_amount) ? item.price.unit_amount * (item.quantity || 1) : null;
  const cancelAtEnd = sub.cancel_at_period_end || sub.cancel_at ? 1 : 0;
  const existing = await env.DB.prepare('SELECT status, firm_slug FROM firm_subscriptions WHERE subscription_id = ?').bind(id).first();

  if (!existing) {
    // The checkout event may simply not have arrived yet; keep what we know. It matches the payment to a firm when it does.
    await env.DB.prepare('INSERT INTO firm_subscriptions (subscription_id, customer_id, status, amount_cents, currency, period_end, cancel_at_period_end) VALUES (?,?,?,?,?,?,?)')
      .bind(id, sub.customer || null, mapped === 'canceled' ? 'canceled' : 'needs_review', amount, sub.currency || null, periodEnd, cancelAtEnd).run();
    return;
  }
  let status = existing.status;
  if (mapped === 'canceled') status = 'canceled';
  else if (mapped === 'past_due' && status === 'active') status = 'past_due';
  else if (mapped === 'active' && status === 'past_due') status = 'active';
  await env.DB.prepare("UPDATE firm_subscriptions SET status = ?, period_end = COALESCE(?, period_end), cancel_at_period_end = ?, amount_cents = COALESCE(?, amount_cents), updated_at = datetime('now') WHERE subscription_id = ?")
    .bind(status, periodEnd, cancelAtEnd, amount, id).run();
  if (existing.status !== status) await audit(env, null, 'stripe.subscription', 'firm', existing.firm_slug || '(none)', { subscription: id, from: existing.status, to: status });

  if (existing.firm_slug && existing.status !== status) {
    const changed = await reconcileFeatured(env, existing.firm_slug, `subscription ${status}`);
    const owners = await ownerEmails(env, existing.firm_slug);
    if (changed && status === 'canceled' && owners.length) mailInBackground(env, exec, { to: owners, ...featuredOffEmail(origin, { firmName: await firmName(env, existing.firm_slug) }) });
    if (status === 'past_due') {
      const to = [...new Set([...owners, ...adminEmails(env)])];
      if (to.length) mailInBackground(env, exec, { to, ...paymentFailedEmail(origin, { firmName: await firmName(env, existing.firm_slug) }) });
    }
  }
}

export async function handleStripeEvent(env, event, exec, origin) {
  const obj = event.data?.object;
  if (!obj) return;
  switch (event.type) {
    case 'checkout.session.completed': return onCheckoutCompleted(env, obj, exec, origin);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscription(env, event.type === 'customer.subscription.deleted' ? { ...obj, status: 'canceled' } : obj, exec, origin);
    default: return; // everything else is none of our business
  }
}

// ---------------------------------------------------------------- admin and owner views
export async function listPayments(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.subscription_id AS id, s.firm_slug AS slug, json_extract(f.data, '$.name') AS firmName, s.payer_email AS payerEmail, s.status, s.amount_cents AS amountCents,
            s.currency, s.period_end AS periodEnd, s.cancel_at_period_end AS cancelAtPeriodEnd, s.created_at AS createdAt, s.updated_at AS updatedAt
     FROM firm_subscriptions s LEFT JOIN firms f ON f.slug = s.firm_slug ORDER BY s.created_at DESC LIMIT 200`
  ).all();
  const rows = await Promise.all(results.map(async (r) => ({ ...r, cancelAtPeriodEnd: !!r.cancelAtPeriodEnd, owners: r.slug && r.status === 'needs_review' ? await ownerEmails(env, r.slug) : undefined })));
  const live = rows.filter((r) => r.status === 'active' || r.status === 'past_due');
  return {
    needsReview: rows.filter((r) => r.status === 'needs_review'),
    active: live,
    ended: rows.filter((r) => r.status === 'canceled').slice(0, 20),
    totals: { activeCount: live.length, monthlyCents: live.reduce((n, r) => n + (r.amountCents || 0), 0) },
  };
}

export async function assignPayment(env, actor, id, slug, exec, origin) {
  const sub = await env.DB.prepare("SELECT status FROM firm_subscriptions WHERE subscription_id = ?").bind(id).first();
  if (!sub) return { error: 'Payment not found', status: 404 };
  if (sub.status !== 'needs_review') return { error: 'This payment is not waiting for review.', status: 409 };
  const firm = await env.DB.prepare("SELECT slug, featured FROM firms WHERE slug = ? AND status = 'live'").bind(String(slug || '')).first();
  if (!firm) return { error: 'Choose a listed firm.', status: 422 };
  await env.DB.prepare("UPDATE firm_subscriptions SET firm_slug = ?, status = 'active', featured_before = ?, updated_at = datetime('now') WHERE subscription_id = ?").bind(firm.slug, firm.featured ? 1 : 0, id).run();
  await audit(env, actor, 'payment.assign', 'firm', firm.slug, { subscription: id });
  const changed = await reconcileFeatured(env, firm.slug, 'payment assigned by admin');
  const owners = await ownerEmails(env, firm.slug);
  if (changed && owners.length) mailInBackground(env, exec, { to: owners, ...featuredOnEmail(origin, { firmName: await firmName(env, firm.slug) }) });
  return { ok: true };
}

export async function dismissPayment(env, actor, id) {
  const r = await env.DB.prepare("UPDATE firm_subscriptions SET status = 'dismissed', updated_at = datetime('now') WHERE subscription_id = ? AND status = 'needs_review'").bind(id).run();
  if (!r.meta.changes) return { error: 'This payment is not waiting for review.', status: 409 };
  await audit(env, actor, 'payment.dismiss', 'payment', id);
  return { ok: true };
}

// What an owner sees on their plan card.
export async function planInfo(env, user, slug) {
  const firm = await env.DB.prepare("SELECT featured, status FROM firms WHERE slug = ?").bind(slug).first();
  const sub = await env.DB.prepare("SELECT status, period_end AS periodEnd, cancel_at_period_end AS cancelAtPeriodEnd FROM firm_subscriptions WHERE firm_slug = ? AND status IN ('active','past_due') ORDER BY created_at DESC LIMIT 1").bind(slug).first();
  const featured = !!firm?.featured;
  const base = (env.STRIPE_PAYMENT_LINK || '').trim();
  const upgradeUrl = !featured && firm?.status === 'live' && /^https:\/\/buy\.stripe\.com\//.test(base)
    ? `${base}${base.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(slug)}&prefilled_email=${encodeURIComponent(user.email)}`
    : null;
  const portal = (env.STRIPE_PORTAL_URL || '').trim();
  return {
    featured,
    price: FEATURED_PRICE_LABEL,
    subscription: sub ? { status: sub.status, periodEnd: sub.periodEnd, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd } : null,
    upgradeUrl,
    portalUrl: sub && /^https:\/\//.test(portal) ? portal : null,
  };
}
