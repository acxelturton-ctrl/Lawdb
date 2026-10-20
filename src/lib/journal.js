// The daily journal: one short entry per Toronto day, written every night, holding only what matters.
//   shipped  the pull requests that went live that day (ship_log, written at deploy time by scripts/record-deploy.mjs), at most five
//   numbers  visits, searches and clicks (stats_daily) with the change from the day before
//   people   new enquiries, owner requests and payments
//   wanted   the town people searched for most that has no page
//   problems anything that failed (backup, nightly tidy-up, email)
// A quiet day is one line. The owner can add a note to any day in the admin Journal tab; the nightly job never touches notes.
import { torontoDay } from './stats.js';

const MAX_SHIPPED = 5;

// The two UTC instants between which a Toronto day lies, as 'YYYY-MM-DD HH:MM:SS' (how the database stores times).
export function dayBoundsUtc(day) {
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const [y, m, d] = day.split('-').map(Number);
  for (const offsetHours of [4, 5]) { // EDT, then EST
    const start = Date.UTC(y, m - 1, d, offsetHours, 0, 0);
    if (torontoDay(new Date(start)) === day && torontoDay(new Date(start - 1000)) !== day) return [fmt(start), fmt(start + 86400000)];
  }
  const start = Date.UTC(y, m - 1, d, 5, 0, 0);
  return [fmt(start), fmt(start + 86400000)];
}

const dayBefore = (day) => new Date(new Date(`${day}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

const PROBLEM = { 'backup.failed': 'Backup failed', 'housekeeping.failed': 'Nightly tidy-up failed', 'feeds.failed': 'Blog refresh failed', 'leads.digest_failed': 'Weekly enquiry emails failed', 'mail.failed': 'Some emails failed', 'login.email_failed': 'Sign-in emails failed' };

export async function compileDay(env, day) {
  const [from, to] = dayBoundsUtc(day);
  const prev = dayBefore(day);
  const [shipped, stats, prevStats, enquiries, claims, payments, wanted, problems] = await env.DB.batch([
    env.DB.prepare('SELECT title FROM ship_log WHERE day = ? ORDER BY at, pr').bind(day),
    env.DB.prepare("SELECT kind, SUM(n) AS n FROM stats_daily WHERE day = ? AND kind IN ('visit', 'pv', 'search', 'ev') GROUP BY kind").bind(day),
    env.DB.prepare("SELECT SUM(n) AS n FROM stats_daily WHERE day = ? AND kind = 'visit'").bind(prev),
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ? AND form != 'report-listing'").bind(from, to),
    env.DB.prepare('SELECT COUNT(*) AS n FROM firm_members WHERE created_at >= ? AND created_at < ?').bind(from, to),
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_subscriptions WHERE created_at >= ? AND created_at < ? AND status IN ('active', 'past_due')").bind(from, to),
    env.DB.prepare("SELECT k1, k2, SUM(n) AS n FROM stats_daily WHERE day = ? AND kind = 'town' GROUP BY k1, k2 ORDER BY n DESC LIMIT 1").bind(day),
    env.DB.prepare("SELECT action, COUNT(*) AS n FROM audit_log WHERE at >= ? AND at < ? AND action IN ('backup.failed', 'housekeeping.failed', 'feeds.failed', 'leads.digest_failed', 'mail.failed', 'login.email_failed') GROUP BY action").bind(from, to),
  ]);
  const k = Object.fromEntries(stats.results.map((r) => [r.kind, r.n]));
  const titles = shipped.results.map((r) => r.title);
  const w = wanted.results[0];
  return {
    shipped: titles.slice(0, MAX_SHIPPED),
    moreShipped: Math.max(0, titles.length - MAX_SHIPPED),
    visits: k.visit || 0, pageViews: k.pv || 0, searches: k.search || 0, clicks: k.ev || 0,
    prevVisits: prevStats.results[0]?.n || 0,
    enquiries: enquiries.results[0].n, ownerRequests: claims.results[0].n, payments: payments.results[0].n,
    wanted: w ? { town: w.k1, kase: w.k2 || '' } : null,
    problems: problems.results.map((r) => (PROBLEM[r.action] || r.action) + (r.n > 1 ? ` (${r.n}x)` : '')),
  };
}

const isEmpty = (e) => !e.shipped.length && !e.moreShipped && !e.visits && !e.pageViews && !e.searches && !e.clicks && !e.enquiries && !e.ownerRequests && !e.payments && !e.problems.length;

// Writes yesterday's entry (always recomputed, in case a deploy was recorded late) and any earlier day in the last two weeks that has none.
// A day with nothing at all in it is not written: the journal is for days that had something.
export async function journalNightly(env, now = new Date(), lookback = 14) {
  const yesterday = dayBefore(torontoDay(now)); // the last complete Toronto day, whatever time this runs (03:17 at night, or the owner pressing the button)
  const days = [yesterday];
  for (let i = 1; i < lookback; i++) days.push(torontoDay(new Date(new Date(`${yesterday}T12:00:00Z`).getTime() - i * 86400000)));
  const have = new Set((await env.DB.prepare('SELECT day FROM journal WHERE day >= ?').bind(days[days.length - 1]).all()).results.map((r) => r.day));
  let written = 0;
  for (const day of days) {
    if (day !== yesterday && have.has(day)) continue;
    const entry = await compileDay(env, day);
    if (isEmpty(entry)) continue;
    await env.DB.prepare('INSERT INTO journal (day, body) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET body = excluded.body').bind(day, JSON.stringify(entry)).run();
    written++;
  }
  return written;
}

// What the admin Journal tab shows: today so far (live, not stored, carrying any note already written for today) and the saved days before it, newest first.
export async function journalView(env, limit = 60) {
  const today = torontoDay();
  const [{ results }, live] = await Promise.all([
    env.DB.prepare('SELECT day, body, note FROM journal ORDER BY day DESC LIMIT ?').bind(limit).all(),
    compileDay(env, today),
  ]);
  const mine = results.find((r) => r.day === today);
  return { today: { day: today, note: mine ? mine.note : '', ...live }, entries: results.filter((r) => r.day !== today).map((r) => ({ day: r.day, note: r.note, ...JSON.parse(r.body) })) };
}
