// The free month of Featured.
//
// - An approved owner of a live Basic firm can start it once, with one click and no card. The firm becomes Featured straight away.
// - Five days before the end the owners get an email with their own numbers so far. When it ends the firm goes back to Basic (and they get the
//   numbers for the whole month), unless a subscription is running, in which case it simply carries on as a paying Featured firm.
// - The hourly cron (processTrials) does the warning and the ending, a few at a time, so a thousand trials never become one big job.
// - A firm gets one trial, ever. Only the admin can grant another (or a longer one) by hand.
//
// Featured itself is the existing firms.featured flag (setFeatured in stripe.js, which also keeps the audit trail), so every Featured benefit
// works during the trial without any other code knowing about it.
import { HttpError } from './http.js';
import { audit } from './audit.js';
import { sendMail, trialStartedEmail, trialEndingEmail, trialEndedEmail } from './email.js';
import { setFeatured, ownerEmails, FEATURED_PRICE_LABEL } from './stripe.js';
import { torontoDay } from './stats.js';

export const TRIAL_DAYS = 30;
export const WARN_DAYS = 5;
const BATCH = 25; // per hourly run: keeps each run well inside the platform's limits on queries and outgoing mail

const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const parse = (t) => new Date(String(t).replace(' ', 'T') + 'Z');
export const daysLeft = (endsAt, now = new Date()) => Math.max(0, Math.ceil((parse(endsAt).getTime() - now.getTime()) / 86400000));

export async function getTrial(env, slug) {
  return (await env.DB.prepare('SELECT firm_slug AS slug, started_by AS startedBy, source, started_at AS startedAt, ends_at AS endsAt, status, ended_at AS endedAt, views, actions, enquiries FROM firm_trials WHERE firm_slug = ?').bind(slug).first()) || null;
}

// What the firm's page got between two moments (for the emails and for the record when a trial ends).
export async function usageSince(env, slug, startedAt) {
  const day = torontoDay(parse(startedAt));
  const rows = (await env.DB.prepare("SELECT metric, SUM(n) AS n FROM firm_stats_daily WHERE firm_slug = ? AND day >= ? AND metric IN ('pv', 'ev') GROUP BY metric").bind(slug, day).all()).results;
  const leads = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE firm_slug = ? AND status != 'spam' AND created_at >= ?").bind(slug, startedAt).first();
  const get = (m) => rows.find((r) => r.metric === m)?.n || 0;
  return { views: get('pv'), clicks: get('ev'), enquiries: leads?.n || 0 };
}

const firmRow = (env, slug) => env.DB.prepare('SELECT slug, name, featured, status FROM firms WHERE slug = ?').bind(slug).first();

async function mailOwners(env, exec, slug, message) {
  const to = await ownerEmails(env, slug);
  if (!to.length) return 0;
  const send = sendMail(env, { to, ...message }).catch((err) => { console.error('trial mail failed', err); return audit(env, null, 'mail.failed', 'email', to.join(','), { subject: message.subject, error: String(err.message || err).slice(0, 300) }); });
  if (exec) exec(send); else await send;
  return to.length;
}

// Starts (or, for the admin, restarts) the free month. source 'owner' = the owner's own click; 'admin' = given by hand, any length.
// `minutes` is for the tests only (it is ignored unless the Worker runs locally with DEV_ECHO_LINK): a trial of any length, even one that has already run out.
export async function startTrial(env, { slug, actor = null, source = 'owner', days = TRIAL_DAYS, minutes, origin, exec }) {
  const firm = await firmRow(env, slug);
  if (!firm) throw new HttpError(404, 'Firm not found');
  if (firm.status !== 'live') throw new HttpError(409, 'The free month can start once the listing is live.');
  const old = await getTrial(env, slug);
  if (source === 'owner' && old) throw new HttpError(409, old.status === 'active' ? 'Your free month is already running.' : 'This firm has already had its free month.');
  if (firm.featured && old?.status !== 'active') throw new HttpError(409, 'This firm is already Featured.');
  const test = env.DEV_ECHO_LINK === '1' && Number.isFinite(Number(minutes));
  const length = Math.max(1, Math.min(90, Math.floor(Number(days)) || TRIAL_DAYS));
  const now = new Date();
  const endsAt = sqlTime(new Date(now.getTime() + (test ? Number(minutes) * 60000 : length * 86400000)));
  const noWarning = !test && length <= WARN_DAYS ? sqlTime(now) : null; // a short trial would be "ending soon" from the first minute
  await env.DB.prepare(
    `INSERT INTO firm_trials (firm_slug, started_by, source, started_at, ends_at, status, warned_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)
     ON CONFLICT (firm_slug) DO UPDATE SET started_by = excluded.started_by, source = excluded.source, started_at = excluded.started_at, ends_at = excluded.ends_at,
       status = 'active', warned_at = excluded.warned_at, ended_at = NULL, views = NULL, actions = NULL, enquiries = NULL`
  ).bind(slug, actor?.id ?? null, source, sqlTime(now), endsAt, noWarning).run();
  await setFeatured(env, slug, true, actor, 'free trial');
  await audit(env, actor, 'trial.start', 'firm', slug, { source, days: length, endsAt });
  await mailOwners(env, exec, slug, trialStartedEmail(origin || env.SITE_ORIGIN || 'https://lawdb.ca', { firmName: firm.name, slug, endsAt }));
  return getTrial(env, slug);
}

// Ends a running trial now. If a subscription is paying, the firm stays Featured and the trial counts as converted.
export async function endTrial(env, { slug, actor = null, why = 'ended', origin, exec }) {
  const t = await getTrial(env, slug);
  if (!t || t.status !== 'active') return t;
  const firm = await firmRow(env, slug);
  const numbers = await usageSince(env, slug, t.startedAt);
  const paying = !!(await env.DB.prepare("SELECT 1 FROM firm_subscriptions WHERE firm_slug = ? AND status IN ('active','past_due')").bind(slug).first());
  const status = paying ? 'subscribed' : 'ended';
  await env.DB.prepare("UPDATE firm_trials SET status = ?, ended_at = datetime('now'), views = ?, actions = ?, enquiries = ? WHERE firm_slug = ? AND status = 'active'").bind(status, numbers.views, numbers.clicks, numbers.enquiries, slug).run();
  if (!paying) await setFeatured(env, slug, false, actor, 'free trial ended');
  await audit(env, actor, 'trial.end', 'firm', slug, { why, status, ...numbers });
  if (!paying && firm) await mailOwners(env, exec, slug, trialEndedEmail(origin || env.SITE_ORIGIN || 'https://lawdb.ca', { firmName: firm.name, slug, price: FEATURED_PRICE_LABEL, numbers }));
  return getTrial(env, slug);
}

// A payment arrived (see stripe.js): the trial has done its job.
export async function trialConverted(env, slug) {
  await env.DB.prepare("UPDATE firm_trials SET status = 'subscribed', ended_at = datetime('now') WHERE firm_slug = ? AND status = 'active'").bind(slug).run();
}

// The admin changed the Featured flag by hand while a trial was running. Turned on: the firm is Featured for good, so the trial must never switch that off
// later ('kept'). Turned off: the trial is over ('ended'), with no email.
export async function trialAdminChanged(env, slug, nowFeatured) {
  await env.DB.prepare("UPDATE firm_trials SET status = ?, ended_at = datetime('now') WHERE firm_slug = ? AND status = 'active'").bind(nowFeatured ? 'kept' : 'ended', slug).run();
}

// Hourly: end what has run out, warn what is about to.
export async function processTrials(env) {
  const origin = env.SITE_ORIGIN || 'https://lawdb.ca';
  const out = { ended: 0, warned: 0, failed: 0 };
  const due = (await env.DB.prepare("SELECT firm_slug AS slug FROM firm_trials WHERE status = 'active' AND ends_at <= datetime('now') ORDER BY ends_at LIMIT ?").bind(BATCH).all()).results;
  for (const { slug } of due) {
    try { await endTrial(env, { slug, why: 'time is up', origin }); out.ended++; } catch (err) { out.failed++; console.error('ending a trial failed', slug, err); }
  }
  const soon = (await env.DB.prepare(
    `SELECT t.firm_slug AS slug, t.started_at AS startedAt, t.ends_at AS endsAt, f.name FROM firm_trials t JOIN firms f ON f.slug = t.firm_slug
     WHERE t.status = 'active' AND t.warned_at IS NULL AND t.ends_at > datetime('now') AND t.ends_at <= datetime('now', ?) ORDER BY t.ends_at LIMIT ?`
  ).bind(`+${WARN_DAYS} days`, BATCH).all()).results;
  for (const t of soon) {
    try {
      await env.DB.prepare("UPDATE firm_trials SET warned_at = datetime('now') WHERE firm_slug = ?").bind(t.slug).run(); // first, so a mail problem can never mean a second email
      await mailOwners(env, null, t.slug, trialEndingEmail(origin, { firmName: t.name, slug: t.slug, endsAt: t.endsAt, daysLeft: daysLeft(t.endsAt), price: FEATURED_PRICE_LABEL, numbers: await usageSince(env, t.slug, t.startedAt) }));
      out.warned++;
    } catch (err) { out.failed++; console.error('trial warning failed', t.slug, err); }
  }
  if (out.ended || out.warned || out.failed) await audit(env, null, 'trial.run', 'system', 'hourly', out);
  return out;
}

// Numbers for the admin: how many are running, how many end soon, how many turned into subscriptions.
export async function trialFunnel(env) {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(status = 'active'), 0) AS active,
            COALESCE(SUM(status = 'active' AND ends_at <= datetime('now', '+7 days')), 0) AS endingSoon,
            COALESCE(SUM(status = 'ended'), 0) AS ended,
            COALESCE(SUM(status = 'subscribed'), 0) AS subscribed,
            COUNT(*) AS total
     FROM firm_trials`
  ).first();
  const finished = r.ended + r.subscribed;
  return { ...r, conversion: finished ? Math.round((r.subscribed / finished) * 100) : null };
}
