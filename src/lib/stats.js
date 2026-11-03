// First-party traffic counts that never track a person (see migration 0028 and the Privacy Policy).
//
// The page sends a tiny message (site.js: a page view, a click that matters, a search). Here it is checked against a whitelist, turned into a few
// "add one to this counter" lines for today, and forgotten. Nothing about the sender is stored: no IP address, no browser details, no cookie, no
// visitor id. Robots are ignored, and so is anyone whose browser says Do Not Track (the page does not send anything for them).

import { forecast, growthTips } from './forecast.js';

export const CASE_IDS = new Set(['injury', 'traffic', 'criminal', 'family', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation']);
// The clicks that matter. The first group is what a firm's visitors do on its page (shown on the firm's dashboard); cta-* are the buttons that sell Featured.
export const FIRM_ACTIONS = ['call', 'message', 'email', 'website', 'directions', 'reviews', 'book', 'book-locked', 'follow', 'rate', 'blog',
  'social-facebook', 'social-instagram', 'social-linkedin', 'social-x', 'social-youtube'];
export const EVENTS = new Set([...FIRM_ACTIONS, 'claim', 'cta-featured', 'cta-list']);
export const RETENTION_DAYS = { counts: 400, searchText: 90 };

// "Today" for the owner is a Toronto day, so a day's numbers match the day they lived through.
export const torontoDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pagespeed|gtmetrix|monitor|uptime|pingdom|curl\/|wget|python|java\/|go-http|node-fetch|axios|okhttp|scrapy|phantom|httpclient|libwww/i;
export const isBot = (ua) => !ua || BOT.test(ua);

// ---- cleaning: every value is checked or dropped, so a hostile message can only ever add to a counter with a sensible name
export function cleanPath(p) {
  if (typeof p !== 'string') return null;
  let s = p.split(/[?#]/)[0].toLowerCase().replace(/\.html$/, '').replace(/\/+$/, '');
  if (!s) s = '/';
  return /^\/[a-z0-9/_.-]{0,119}$/.test(s) && !s.includes('..') && !s.includes('//') ? s : null;
}

const SEARCH_ENGINE = [[/(^|\.)google\.[a-z.]+$/, 'google'], [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'], [/(^|\.)yahoo\.[a-z.]+$/, 'yahoo'],
  [/(^|\.)facebook\.com$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)linkedin\.com$/, 'linkedin'], [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'x'],
  [/(^|\.)reddit\.com$/, 'reddit'], [/(^|\.)youtube\.com$/, 'youtube']];
export function cleanRef(host) {
  if (typeof host !== 'string') return '';
  const h = host.toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]{3,60}$/.test(h) || h === 'lawdb.ca' || h.endsWith('.lawdb.ca')) return '';
  for (const [re, name] of SEARCH_ENGINE) if (re.test(h)) return name;
  return h;
}

// Words that nobody has a page for yet (a town, or a search that matched nothing). Letters only: a number, an address or a link means it is not a
// place name, so it is dropped rather than kept.
export function cleanWords(s) {
  if (typeof s !== 'string') return '';
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40 || /\d|@|https?:|www\./.test(t) || t.split(' ').length > 5) return '';
  return /^[\p{L}][\p{L}\s'’,.-]*$/u.test(t) ? t : '';
}

const cleanCity = (c) => (typeof c === 'string' && /^[\p{L}][\p{L} .'’-]{0,48}\|(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/u.test(c) ? c : '');
const cleanProv = (c) => (typeof c === 'string' && /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test(c) ? c : '');
const cleanUtm = (u) => (typeof u === 'string' && /^[a-z0-9_.-]{1,30}$/.test(u.toLowerCase()) ? u.toLowerCase() : '');

// One incoming message -> the counters to add one to ([kind, label, second label]), or null when it is not one of ours.
export function eventIncs(body, geo = {}) {
  if (!body || typeof body !== 'object') return null;
  if (body.t === 'pv') {
    const path = cleanPath(body.p);
    if (!path) return null;
    const incs = [['pv', path, ''], ['dev', body.m ? 'mobile' : 'desktop', '']];
    if (body.s === 1) {
      const country = /^[A-Z]{2}$/.test(geo.country || '') ? geo.country : '';
      const region = /^[A-Z0-9]{1,3}$/.test(geo.region || '') ? geo.region : '';
      incs.push(['visit', '', ''], ['entry', path, ''], ['ref', cleanRef(body.r) || 'direct', ''], ['geo', country || '??', region]);
      const utm = cleanUtm(body.u);
      if (utm) incs.push(['utm', utm, '']);
    }
    return incs;
  }
  if (body.t === 'ev') {
    const path = cleanPath(body.p);
    return EVENTS.has(body.e) && path ? [['ev', body.e, path]] : null;
  }
  if (body.t === 'search') {
    const c = CASE_IDS.has(body.c) ? body.c : '';
    const city = cleanCity(body.city);
    const prov = city ? '' : cleanProv(body.prov);
    const near = !city && !prov && body.near === true;
    const place = city || prov || (near ? 'near-me' : '');
    const words = place ? '' : cleanWords(body.w);
    if (!c && !place && !words) return null;
    const incs = [['search', c, place]];
    if (words) incs.push(c || body.nt === 1 ? ['town', words, c] : ['noparse', words, '']);
    return incs;
  }
  return null;
}

// ---- the same message, counted for ONE firm (see migration 0038): only a message about a firm's own page (/firms/<slug>) counts here.
// Returns [[slug, metric, label], ...]. "visitor" is one per browser-tab visit that looked at the page (the page script says so with v:1, using a note
// that lives only in that tab); the source, region and campaign are counted once per such visit, so they add up to visitors, not to page views.
export const FIRM_PATH = /^\/firms\/([a-z0-9][a-z0-9-]{0,80})$/;
export function firmIncs(body, geo = {}) {
  if (!body || typeof body !== 'object') return [];
  const path = cleanPath(body.p);
  const m = path && FIRM_PATH.exec(path);
  if (!m) return [];
  const slug = m[1];
  if (body.t === 'pv') {
    const out = [[slug, 'pv', ''], [slug, 'dev', body.m ? 'mobile' : 'desktop']];
    if (body.s === 1) out.push([slug, 'entry', '']);
    if (body.v === 1) {
      const country = /^[A-Z]{2}$/.test(geo.country || '') ? geo.country : '??';
      const region = /^[A-Z0-9]{1,3}$/.test(geo.region || '') ? geo.region : '';
      out.push([slug, 'visitor', ''], [slug, 'ref', cleanRef(body.r) || (body.s === 1 ? 'direct' : 'lawdb')], [slug, 'geo', region ? `${country}|${region}` : country]);
      const utm = cleanUtm(body.u);
      if (utm) out.push([slug, 'utm', utm]);
    }
    return out;
  }
  if (body.t === 'ev') return FIRM_ACTIONS.includes(body.e) ? [[slug, 'ev', body.e]] : [];
  return [];
}

// A simple per-isolate throttle (nothing is stored anywhere): one address may send 90 messages a minute, then the rest are ignored.
const seen = new Map();
export function throttled(ip, now = Date.now()) {
  if (seen.size > 5000) seen.clear();
  const e = seen.get(ip);
  if (!e || now - e.t > 60000) { seen.set(ip, { t: now, n: 1 }); return false; }
  return ++e.n > 90;
}

export async function record(env, day, incs) {
  if (!incs.length) return;
  const sql = 'INSERT INTO stats_daily (day, kind, k1, k2, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, kind, k1, k2) DO UPDATE SET n = n + 1';
  await env.DB.batch(incs.map(([kind, k1, k2]) => env.DB.prepare(sql).bind(day, kind, k1, k2)));
}

export async function prune(env) {
  const [a, b, c] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM stats_daily WHERE day < date('now', '-${RETENTION_DAYS.counts} days')`),
    env.DB.prepare(`DELETE FROM stats_daily WHERE kind IN ('town', 'noparse') AND day < date('now', '-${RETENTION_DAYS.searchText} days')`),
    env.DB.prepare(`DELETE FROM firm_stats_daily WHERE day < date('now', '-${RETENTION_DAYS.counts} days')`), // each firm's own counters, same 400 days
  ]);
  return (a.meta?.changes ?? 0) + (b.meta?.changes ?? 0) + (c.meta?.changes ?? 0);
}

// ---- the owner's report
const top = (rows, key = 'k1') => rows.map((r) => ({ label: r[key], n: r.n }));

export async function trafficReport(env, days) {
  const to = torontoDay();
  const from = torontoDay(new Date(Date.now() - (days - 1) * 86400000));
  const sum = (kind, limit, extra = '') => env.DB.prepare(`SELECT k1, k2, SUM(n) AS n FROM stats_daily WHERE kind = ? AND day >= ? ${extra} GROUP BY k1, k2 ORDER BY n DESC, k1 LIMIT ${limit}`).bind(kind, from);
  const [series, totals, pages, entries, refs, devices, geo, utm, events, eventFirms, searches, towns, noparse, firmPages, first, visits60, coverage] = await env.DB.batch([
    env.DB.prepare("SELECT day, kind, SUM(n) AS n FROM stats_daily WHERE kind IN ('pv', 'visit') AND day >= ? GROUP BY day, kind ORDER BY day").bind(from),
    env.DB.prepare("SELECT kind, SUM(n) AS n FROM stats_daily WHERE kind IN ('pv', 'visit', 'search', 'ev') AND day >= ? GROUP BY kind").bind(from),
    sum('pv', 15), sum('entry', 15), sum('ref', 12), sum('dev', 3), sum('geo', 12), sum('utm', 10),
    env.DB.prepare('SELECT k1, SUM(n) AS n FROM stats_daily WHERE kind = ? AND day >= ? GROUP BY k1 ORDER BY n DESC').bind('ev', from),
    env.DB.prepare("SELECT k2 AS k1, k1 AS k2, SUM(n) AS n FROM stats_daily WHERE kind = 'ev' AND k1 IN ('call', 'website', 'directions', 'book', 'book-locked') AND day >= ? GROUP BY k2, k1 ORDER BY n DESC LIMIT 15").bind(from),
    sum('search', 20), sum('town', 20), sum('noparse', 20),
    env.DB.prepare("SELECT k1, SUM(n) AS n FROM stats_daily WHERE kind = 'pv' AND k1 LIKE '/firms/%' AND day >= ? GROUP BY k1 ORDER BY n DESC LIMIT 15").bind(from),
    env.DB.prepare('SELECT MIN(day) AS d FROM stats_daily'),
    env.DB.prepare("SELECT day, SUM(n) AS n FROM stats_daily WHERE kind = 'visit' AND day >= ? GROUP BY day ORDER BY day").bind(torontoDay(new Date(Date.now() - 59 * 86400000))),
    env.DB.prepare("SELECT province, COUNT(*) AS firms FROM firms WHERE status = 'live' GROUP BY province ORDER BY firms DESC"),
  ]);

  const byDay = new Map();
  for (const r of series.results) byDay.set(r.day, { ...(byDay.get(r.day) || {}), [r.kind]: r.n });
  const days_ = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = torontoDay(new Date(Date.now() - i * 86400000));
    days_.push({ day: d, visits: byDay.get(d)?.visit || 0, pageViews: byDay.get(d)?.pv || 0 });
  }
  const total = Object.fromEntries(totals.results.map((r) => [r.kind, r.n]));

  // Page addresses of firms come with the firm's name.
  const slugs = [...new Set([...firmPages.results, ...eventFirms.results].map((r) => r.k1.replace('/firms/', '')))].filter((s) => /^[a-z0-9-]+$/.test(s)).slice(0, 40);
  const names = slugs.length ? (await env.DB.prepare(`SELECT slug, name FROM firms WHERE slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all()).results : [];
  const nameOf = Object.fromEntries(names.map((r) => [r.slug, r.name]));
  const firmLabel = (p) => nameOf[p.replace('/firms/', '')] || p;

  const report = {
    from, to, days, since: first.results[0]?.d || null,
    totals: { visits: total.visit || 0, pageViews: total.pv || 0, searches: total.search || 0, clicks: total.ev || 0 },
    series: days_,
    pages: top(pages.results),
    firms: firmPages.results.map((r) => ({ label: firmLabel(r.k1), path: r.k1, n: r.n })),
    entries: top(entries.results), refs: top(refs.results), devices: top(devices.results), utm: top(utm.results),
    geo: geo.results.map((r) => ({ label: r.k2 ? `${r.k1} ${r.k2}` : r.k1, n: r.n })),
    events: top(events.results),
    eventFirms: eventFirms.results.map((r) => ({ label: firmLabel(r.k1), path: r.k1, kind: r.k2, n: r.n })),
    searches: searches.results.map((r) => ({ kase: r.k1, place: r.k2, n: r.n })),
    towns: towns.results.map((r) => ({ label: r.k1, kase: r.k2, n: r.n })),
    noparse: top(noparse.results),
    coverage: coverage.results.map((r) => ({ province: r.province, firms: r.firms })),
  };

  // The projection is fitted on up to 60 days whatever range is on screen (a 7-day view would be too short to say anything).
  const by60 = new Map(visits60.results.map((r) => [r.day, r.n]));
  const series60 = [];
  for (let i = 59; i >= 0; i--) { const d = torontoDay(new Date(Date.now() - i * 86400000)); series60.push({ day: d, visits: by60.get(d) || 0 }); }
  report.forecast = forecast(series60);
  report.tips = growthTips(report, report.coverage);
  return report;
}
