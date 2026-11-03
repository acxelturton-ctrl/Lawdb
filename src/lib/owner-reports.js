// The weekly "your week on LawDB" email for every firm owner: page views, visitors, button clicks and enquiries of the last 7 days.
//
// It goes out on Monday from 9 am Toronto time and carries on hourly, 90 owners a time, until everyone has had theirs (firm_members.report_at
// remembers who has). Each batch reads all its firms' numbers in three queries, so a thousand owners cost a few dozen queries, not thousands.
// Owners can switch it off on the Analytics page (firm_members.reports_off); a firm nobody looked at gets no email.
import { sendMail, weeklyReportEmail } from './email.js';
import { audit } from './audit.js';
import { torontoDay } from './stats.js';
import { ACTION_LABELS } from './firm-analytics.js';
import { daysLeft } from './trial.js';
import { FEATURED_PRICE_LABEL } from './stripe.js';

const BATCH = 90; // also stays under the 100 values a statement may bind

// The most recent Monday, 13:00 UTC (9 am in Toronto in summer, 8 am in winter), at or before `now`.
export function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 0, 0));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (d > now) d.setUTCDate(d.getUTCDate() - 7);
  return d;
}
const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

export async function sendWeeklyReports(env, now = new Date()) {
  const start = weekStart(now);
  const local = env.DEV_ECHO_LINK === '1'; // running for tests: any day, so the whole thing can be checked
  if (!local && now < start) return { skipped: 'too early' };
  const mark = sqlTime(start); // "already had this week's" means report_at is this Monday's start or later
  const members = (await env.DB.prepare(
    `SELECT m.id, m.firm_slug AS slug, u.email, f.name, f.featured, t.ends_at AS trialEnds
     FROM firm_members m JOIN users u ON u.id = m.user_id JOIN firms f ON f.slug = m.firm_slug
          LEFT JOIN firm_trials t ON t.firm_slug = f.slug AND t.status = 'active'
     WHERE m.status = 'approved' AND u.disabled = 0 AND f.status = 'live' AND m.reports_off = 0 AND (m.report_at IS NULL OR m.report_at < ?)
     ORDER BY m.id LIMIT ?`
  ).bind(mark, local ? 1000 : BATCH).all()).results;
  if (!members.length) return { sent: 0, failed: 0, remaining: 0 };

  const today = torontoDay(now);
  const day = (n) => torontoDay(new Date(now.getTime() - n * 86400000));
  const curFrom = day(7), curTo = local ? today : day(1), prevFrom = day(14); // the last 7 complete days (locally, today too, so a test can see its own numbers)
  const slugs = [...new Set(members.map((m) => m.slug))];
  const stats = new Map(); // slug -> { views, previousViews, visitors, clicks, enquiries, actions: Map }
  const get = (slug) => { if (!stats.has(slug)) stats.set(slug, { views: 0, previousViews: 0, visitors: 0, clicks: 0, enquiries: 0, actions: new Map() }); return stats.get(slug); };
  for (let i = 0; i < slugs.length; i += BATCH) {
    const part = slugs.slice(i, i + BATCH);
    const marks = part.map(() => '?').join(',');
    const [rows, leads] = await env.DB.batch([
      env.DB.prepare(`SELECT firm_slug AS slug, day, metric, k, n FROM firm_stats_daily WHERE firm_slug IN (${marks}) AND day >= ? AND day <= ? AND metric IN ('pv', 'visitor', 'ev')`).bind(...part, prevFrom, today),
      env.DB.prepare(`SELECT firm_slug AS slug, COUNT(*) AS n FROM leads WHERE firm_slug IN (${marks}) AND status != 'spam' AND created_at >= datetime('now', '-7 days') GROUP BY firm_slug`).bind(...part),
    ]);
    for (const r of rows.results) {
      const s = get(r.slug);
      if (r.day >= curFrom && r.day <= curTo) {
        if (r.metric === 'pv') s.views += r.n;
        else if (r.metric === 'visitor') s.visitors += r.n;
        else { s.clicks += r.n; s.actions.set(r.k, (s.actions.get(r.k) || 0) + r.n); }
      } else if (r.day >= prevFrom && r.day < curFrom && r.metric === 'pv') s.previousViews += r.n;
    }
    for (const l of leads.results) get(l.slug).enquiries = l.n;
  }

  let sent = 0, failed = 0;
  const origin = env.SITE_ORIGIN || 'https://lawdb.ca';
  for (const m of members) {
    const s = get(m.slug);
    if (!s.views) continue; // nothing to report
    const best = [...s.actions].filter(([k]) => k !== 'follow' && k !== 'book-locked').sort((a, b) => b[1] - a[1])[0];
    try {
      await sendMail(env, { to: m.email, ...weeklyReportEmail(origin, {
        firmName: m.name, slug: m.slug, featured: !!m.featured, price: FEATURED_PRICE_LABEL,
        trialDaysLeft: m.trialEnds ? daysLeft(m.trialEnds, now) : null,
        n: { views: s.views, previousViews: s.previousViews, visitors: s.visitors, clicks: s.clicks, enquiries: s.enquiries },
        top: best ? { label: ACTION_LABELS[best[0]] || best[0], n: best[1] } : null,
      }) });
      sent++;
    } catch (err) { failed++; console.error('weekly report email failed', m.slug, err); }
  }
  // Everyone in the batch is marked, even those with nothing to report, so the next hourly run moves on to the next owners.
  const ids = members.map((m) => m.id);
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH);
    await env.DB.prepare(`UPDATE firm_members SET report_at = ? WHERE id IN (${part.map(() => '?').join(',')})`).bind(mark, ...part).run();
  }
  await audit(env, null, 'reports.weekly', 'system', mark, { sent, failed, owners: members.length });
  return { sent, failed, owners: members.length };
}
