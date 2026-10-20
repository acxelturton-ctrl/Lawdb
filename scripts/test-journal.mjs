// The Traffic projection and advice, the nightly journal, the deploy record and the seeded project list.
import { forecast, growthTips } from '../src/lib/forecast.js';
import { dayBoundsUtc, compileDay, journalNightly } from '../src/lib/journal.js';
import { parseMerges, toSql, recentPullRequests } from './record-deploy.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- projection
const days = (vals, start = '2026-09-01') => vals.map((v, i) => ({ day: new Date(Date.UTC(2026, 8, 1 + i, 12)).toISOString().slice(0, 10), visits: v }));
ok(forecast(days([5, 6, 7, 8, 9, 10])).ready === false && forecast(days([5, 6, 7, 8, 9, 10])).haveDays === 5, 'with fewer than 7 full days there is no projection, only "keep counting" (today is left out)');
ok(forecast(days([0, 0, 0, 0, 0, 0, 0, 0, 0])).ready === false, 'days before the first visit do not count as days of history');
const rising = forecast(days([10, 12, 11, 14, 15, 17, 16, 19, 20, 22, 21, 24, 25, 27, 99]));
ok(rising.ready && rising.haveDays === 14 && rising.points.length === 30 && rising.points[0].day === '2026-09-16', 'a projection is 30 days, starting the day after today, using the 14 full days (today\'s partial number, 99 here, is ignored)');
ok(rising.perWeekPct > 5 && rising.next30 > rising.last30 && rising.steady, 'a climbing series projects growth and is called steady');
ok(rising.points.every((p) => p.lo <= p.visits && p.visits <= p.hi && p.lo >= 0), 'every projected day sits inside its likely range and never goes below zero');
const falling = forecast(days([30, 28, 25, 22, 20, 17, 14, 12, 9, 7, 5, 3, 2, 1, 5]));
ok(falling.ready && falling.perWeekPct < 0 && falling.points.every((p) => p.visits >= 0) && falling.points[29].visits === 0, 'a falling series is projected down but never below zero');
const noisy = forecast(days([5, 40, 3, 55, 2, 38, 6, 50, 4, 45, 1, 42, 7, 39, 9]));
ok(noisy.ready && !noisy.steady, 'a bouncing series is flagged as not steady, so the page calls it a rough guide');

// ---- advice
const base = (over = {}) => ({ totals: { visits: 200, pageViews: 600, searches: 30, clicks: 4 }, refs: [{ label: 'google', n: 150 }, { label: 'direct', n: 50 }], entries: [{ label: '/', n: 40 }, { label: '/ontario/toronto', n: 60 }], geo: [{ label: 'CA ON', n: 80 }, { label: 'CA MB', n: 40 }], devices: [{ label: 'mobile', n: 300 }, { label: 'desktop', n: 300 }], events: [{ label: 'call', n: 1 }], towns: [], noparse: [], forecast: { ready: false }, ...over });
const cov = [{ province: 'ON', firms: 800 }, { province: 'MB', firms: 60 }, { province: 'QC', firms: 140 }];
ok(growthTips({ totals: { visits: 12 } }, cov).length === 1 && /Too early/.test(growthTips({ totals: { visits: 12 } }, cov)[0].title), 'with a handful of visits the advice is "too early", not guesses');
const tips = growthTips(base({ towns: [{ label: 'keswick', kase: 'criminal', n: 7 }], noparse: [{ label: 'purple monkey', n: 2 }] }), cov);
ok(tips.some((t) => /Add firms where people are already looking/.test(t.title) && /keswick \(criminal defence\) 7x/.test(t.why)), 'towns people searched for with no page become "add firms there", quoting the town, the case and the count');
ok(tips.some((t) => /Teach the search/.test(t.title) && /purple monkey/.test(t.why)), 'searches that matched nothing become "teach the search these words"');
ok(tips.some((t) => /Manitoba wants more than we list/.test(t.title) && /33% of Canadian visits/.test(t.why) && /6%/.test(t.why)), 'a province with more visits than listings is called out with both shares (Manitoba: 33% of visits, 6% of firms)');
ok(tips.some((t) => /Almost all your visitors come from Google/.test(t.title) && /75%/.test(t.why)) && tips.some((t) => /Social media sends nothing/.test(t.title)), 'a source that dominates, and no social visits at all, are both said plainly with the figure');
ok(tips.some((t) => /Few visitors contact a firm/.test(t.title) && /1 call, website or directions clicks from 200 visits/.test(t.why)), 'a low contact rate quotes the clicks and visits it came from');
ok(tips.length <= 6, 'never more than six pieces of advice');
const flat = growthTips(base({ forecast: { ready: true, steady: false, perWeekPct: 0, avgNow: 20, next30: 600 } }), cov);
ok(flat.some((t) => /Traffic is flat/.test(t.title)), 'a flat forecast says traffic is flat and where growth would come from');
const climbing = growthTips(base({ forecast: { ready: true, steady: true, perWeekPct: 18, avgNow: 40, next30: 1500 } }), cov);
ok(climbing.some((t) => /climbing/.test(t.title) && /18%/.test(t.why) && /1500/.test(t.why)), 'a steady climb says so, with the weekly rate and the 30-day figure');

// ---- Toronto days in UTC (summer time, winter time, and the changeover days)
ok(same(dayBoundsUtc('2026-10-20'), ['2026-10-20 04:00:00', '2026-10-21 04:00:00']), 'a summer Toronto day starts at 04:00 UTC');
ok(same(dayBoundsUtc('2026-12-15'), ['2026-12-15 05:00:00', '2026-12-16 05:00:00']), 'a winter Toronto day starts at 05:00 UTC');
ok(dayBoundsUtc('2026-11-01')[0] === '2026-11-01 04:00:00' && dayBoundsUtc('2026-11-02')[0] === '2026-11-02 05:00:00', 'the clocks going back (Nov 1) are handled: that day starts on summer time, the next on winter time');

// ---- the journal: what a day holds, and what the nightly job writes
const fake = (tables = {}) => {
  const writes = [];
  const rows = (sql) => {
    if (/FROM ship_log/.test(sql)) return tables.ship || [];
    if (/kind IN \('visit', 'pv', 'search', 'ev'\)/.test(sql)) return tables.stats || [];
    if (/kind = 'visit'/.test(sql)) return tables.prev || [{ n: 0 }];
    if (/FROM leads/.test(sql)) return [{ n: tables.leads || 0 }];
    if (/FROM firm_members/.test(sql)) return [{ n: 0 }];
    if (/FROM firm_subscriptions/.test(sql)) return [{ n: tables.pay || 0 }];
    if (/kind = 'town'/.test(sql)) return tables.town || [];
    if (/FROM audit_log/.test(sql)) return tables.problems || [];
    if (/SELECT day FROM journal/.test(sql)) return tables.have || [];
    return [];
  };
  const stmt = (sql) => ({ sql, bind: (...a) => ({ sql, a, all: async () => ({ results: rows(sql) }), run: async () => { writes.push({ sql, a }); return {}; } }) });
  return { writes, DB: { prepare: stmt, batch: async (list) => list.map((s) => ({ results: rows(s.sql) })) } };
};
{
  const e = fake({ ship: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => ({ title: `Change ${t}` })), stats: [{ kind: 'visit', n: 142 }, { kind: 'pv', n: 410 }, { kind: 'search', n: 9 }, { kind: 'ev', n: 5 }], prev: [{ n: 127 }], leads: 2, town: [{ k1: 'keswick', k2: 'criminal', n: 3 }], problems: [{ action: 'backup.failed', n: 1 }] });
  const day = await compileDay(e, '2026-10-20');
  ok(day.shipped.length === 5 && day.moreShipped === 2 && day.shipped[0] === 'Change a', 'a busy day lists five shipped items and says how many more');
  ok(day.visits === 142 && day.pageViews === 410 && day.searches === 9 && day.clicks === 5 && day.prevVisits === 127 && day.enquiries === 2, 'the numbers come from the counts, with the day before for comparison');
  ok(day.wanted.town === 'keswick' && day.wanted.kase === 'criminal' && same(day.problems, ['Backup failed']), 'the most wanted town and any failure are included');
}
{
  const quiet = fake({});
  const written = await journalNightly(quiet, new Date('2026-10-21T07:17:00Z'));
  ok(written === 0 && quiet.writes.length === 0, 'a night when nothing happened writes nothing (no empty entries)');
  const busy = fake({ ship: [{ title: 'Something shipped' }], have: [] });
  const w = await journalNightly(busy, new Date('2026-10-21T07:17:00Z'), 3);
  ok(w === 3 && busy.writes.length === 3 && busy.writes.every((x) => /ON CONFLICT \(day\) DO UPDATE SET body = excluded\.body/.test(x.sql) && !/note/.test(x.sql)) && busy.writes[0].a[0] === '2026-10-20', 'the 03:17 run writes yesterday (Toronto), backfills missing days, and never touches the owner\'s notes');
  const again = fake({ ship: [{ title: 'Something shipped' }], have: [{ day: '2026-10-19' }, { day: '2026-10-18' }] });
  ok((await journalNightly(again, new Date('2026-10-21T07:17:00Z'), 3)) === 1, 'days that already have an entry are left alone; only yesterday is rewritten');
}

// ---- the deploy record
const log = [
  ['aaa', '2026-10-20T22:58:53-04:00', 'Merge pull request #97 from acxelturton-ctrl/profiles-under-description\n\nFirm pages: put the Profiles box right under the description\n'],
  ['bbb', '2026-10-20T11:04:28Z', "Merge pull request #99 from acxelturton-ctrl/hero-crossfade\n\nHome hero: fade between two photos every 5 seconds\n"],
  ['ccc', '2026-10-14T13:00:00Z', 'Merge pull request #5 from acxelturton-ctrl/some-branch-name\n'],
  ['ddd', '2026-10-14T13:00:00Z', "Merge branch 'master' into thing\n"],
  ['eee', '2026-10-15T12:00:00Z', "Merge pull request #7 from a/b\n\nO'Brien's \u0001 change; DROP TABLE firms;--\n"],
].map(([h, d, b]) => `${h}\x1f${d}\x1f${b}`).join('\x1e');
const rows = parseMerges(log);
ok(rows.length === 4 && rows[0].pr === 97 && rows[0].title === 'Firm pages: put the Profiles box right under the description', 'merged pull requests are read with their number and title; ordinary merges are ignored');
ok(rows[0].day === '2026-10-20' && rows[0].at === '2026-10-21 02:58:53' && rows[1].day === '2026-10-20', 'the day is the Toronto day (10:58 PM on Oct 20 is Oct 20, even though it is Oct 21 in UTC)');
ok(rows[2].title === 'Some branch name', 'a merge with no title falls back to the branch name, tidied');
const sql = toSql(rows);
ok(sql.split('\n').filter(Boolean).every((l) => /^INSERT OR IGNORE INTO ship_log \(pr, day, at, title\) VALUES \(\d+, '[\d-]+', '[\d: -]+', '.*'\);$/.test(l)) && sql.includes("O''Brien''s") && !sql.includes('\u0001'), 'the SQL is one idempotent insert per pull request, with quotes doubled and control characters removed');
{
  // The deploy's checkout is shallow: its newest commit is a "Merge pull request" with no parents on record, which `git log --merges` would skip.
  const dir = mkdtempSync(join(tmpdir(), 'lawdb-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    git('init', '-q'); writeFileSync(join(dir, 'f.txt'), 'x'); git('add', '.');
    git('commit', '-q', '-m', 'Merge pull request #123 from owner/some-branch\n\nA shallow checkout still has this title');
    const rowsShallow = recentPullRequests(80, dir);
    ok(git('log', '--merges', '--format=%H').trim() === '' && rowsShallow.length === 1 && rowsShallow[0].pr === 123 && rowsShallow[0].title === 'A shallow checkout still has this title', 'a pull request is found even when git does not call its commit a merge (the shallow checkout the deploy uses)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const hist = readFileSync(new URL('../db/ship-history.sql', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('--'));
const prs = hist.map((l) => Number(/VALUES \((\d+),/.exec(l)?.[1]));
ok(hist.length > 50 && hist.every((l) => /^INSERT OR IGNORE INTO ship_log /.test(l)) && new Set(prs).size === prs.length, 'the history file has one idempotent row per past pull request, none twice');

// ---- the seeded project list
const mig = readFileSync(new URL('../migrations/0029_admin_extras.sql', import.meta.url), 'utf8');
const seeds = [...mig.matchAll(/INSERT INTO projects \(title, detail, source, asked_on, status, sort\) VALUES \('((?:[^']|'')*)', '((?:[^']|'')*)', '(you|claude)', (NULL|'\d{4}-\d{2}-\d{2}'), '(idea|next|doing|done)', (\d+)\);/g)];
ok(seeds.length === 10 && seeds.every((m) => m[1].length <= 120 && m[2].length <= 1200 && m[2].length > 40), 'ten starter projects, each with a title and a real explanation');
ok(seeds.filter((m) => m[3] === 'you').length === 6 && seeds.filter((m) => m[3] === 'claude').length === 4 && new Set(seeds.map((m) => m[6])).size === 10, 'six are things you asked for or agreed to and four are Claude\'s ideas, kept apart, each in its own place in the order');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\njournal and projection checks passed');
