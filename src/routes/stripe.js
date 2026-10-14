// POST /api/stripe/webhook: Stripe tells us about payments and subscriptions. Every request must carry Stripe's signature
// (checked with STRIPE_WEBHOOK_SECRET); anything else is refused. Each event is applied once, however often Stripe repeats it.

import { json } from '../lib/http.js';
import { verifyStripeSignature, handleStripeEvent } from '../lib/stripe.js';

export async function webhook({ request, env, url, exec }) {
  const secret = (env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) return json({ error: 'Payments are not configured.' }, 503);
  const raw = await request.text();
  if (raw.length > 1_000_000) return json({ error: 'Too large' }, 413);
  if (!(await verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret))) return json({ error: 'Bad signature' }, 400);

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return json({ error: 'Bad event' }, 400);

  const first = await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)').bind(event.id, event.type).run();
  if (!first.meta.changes) return json({ ok: true, duplicate: true });
  try {
    await handleStripeEvent(env, event, exec, env.SITE_ORIGIN || url.origin);
  } catch (err) {
    console.error('stripe event failed', event.type, event.id, err);
    await env.DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(event.id).run(); // let Stripe retry it
    return json({ error: 'Processing failed' }, 500);
  }
  return json({ ok: true });
}
