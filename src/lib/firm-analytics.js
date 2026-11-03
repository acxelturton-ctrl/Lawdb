// A firm's own analytics: what the firm's page got, what visitors did on it, where they came from. Read from firm_stats_daily (migration 0038),
// which holds only that firm's rows, so a report costs the same whether the site has 100 firms or 10,000.
//
// Nothing here knows a person: views and clicks are counted, never who clicked. A "visitor" is one browser-tab visit that looked at the page
// (the page script remembers it in a note that disappears when the tab closes), so it is a good measure of people, but not a head count.
import { torontoDay, FIRM_ACTIONS } from './stats.js';

export const RANGES = [7, 30, 90];

export const ACTION_LABELS = {
  call: 'Called', message: 'Opened the message form', email: 'Emailed', website: 'Visited your website', directions: 'Got directions',
  reviews: 'Read your Google reviews', book: 'Booked a call', 'book-locked': 'Tried to book a call', follow: 'Followed you', rate: 'Opened the LawDB rating',
  blog: 'Read your articles', 'social-facebook': 'Went to your Facebook', 'social-instagram': 'Went to your Instagram', 'social-linkedin': 'Went to your LinkedIn',
  'social-x': 'Went to your X', 'social-youtube': 'Went to your YouTube',
};
// The clicks that show someone wants to reach the firm. They count towards the "contact actions" headline.
export const CONTACT_ACTIONS = ['call', 'message', 'email', 'website', 'directions', 'book'];

const PROVINCES = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' };
const SOURCE_NAMES = { direct: 'Direct (typed or bookmarked)', lawdb: 'Browsing LawDB', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', reddit: 'Reddit', youtube: 'YouTube' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const regionName = (k) => {
  const [country, region] = String(k).split('|');
  if (country === 'CA') return region ? PROVINCES[region] || `Canada (${region})` : 'Canada';
  if (country === '??' || !country) return 'Somewhere else';
  return country === 'US' ? 'United States' : country;
};

const addDays = (day, n) => torontoDay(new Date(new Date(day + 'T12:00:00Z').getTime() + n * 86400000));

// Every Toronto day from `from` to `to`, oldest first.
export function dayList(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null); // null: nothing to compare with

// rows: [{ day, metric, k, n }] for the period and the one before it. leadDays: Toronto days of the enquiries received.
export function buildReport({ rows, leadDays = [], from, to, days }) {
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days);
  const list = dayList(from, to);
  const cur = { views: 0, visitors: 0, clicks: 0, contact: 0, enquiries: 0 };
  const prev = { views: 0, visitors: 0, clicks: 0, contact: 0, enquiries: 0 };
  const byDay = new Map(list.map((d) => [d, { day: d, views: 0, visitors: 0, clicks: 0, enquiries: 0 }]));
  const prevList = dayList(prevFrom, prevTo);
  const prevDay = new Map(prevList.map((d) => [d, { day: d, views: 0, visitors: 0, clicks: 0, enquiries: 0 }]));
  const actions = new Map(); // key -> { n, prev }
  const labels = { ref: new Map(), dev: new Map(), geo: new Map(), utm: new Map() };
  let first = null;

  for (const r of rows) {
    const inCur = r.day >= from && r.day <= to;
    const inPrev = r.day >= prevFrom && r.day <= prevTo;
    if (!inCur && !inPrev) continue;
    if (r.metric === 'pv' && (first === null || r.day < first)) first = r.day;
    const t = inCur ? cur : prev;
    const row = (inCur ? byDay : prevDay).get(r.day);
    if (r.metric === 'pv') { t.views += r.n; row.views += r.n; }
    else if (r.metric === 'visitor') { t.visitors += r.n; row.visitors += r.n; }
    else if (r.metric === 'ev') {
      t.clicks += r.n;
      if (CONTACT_ACTIONS.includes(r.k)) t.contact += r.n;
      row.clicks += r.n;
      const a = actions.get(r.k) || { n: 0, prev: 0 };
      if (inCur) a.n += r.n; else a.prev += r.n;
      actions.set(r.k, a);
    } else if (inCur && labels[r.metric]) labels[r.metric].set(r.k, (labels[r.metric].get(r.k) || 0) + r.n);
  }
  for (const d of leadDays) {
    if (d >= from && d <= to) { cur.enquiries++; byDay.get(d).enquiries++; }
    else if (d >= prevFrom && d <= prevTo) { prev.enquiries++; prevDay.get(d).enquiries++; }
  }

  const ranked = (map, name, limit = 8) => {
    const all = [...map].map(([k, n]) => ({ key: k, label: name(k), n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    const total = all.reduce((s, x) => s + x.n, 0);
    const head = all.slice(0, limit);
    const rest = all.slice(limit).reduce((s, x) => s + x.n, 0);
    if (rest) head.push({ key: 'other', label: 'Other', n: rest });
    return { total, items: head.map((x) => ({ ...x, share: total ? Math.round((x.n / total) * 100) : 0 })) };
  };

  const series = list.map((d) => byDay.get(d));
  const weekdays = WEEKDAYS.map((name, dow) => ({ dow, name, views: 0, days: 0 }));
  for (const s of series) { const w = weekdays[new Date(s.day + 'T12:00:00Z').getUTCDay()]; w.views += s.views; w.days++; }
  const best = series.reduce((b, s) => (s.views > (b?.views ?? -1) ? s : b), null);

  const actionList = FIRM_ACTIONS.filter((k) => k !== 'book-locked' || actions.get(k)?.n)
    .map((k) => ({ key: k, label: ACTION_LABELS[k] || k, n: actions.get(k)?.n || 0, prev: actions.get(k)?.prev || 0, contact: CONTACT_ACTIONS.includes(k), delta: pct(actions.get(k)?.n || 0, actions.get(k)?.prev || 0) }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const maxAction = actionList[0]?.n || 0;
  for (const a of actionList) {
    a.share = cur.clicks ? Math.round((a.n / cur.clicks) * 100) : 0;
    a.bar = maxAction ? Math.round((a.n / maxAction) * 100) : 0;
  }

  const totals = { ...cur, clickRate: cur.visitors ? Math.round((cur.clicks / cur.visitors) * 100) : null, contactRate: cur.visitors ? Math.round((cur.contact / cur.visitors) * 100) : null };
  const report = {
    from, to, days, since: first,
    totals, previous: prev,
    change: { views: pct(cur.views, prev.views), visitors: pct(cur.visitors, prev.visitors), clicks: pct(cur.clicks, prev.clicks), contact: pct(cur.contact, prev.contact), enquiries: pct(cur.enquiries, prev.enquiries) },
    series,
    previousSeries: prevList.map((d) => prevDay.get(d)), // same length as `series`, day for day, for the dashed comparison line
    actions: actionList,
    sources: ranked(labels.ref, (k) => SOURCE_NAMES[k] || k),
    devices: ranked(labels.dev, (k) => (k === 'mobile' ? 'Phone' : 'Computer or tablet')),
    regions: ranked(labels.geo, regionName),
    campaigns: ranked(labels.utm, (k) => k, 5),
    weekdays: weekdays.map(({ dow, name, views, days: n }) => ({ dow, name, views, average: n ? Math.round((views / n) * 10) / 10 : 0 })),
    best: best && best.views > 0 ? { day: best.day, views: best.views } : null,
  };
  report.insights = insightsFor(report);
  return report;
}

// Plain-language findings. Each is a sentence the firm can act on; at most five, strongest first.
export function insightsFor(r) {
  const out = [];
  const t = r.totals;
  if (!t.views) return [r.since ? 'Nobody looked at your page in this period. Sharing the link to your LawDB page on your website and email signature is the quickest way to change that.' : 'Your page has not been viewed yet, or it has not been counted yet. Numbers appear here within a minute of the first visit.'];
  if (r.change.views !== null && Math.abs(r.change.views) >= 15 && t.views + r.previous.views >= 20) out.push(`Page views are ${r.change.views > 0 ? 'up' : 'down'} ${Math.abs(r.change.views)}% on the ${r.days} days before.`);
  const top = r.actions.find((a) => a.n > 0 && a.key !== 'follow' && a.key !== 'book-locked');
  if (top) out.push(`${top.label} was the most common action: ${top.n} ${top.n === 1 ? 'time' : 'times'}${t.clicks ? ` (${top.share}% of clicks)` : ''}.`);
  if (t.visitors >= 10 && t.contact === 0) out.push('Nobody has called, messaged or used your website link yet. Check that your phone number, website and booking link are filled in and up to date.');
  else if (t.contactRate !== null && t.visitors >= 10) out.push(`${t.contactRate} in every 100 visitors called, messaged, emailed or went to your website.`);
  const phone = r.devices.items.find((d) => d.key === 'mobile');
  if (phone && r.devices.total >= 10 && phone.share >= 60) out.push(`${phone.share}% of views were on a phone, so your phone number and the Message button are what most visitors see first.`);
  const src = r.sources.items[0];
  if (src && r.sources.total >= 10 && src.share >= 35) out.push(`${src.label === 'Google' ? 'Google' : src.label} sent the most visitors (${src.share}%).`);
  const busy = [...r.weekdays].sort((a, b) => b.views - a.views)[0];
  if (busy && busy.views >= 10 && r.days >= 28) out.push(`${busy.name} is your busiest day.`);
  return out.slice(0, 5);
}

// The numbers a Basic firm sees: the last 30 days in three figures, enough to show what it is missing, none of the detail.
export async function lockedSummary(env, slug) {
  const from = torontoDay(new Date(Date.now() - 29 * 86400000));
  const rows = (await env.DB.prepare("SELECT metric, SUM(n) AS n FROM firm_stats_daily WHERE firm_slug = ? AND day >= ? AND metric IN ('pv', 'visitor', 'ev') GROUP BY metric").bind(slug, from).all()).results;
  const get = (m) => rows.find((r) => r.metric === m)?.n || 0;
  const leads = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE firm_slug = ? AND status != 'spam' AND created_at >= datetime('now', '-30 days')").bind(slug).first();
  return { days: 30, views: get('pv'), visitors: get('visitor'), clicks: get('ev'), enquiries: leads?.n || 0 };
}

// Reads the rows and builds the report.
export async function firmAnalytics(env, slug, days) {
  if (!RANGES.includes(days)) days = 30;
  const to = torontoDay();
  const from = addDays(to, -(days - 1));
  const prevFrom = addDays(from, -days);
  const [stats, leads] = await env.DB.batch([
    env.DB.prepare('SELECT day, metric, k, n FROM firm_stats_daily WHERE firm_slug = ? AND day >= ? AND day <= ?').bind(slug, prevFrom, to),
    env.DB.prepare("SELECT created_at FROM leads WHERE firm_slug = ? AND status != 'spam' AND created_at >= datetime('now', ?) LIMIT 5000").bind(slug, `-${days * 2 + 1} days`),
  ]);
  const leadDays = leads.results.map((l) => torontoDay(new Date(l.created_at.replace(' ', 'T') + 'Z')));
  return buildReport({ rows: stats.results, leadDays, from, to, days });
}

// A spreadsheet opens "=cmd..." cells as formulas; nothing here starts like one, but the labels go through the same guard as the enquiries export.
const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
export function analyticsCsv(report, firmName) {
  const head = ['Day', 'Page views', 'Visitors', 'Button clicks', 'Enquiries'];
  const lines = report.series.map((s) => [s.day, s.views, s.visitors, s.clicks, s.enquiries].map(cell).join(','));
  const buttons = ['', '"Button"', '"Clicks"', '"Share of clicks"'].join(',');
  const acts = report.actions.filter((a) => a.n > 0).map((a) => ['', a.label, a.n, a.share + '%'].map(cell).join(','));
  return '﻿' + [`${cell(firmName)},${cell(`${report.from} to ${report.to}`)}`, head.map(cell).join(','), ...lines, '', buttons, ...acts].join('\r\n') + '\r\n';
}
