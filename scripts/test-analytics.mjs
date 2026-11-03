// A firm's analytics: what is counted for a firm's own page, how the counts are written in batches, how the dashboard's numbers are worked out, and
// the weekly email. (The end-to-end part, real beacons into a running Worker and the owner's dashboard, is in smoke.mjs.)
import { firmIncs, FIRM_ACTIONS, EVENTS } from '../src/lib/stats.js';
import { countInBackground, flush, pendingCounts } from '../src/lib/stats-buffer.js';
import { buildReport, insightsFor, dayList, analyticsCsv, regionName, CONTACT_ACTIONS } from '../src/lib/firm-analytics.js';
import { weekStart } from '../src/lib/owner-reports.js';
import { trialStartedEmail, trialEndingEmail, trialEndedEmail, weeklyReportEmail } from '../src/lib/email.js';
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- what is counted for one firm
const geo = { country: 'CA', region: 'ON' };
ok(same(firmIncs({ t: 'pv', p: '/firms/a-law', m: 1, s: 0, v: 0 }, geo), [['a-law', 'pv', ''], ['a-law', 'dev', 'mobile']]), 'a page view of a firm adds a view and the device; nothing else when it is not a first look');
const first = firmIncs({ t: 'pv', p: '/firms/a-law/', m: 0, s: 1, v: 1, r: 'www.google.ca', u: 'Spring' }, geo);
ok(same(first, [['a-law', 'pv', ''], ['a-law', 'dev', 'desktop'], ['a-law', 'entry', ''], ['a-law', 'visitor', ''], ['a-law', 'ref', 'google'], ['a-law', 'geo', 'CA|ON'], ['a-law', 'utm', 'spring']]), 'the first look in a tab also counts a visitor, where from, the region and a campaign');
ok(firmIncs({ t: 'pv', p: '/firms/a-law', s: 1, v: 1 }, geo).some((x) => x[1] === 'ref' && x[2] === 'direct') && firmIncs({ t: 'pv', p: '/firms/a-law', s: 0, v: 1 }, geo).some((x) => x[1] === 'ref' && x[2] === 'lawdb'), 'no referrer is "direct" at the start of a visit and "lawdb" (browsing the directory) in the middle of one');
ok(firmIncs({ t: 'pv', p: '/firms/a-law', s: 0, v: 1 }, { country: 'US' }).some((x) => x[1] === 'geo' && x[2] === 'US') && firmIncs({ t: 'pv', p: '/firms/a-law', s: 0, v: 1 }, {}).some((x) => x[1] === 'geo' && x[2] === '??'), 'a region outside Canada is the country; an unknown one is "??"');
ok(same(firmIncs({ t: 'ev', e: 'call', p: '/firms/a-law' }), [['a-law', 'ev', 'call']]) && same(firmIncs({ t: 'ev', e: 'social-linkedin', p: '/firms/a-law' }), [['a-law', 'ev', 'social-linkedin']]), 'a click on one of the firm\'s buttons is counted for the firm');
ok(firmIncs({ t: 'ev', e: 'cta-featured', p: '/firms/a-law' }).length === 0 && firmIncs({ t: 'ev', e: 'claim', p: '/firms/a-law' }).length === 0 && firmIncs({ t: 'ev', e: 'delete-all', p: '/firms/a-law' }).length === 0, 'the buttons that sell Featured, and made-up names, are not part of a firm\'s numbers');
ok(['/', '/ontario/toronto', '/firms/', '/firms/a/b', '/firms/<x>', '/firms/A_B', 'firms/a-law', null, 5].every((p) => firmIncs({ t: 'pv', p, v: 1 }, geo).length === 0 || p === '/firms/A_B'), 'only a firm page address counts for a firm');
ok(firmIncs({ t: 'pv', p: '/firms/A-Law?x=1#y' }, geo)[0][0] === 'a-law' && firmIncs(null).length === 0 && firmIncs('x').length === 0 && firmIncs({ t: 'search', p: '/firms/a-law' }).length === 0, 'addresses are tidied; odd input counts nothing');
ok(!JSON.stringify(firmIncs({ t: 'pv', p: '/firms/a-law', s: 1, v: 1, ip: '1.2.3.4', ua: 'secret', email: 'a@b.com', id: 'abc' }, geo)).match(/1\.2\.3\.4|secret|a@b\.com|abc/), 'anything else in a message (an address, browser details, an id) is ignored and never stored');
ok(FIRM_ACTIONS.every((a) => EVENTS.has(a)) && CONTACT_ACTIONS.every((a) => FIRM_ACTIONS.includes(a)), 'every button a firm sees is a known click name');

// ---- writing in batches
{
  const batches = [];
  const known = new Set(['a-law', 'b-law']);
  const env = { DB: {
    prepare: (sql) => ({ sql, bind: (...a) => ({ sql, a }), all: async () => ({ results: [] }) }),
    batch: async (st) => { batches.push(st); return st.map(() => ({ meta: { changes: 1 } })); },
  } };
  // the only database read is "which of these firms exist"
  env.DB.prepare = (sql) => ({ sql, bind: (...a) => ({ sql, a, all: async () => ({ results: a.filter((x) => known.has(x)).map((slug) => ({ slug })) }) }) });
  const exec = (p) => p;
  await flush(env); // start empty
  for (let i = 0; i < 500; i++) await countInBackground({ ...env, STATS_FLUSH_MS: '60000' }, exec, '2026-11-03', [['pv', '/firms/a-law', '']], [['a-law', 'pv', '']]);
  await countInBackground({ ...env, STATS_FLUSH_MS: '60000' }, exec, '2026-11-03', [['pv', '/firms/ghost', '']], [['ghost', 'pv', '']]);
  ok(pendingCounts() === 4, '501 page views waiting to be written are 4 counters (two for the busy page, two for the page nobody lists), not 501 rows');
  const n = await flush(env);
  ok(n === 4 && batches.length === 1, 'they go to the database in one batch');
  const st = batches[0];
  ok(st.length === 2 && /INSERT INTO stats_daily/.test(st[0].sql) && /INSERT INTO firm_stats_daily/.test(st[1].sql) && /DO UPDATE SET n = n \+ excluded\.n/.test(st[0].sql + st[1].sql), 'one multi-row "add to the counter" statement for the site and one for the firms');
  ok(st[0].a.includes(500) && st[1].a.includes(500) && !st[1].a.includes('ghost'), 'the 500 views are written as +500, and a firm that does not exist gets no row');
  ok(pendingCounts() === 0 && (await flush(env)) === 0 && batches.length === 1, 'flushing again with nothing waiting writes nothing');
  // 45 different counters: 20 rows per statement
  for (let i = 0; i < 45; i++) await countInBackground({ ...env, STATS_FLUSH_MS: '60000' }, exec, '2026-11-03', [['pv', `/page-${i}`, '']]);
  await flush(env);
  ok(batches[1].length === 3 && batches[1].every((s) => s.a.length <= 100), '45 different counters are 3 statements of at most 20 rows (the database accepts 100 values in one)');
  // while running locally the counts are written at once so a test can read them
  const calls = [];
  const local = { ...env, DEV_ECHO_LINK: '1' };
  await countInBackground(local, (p) => calls.push(p), '2026-11-03', [['pv', '/x', '']]);
  ok(calls.length === 1 && pendingCounts() === 0 || (await Promise.all(calls), pendingCounts() === 0), 'when running locally for tests the counts are written straight away');
}

// ---- the numbers of the dashboard
const to = '2026-11-03';
const from = '2026-10-28'; // 7 days
const rows = [];
const add = (day, metric, k, n) => rows.push({ day, metric, k, n });
for (const d of dayList(from, to)) { add(d, 'pv', '', 10); add(d, 'visitor', '', 6); add(d, 'dev', 'mobile', 6); add(d, 'dev', 'desktop', 4); }
add('2026-10-30', 'ev', 'call', 5); add('2026-10-31', 'ev', 'call', 3); add('2026-10-30', 'ev', 'website', 4); add('2026-10-29', 'ev', 'follow', 2); add('2026-10-29', 'ev', 'social-linkedin', 1);
add('2026-10-30', 'ref', 'google', 20); add('2026-10-30', 'ref', 'direct', 10); add('2026-10-30', 'ref', 'lawdb', 5);
add('2026-10-30', 'geo', 'CA|ON', 18); add('2026-10-30', 'geo', 'CA|QC', 5); add('2026-10-30', 'geo', 'US', 2);
// the 7 days before: half as busy
for (const d of dayList('2026-10-21', '2026-10-27')) { add(d, 'pv', '', 5); add(d, 'visitor', '', 3); }
add('2026-10-22', 'ev', 'call', 2);
const r = buildReport({ rows, leadDays: ['2026-10-30', '2026-10-30', '2026-10-31', '2026-10-25'], from, to, days: 7 });
ok(dayList(from, to).length === 7 && r.series.length === 7 && r.previousSeries.length === 7 && r.series[0].day === from && r.series[6].day === to && r.previousSeries[0].day === '2026-10-21', 'the chart has one point per day, and the same number of points for the period before');
ok(r.totals.views === 70 && r.totals.visitors === 42 && r.totals.clicks === 15 && r.totals.contact === 12 && r.totals.enquiries === 3, 'totals: views, visitors, button clicks, contact clicks and enquiries add up');
ok(r.previous.views === 35 && r.previous.visitors === 21 && r.previous.clicks === 2 && r.previous.enquiries === 1, 'the period before is worked out the same way');
ok(r.change.views === 100 && r.change.clicks === 650 && r.change.enquiries === 200, 'changes are percentages against the period before');
ok(buildReport({ rows: [], leadDays: [], from, to, days: 7 }).change.views === null, 'with nothing to compare with there is no percentage, only "new"');
ok(r.actions[0].key === 'call' && r.actions[0].n === 8 && r.actions[0].share === 53 && r.actions[0].contact && r.actions[0].delta === 300, 'the buttons are ranked, with their share of all clicks and their change');
ok(r.actions.find((a) => a.key === 'follow').n === 2 && !r.actions.find((a) => a.key === 'follow').contact && !r.actions.some((a) => a.key === 'book-locked'), 'engagement buttons are listed too, and flagged apart from contact buttons; the locked booking button is hidden until used');
ok(r.sources.items[0].key === 'google' && r.sources.items[0].share === 57 && r.sources.items[0].label === 'Google' && r.sources.items.find((s) => s.key === 'lawdb').label.startsWith('Browsing LawDB'), 'sources are named in plain words with their share');
ok(r.devices.items.find((d) => d.key === 'mobile').share === 60 && r.devices.total === 70, 'phone and computer shares');
ok(r.regions.items[0].label === 'Ontario' && r.regions.items[1].label === 'Quebec' && r.regions.items[2].label === 'United States', 'regions are named in words');
ok(regionName('CA|XX') === 'Canada (XX)' && regionName('??') === 'Somewhere else' && regionName('FR') === 'FR', 'unknown regions never break the page');
ok(r.weekdays.length === 7 && r.weekdays.reduce((s, d) => s + d.views, 0) === 70 && r.best && r.best.views === 10, 'busiest days add up to the views');
ok(r.insights.length >= 2 && r.insights.length <= 5 && r.insights.some((t) => /up 100%/.test(t)) && r.insights.some((t) => /Called/.test(t)), 'the plain-language findings mention the change and the favourite button');
ok(insightsFor(buildReport({ rows: [], leadDays: [], from, to, days: 7 }))[0].includes('not been viewed yet'), 'a brand-new page gets a calm first message, not zeros');
{
  const quiet = buildReport({ rows: dayList(from, to).flatMap((d) => [{ day: d, metric: 'pv', k: '', n: 4 }, { day: d, metric: 'visitor', k: '', n: 3 }]), leadDays: [], from, to, days: 7 });
  ok(quiet.insights.some((t) => /Nobody has called/.test(t)), 'visitors without any contact click are told to check their phone, website and booking link');
}
ok(!rows.some((x) => 'ip' in x || 'user' in x) && !JSON.stringify(r).match(/ip|cookie|visitorId/i), 'the report holds counts only, nothing about a person');

// ---- the spreadsheet
{
  const csv = analyticsCsv(r, '=HYPERLINK("x")');
  ok(csv.startsWith('﻿"\'=HYPERLINK') && csv.split('\r\n').length > 10 && /"Called","8","53%"/.test(csv), 'the spreadsheet export is safe against formulas and lists each day and button');
}

// ---- the weekly email: Monday 9 am Toronto time (13:00 UTC), then hourly until everyone has had theirs
ok(weekStart(new Date('2026-11-03T15:00:00Z')).toISOString() === '2026-11-02T13:00:00.000Z', 'Tuesday afternoon: this week started on Monday 13:00 UTC');
ok(weekStart(new Date('2026-11-02T12:59:00Z')).toISOString() === '2026-10-26T13:00:00.000Z', 'Monday before 13:00 UTC still belongs to last week\'s round');
ok(weekStart(new Date('2026-11-02T13:00:00Z')).toISOString() === '2026-11-02T13:00:00.000Z' && weekStart(new Date('2026-11-08T23:00:00Z')).toISOString() === '2026-11-02T13:00:00.000Z', 'Monday 13:00 UTC to the following Monday is one round');

// ---- email wording
{
  const o = 'https://lawdb.ca';
  const started = trialStartedEmail(o, { firmName: 'A Law', slug: 'a-law', endsAt: '2026-12-03 15:00:00' });
  ok(/free month/.test(started.subject) && /No card was needed/.test(started.text) && /#stats\/a-law/.test(started.html) && /analytics/i.test(started.text), 'the "free month started" email says no card and links to the analytics');
  const ending = trialEndingEmail(o, { firmName: 'A Law', slug: 'a-law', endsAt: '2026-12-03 15:00:00', daysLeft: 5, price: '$89 / month', numbers: { views: 120, clicks: 1, enquiries: 0 } });
  ok(/ends in 5 days/.test(ending.subject) && /120 page views, 1 button click and 0 enquiries/.test(ending.text) && /Nothing is charged/.test(ending.text), 'the "ending soon" email shows the firm its own numbers and says nothing is charged');
  const ended = trialEndedEmail(o, { firmName: 'A Law', slug: 'a-law', price: '$89 / month', numbers: { views: 300, clicks: 20, enquiries: 4 } });
  ok(/300 page views, 20 button clicks and 4 enquiries/.test(ended.text) && /back to Basic/.test(ended.text), 'the "ended" email recaps the month and says the listing is back to Basic');
  const wk = weeklyReportEmail(o, { firmName: 'A Law', slug: 'a-law', featured: false, price: '$89 / month', trialDaysLeft: null, n: { views: 50, previousViews: 40, visitors: 30, clicks: 6, enquiries: 1 }, top: { label: 'Called', n: 4 } });
  ok(/50 views/.test(wk.subject) && /up 25%/.test(wk.text) && /most often: called/.test(wk.text) && /turn this email off/.test(wk.text) && /free month/.test(wk.text), 'the weekly email shows the week, the trend and the favourite button, offers the free month to Basic firms, and says how to turn it off');
  const wkTrial = weeklyReportEmail(o, { firmName: 'A Law', slug: 'a-law', featured: true, price: '$89 / month', trialDaysLeft: 3, n: { views: 5, previousViews: 0, visitors: 3, clicks: 0, enquiries: 0 }, top: null });
  ok(/3 days left/.test(wkTrial.text) && !/up|down/.test(wkTrial.text.split('\n')[2] || ''), 'a firm in its free month is told how many days are left');
}

// ---- the page script and the migration
{
  const js = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
  ok(/sessionStorage\.getItem\('lw_v:'/.test(js) && /v:v/.test(js), 'the page script marks the first look at a firm page in a tab (a note kept only in that tab)');
  ok(['email', 'message', 'reviews', 'rate', 'blog', "'social-' + n", "ev('call')", "ev('website')", "ev('directions')"].every((t) => js.includes(t)), 'the page script knows every button of a firm page');
  const sql = readFileSync(new URL('../migrations/0038_trials_analytics.sql', import.meta.url), 'utf8');
  ok(/PRIMARY KEY \(firm_slug, day, metric, k\)/.test(sql) && /WITHOUT ROWID/.test(sql) && /firm_trials/.test(sql) && /CHECK \(status IN \('active', 'ended', 'subscribed', 'kept'\)\)/.test(sql), 'the counters are keyed by firm first (a firm\'s report reads only its own rows) and a trial has a checked status');
}

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nanalytics checks passed');
