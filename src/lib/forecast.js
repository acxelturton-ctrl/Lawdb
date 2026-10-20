// The Traffic tab's projection and its "how to grow" advice. Pure functions of the numbers in the report, so they are easy to test and never guess:
// every piece of advice quotes the figure it comes from, and with too little data the answer is "keep counting" instead of a made-up curve.

const R1 = (n) => Math.round(n);

// series: [{ day, visits }], oldest first, the last entry being today (a day that is still going, so it is left out of the fit).
// Straight-line trend through the complete days since counting began; a rough guide, not a promise (it ignores weekends and seasons).
export function forecast(series, horizon = 30) {
  const done = series.slice(0, -1);
  const first = done.findIndex((d) => d.visits > 0);
  const days = first < 0 ? [] : done.slice(first);
  const n = days.length;
  if (n < 7) return { ready: false, haveDays: n, needDays: 7 };
  const ys = days.map((d) => d.visits);
  const xs = days.map((_, i) => i);
  const xbar = (n - 1) / 2;
  const ybar = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - xbar) ** 2; sxy += (xs[i] - xbar) * (ys[i] - ybar); syy += (ys[i] - ybar) ** 2; }
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const sd = Math.sqrt(sse / Math.max(1, n - 2));
  const r2 = syy > 0 ? Math.max(0, 1 - sse / syy) : 0;
  const last = new Date(`${series[series.length - 1].day}T12:00:00Z`);
  const points = [];
  for (let k = 1; k <= horizon; k++) {
    const x = n - 1 + k + 1; // today is x = n; the first projected day is tomorrow
    const mid = Math.max(0, intercept + slope * x);
    const half = 1.3 * sd * Math.sqrt(1 + 1 / n + ((x - xbar) ** 2) / sxx); // about an 80% range
    const d = new Date(last.getTime() + k * 86400000);
    points.push({ day: d.toISOString().slice(0, 10), visits: R1(mid), lo: R1(Math.max(0, mid - half)), hi: R1(mid + half) });
  }
  const recent = ys.slice(-7);
  const avgNow = recent.reduce((a, b) => a + b, 0) / recent.length;
  return {
    ready: true, haveDays: n, points,
    next30: points.reduce((a, p) => a + p.visits, 0),
    last30: ys.slice(-30).reduce((a, b) => a + b, 0),
    avgNow: R1(avgNow),
    perWeekPct: avgNow > 0 ? R1((slope * 7 / avgNow) * 100) : 0, // how much the daily average climbs (or falls) each week, as a share of today's average
    steady: r2 >= 0.25 && n >= 14, // a clear trend rather than noise
  };
}

const PROV_NAME = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba', NS: 'Nova Scotia', NB: 'New Brunswick', SK: 'Saskatchewan', PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador' };
const CASE_NAME = { injury: 'personal injury', traffic: 'traffic ticket', criminal: 'criminal defence', family: 'family', realestate: 'real estate', wills: 'wills and estates', business: 'business', employment: 'employment', immigration: 'immigration', litigation: 'litigation' };
// Which advice matters most when there is more than six: lower comes first (matched on the start of the title).
const PRIORITY = [['Add firms where people are already looking', 1], ['wants more than we list', 2], ['Traffic is flat', 2], ['Few visitors contact a firm', 3], ['Teach the search the words', 3], ['Traffic is climbing', 3],
  ['Almost all your visitors come from Google', 4], ['Search engines send very little yet', 4], ['Social media sends nothing so far', 5], ['has listings but little traffic', 6], ['Most visits start on the home page', 6], ['Most visitors are on phones', 7]];
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// report: the Traffic report (totals, refs, entries, geo, devices, events, towns, noparse, forecast...), coverage: [{ province, firms }].
// Returns up to six pieces of advice, each { title, why, action }.
export function growthTips(report, coverage = []) {
  const tips = [];
  const t = report.totals || {};
  if ((t.visits || 0) < 30) {
    return [{ title: 'Too early to say what is working', why: `Only ${t.visits || 0} visits have been counted in this period.`, action: 'Keep counting. After a week or two of normal traffic this list becomes specific, and the projection above appears.' }];
  }

  const towns = report.towns || [];
  if (towns.length) {
    const top = towns.slice(0, 3).map((x) => `${x.label}${x.kase ? ` (${CASE_NAME[x.kase] || x.kase})` : ''} ${x.n}x`).join(', ');
    tips.push({ title: 'Add firms where people are already looking', why: `People searched for towns we have no page for: ${top}.`, action: 'Add firms in or near those towns. Each one turns a search that today shows "nearest firms" into a real local page that can rank.' });
  }
  const noparse = report.noparse || [];
  if (noparse.length) {
    tips.push({ title: 'Teach the search the words people use', why: `Searches that matched nothing: ${noparse.slice(0, 4).map((x) => `"${x.label}" ${x.n}x`).join(', ')}.`, action: 'Add these as practice-area words or town names so the next person gets results.' });
  }

  // Where visits and listings do not line up (Canadian visits only, by province).
  const byProv = {};
  for (const g of report.geo || []) {
    const [c, r] = String(g.label).split(' ');
    if (c === 'CA' && r) byProv[r] = (byProv[r] || 0) + g.n;
  }
  const caVisits = Object.values(byProv).reduce((a, b) => a + b, 0);
  const firmsTotal = coverage.reduce((a, c) => a + c.firms, 0);
  if (caVisits >= 20 && firmsTotal > 0) {
    const rows = coverage.map((c) => ({ prov: c.province, firms: c.firms, firmShare: pct(c.firms, firmsTotal), visitShare: pct(byProv[c.province] || 0, caVisits) }));
    // demand ahead of listings: a real share of visits (5%+) that is at least 1.5 times the share of firms
    const asking = rows.filter((r) => r.visitShare >= 5 && r.firmShare > 0 && r.visitShare >= 1.5 * r.firmShare && r.visitShare - r.firmShare >= 3).sort((x, y) => y.visitShare / y.firmShare - x.visitShare / x.firmShare)[0];
    if (asking) tips.push({ title: `${PROV_NAME[asking.prov] || asking.prov} wants more than we list`, why: `${asking.visitShare}% of Canadian visits come from ${PROV_NAME[asking.prov] || asking.prov}, but it has ${asking.firmShare}% of the firms (${asking.firms}).`, action: 'Add high-quality firms there first; the demand is already showing up.' });
    // listings nobody is finding: a real share of firms (10%+) with under 40% of its fair share of visits
    const quiet = rows.filter((r) => r.firmShare >= 10 && r.visitShare <= 0.4 * r.firmShare).sort((x, y) => y.firmShare - x.firmShare)[0];
    if (quiet) tips.push({ title: `${PROV_NAME[quiet.prov] || quiet.prov} has listings but little traffic`, why: `${PROV_NAME[quiet.prov] || quiet.prov} has ${quiet.firmShare}% of the firms (${quiet.firms}) but only ${quiet.visitShare}% of Canadian visits.`, action: 'Market it: local outreach to its firms, ads aimed at that province, and make sure its city pages are indexed (Search tab).' });
  }

  // Where visitors arrive from.
  const refs = report.refs || [];
  const refTotal = refs.reduce((a, r) => a + r.n, 0);
  const share = (name) => pct((refs.find((r) => r.label === name) || { n: 0 }).n, refTotal);
  if (refTotal >= 20) {
    if (share('google') >= 60) tips.push({ title: 'Almost all your visitors come from Google', why: `${share('google')}% of visits start on Google.`, action: 'Good, but fragile: add a second source. The Facebook ads (videos are ready) and LinkedIn posts both bring different people. Tag their links with utm_source so this tab can tell them apart.' });
    else if (share('google') + share('bing') + share('duckduckgo') < 20) tips.push({ title: 'Search engines send very little yet', why: `Only ${share('google') + share('bing') + share('duckduckgo')}% of visits come from search engines.`, action: 'Check the Search tab: pages "Crawled, not indexed" are the ones Google has seen but not ranked. Strong, unique pages and more firms claiming listings help most.' });
    if (share('facebook') + share('linkedin') + share('instagram') + share('x') === 0) tips.push({ title: 'Social media sends nothing so far', why: 'No visits have come from Facebook, LinkedIn, Instagram or X.', action: 'Post the new firm pages and News stories from your profiles (now in the footer), and add ?utm_source=linkedin (or facebook) to the links to measure them.' });
  }

  // What visitors do.
  const ev = Object.fromEntries((report.events || []).map((e) => [e.label, e.n]));
  const contact = (ev.call || 0) + (ev.website || 0) + (ev.directions || 0);
  if (t.visits >= 50) {
    const per100 = Math.round((contact / t.visits) * 1000) / 10;
    if (per100 < 3) tips.push({ title: 'Few visitors contact a firm', why: `${contact} call, website or directions clicks from ${t.visits} visits (${per100} per 100).`, action: 'Strengthen the firm pages people land on: cover photo, a real description, hours, and the Call button high on the page. Featured placement also puts the best pages first.' });
  }
  const dev = Object.fromEntries((report.devices || []).map((d) => [d.label, d.n]));
  const devTotal = (dev.mobile || 0) + (dev.desktop || 0);
  if (devTotal >= 30 && pct(dev.mobile || 0, devTotal) >= 60) tips.push({ title: 'Most visitors are on phones', why: `${pct(dev.mobile, devTotal)}% of page views are on a phone.`, action: 'Look at the home page and a firm page on your own phone every time something changes, and keep the Call button one tap away.' });

  const entries = report.entries || [];
  const entryTotal = entries.reduce((a, r) => a + r.n, 0);
  const home = (entries.find((r) => r.label === '/') || { n: 0 }).n;
  if (entryTotal >= 20 && pct(home, entryTotal) >= 60) tips.push({ title: 'Most visits start on the home page', why: `${pct(home, entryTotal)}% of visits land on the home page, not on a city or firm page.`, action: 'That usually means few inner pages are being found in search. Get more city and practice pages indexed and add firms so those pages are strong enough to rank.' });

  const f = report.forecast;
  if (f && f.ready) {
    if (f.steady && f.perWeekPct >= 10) tips.push({ title: 'Traffic is climbing: keep what works', why: `The daily average is growing about ${f.perWeekPct}% a week; at this pace about ${f.next30} visits in the next 30 days.`, action: 'Do more of whatever you did in the last two weeks (check the Journal), and do not change the home page while it is working.' });
    else if (f.perWeekPct <= 2) tips.push({ title: 'Traffic is flat', why: `The daily average is about ${f.avgNow} and is not climbing (${f.perWeekPct}% a week).`, action: 'Growth will come from new pages that can rank (towns people search, more firms) and a second traffic source, not from polishing existing pages.' });
  }

  const rank = (t) => { const hit = PRIORITY.find(([key]) => t.title.includes(key)); return hit ? hit[1] : 9; };
  return tips.map((t, i) => ({ t, i })).sort((x, y) => rank(x.t) - rank(y.t) || x.i - y.i).slice(0, 6).map((x) => x.t);
}
