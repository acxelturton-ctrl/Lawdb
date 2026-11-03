// A firm's analytics dashboard: what its page got, what visitors did, where they came from. One component, used on the owner's Analytics tab
// (mode 'owner') and by the admin for any firm (mode 'admin'). The data is counted without tracking anyone (see src/lib/firm-analytics.js).
// SECURITY: every label from the server goes in as a text node (h()), never as HTML.
import { h, api, note } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
};

// The site's content-security policy refuses style="..." attributes, so sizes are set through the style API instead.
const sized = (el, prop, value) => { el.style[prop] = value; return el; };
const num = (n) => Number(n || 0).toLocaleString('en-CA');
const dayText = (d, opts = { month: 'short', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', opts);
const fmtEnd = (t) => new Date(t.replace(' ', 'T') + 'Z').toLocaleDateString('en-CA', { dateStyle: 'long' });
// The top of the chart: four equal steps, each a round whole number, as close above the biggest value as possible (55 gives 60, not 100).
const niceMax = (v) => {
  const p = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(v, 1) / 4)));
  for (const m of p >= 10 ? [1, 1.5, 2, 2.5, 3, 4, 5, 10] : [1, 2, 3, 4, 5, 10]) if (m * p * 4 >= v) return m * p * 4;
  return 40 * p;
};

const METRICS = [
  { key: 'views', label: 'Page views', hint: 'Every time your page was opened', tone: 'ink' },
  { key: 'visitors', label: 'Visitors', hint: 'Separate visits to your page (one per browser tab)', tone: 'ink' },
  { key: 'clicks', label: 'Button clicks', hint: 'Calls, messages, website, directions and every other button', tone: 'gold' },
  { key: 'enquiries', label: 'Enquiries', hint: 'Messages sent to you through your LawDB page', tone: 'gold' },
];

const skipState = () => { try { return localStorage.getItem('lawdb_skip'); } catch (e) { return null; } };
const setSkip = (on) => { try { localStorage.setItem('lawdb_skip', on ? '1' : '0'); } catch (e) { /* the note simply isn't kept */ } };

function deltaChip(pct, now, before) {
  if (pct === null) return now > 0 && before === 0 ? h('span', { class: 'fa-delta new' }, 'new') : null;
  if (pct === 0) return h('span', { class: 'fa-delta' }, 'no change');
  return h('span', { class: 'fa-delta ' + (pct > 0 ? 'up' : 'down'), title: 'Compared with the previous period of the same length' }, (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%');
}

// ---------------------------------------------------------------- the daily chart
function lineChart(report, metric, width, wrap) {
  const H = 232, m = { t: 14, r: 14, b: 28, l: 42 };
  const w = Math.max(280, Math.floor(width)), iw = w - m.l - m.r, ih = H - m.t - m.b;
  const cur = report.series.map((s) => s[metric.key]);
  const prev = (report.previousSeries || []).map((s) => s[metric.key]);
  const max = niceMax(Math.max(1, ...cur, ...prev));
  const n = cur.length;
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - (v / max) * ih;
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const total = cur.reduce((a, b) => a + b, 0);

  const svg = sv('svg', { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: 'img', class: 'fa-svg ' + metric.tone, 'aria-label': `${metric.label} per day, ${dayText(report.from)} to ${dayText(report.to)}: ${num(total)} in total` });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    svg.append(sv('line', { x1: m.l, x2: w - m.r, y1: yy, y2: yy, class: 'fa-grid' }));
    svg.append(sv('text', { x: m.l - 8, y: yy + 4, class: 'fa-tick', 'text-anchor': 'end' }, Number.isInteger(v) ? num(v) : v.toFixed(1)));
  }
  const labels = Math.min(5, n);
  for (let i = 0; i < labels; i++) {
    const idx = labels === 1 ? 0 : Math.round((i * (n - 1)) / (labels - 1));
    svg.append(sv('text', { x: x(idx), y: H - 8, class: 'fa-tick', 'text-anchor': i === 0 ? 'start' : i === labels - 1 ? 'end' : 'middle' }, dayText(report.series[idx].day)));
  }
  if (prev.length === n && prev.some((v) => v > 0)) svg.append(sv('path', { d: path(prev), class: 'fa-prev', fill: 'none' }));
  if (n > 1) svg.append(sv('path', { d: `${path(cur)} L${x(n - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`, class: 'fa-area' }));
  svg.append(sv('path', { d: path(cur), class: 'fa-line', fill: 'none' }));
  if (n <= 31) cur.forEach((v, i) => svg.append(sv('circle', { cx: x(i), cy: y(v), r: 2.6, class: 'fa-dot' })));

  // hover: a guide line, a ring on the day and a small card with the numbers
  const guide = sv('line', { y1: m.t, y2: m.t + ih, class: 'fa-guide', visibility: 'hidden' });
  const ring = sv('circle', { r: 5, class: 'fa-ring', visibility: 'hidden' });
  const tip = h('div', { class: 'fa-tip', hidden: true });
  svg.append(guide, ring);
  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - box.left - m.l) / iw) * (n - 1))));
    guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('visibility', 'visible');
    ring.setAttribute('cx', x(i)); ring.setAttribute('cy', y(cur[i])); ring.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('b', null, dayText(report.series[i].day, { weekday: 'short', month: 'short', day: 'numeric' })),
      h('span', null, `${metric.label}: `, h('b', null, num(cur[i]))),
      prev.length === n ? h('span', { class: 'muted' }, `${dayText(report.previousSeries[i].day)}: ${num(prev[i])}`) : null);
    tip.hidden = false;
    const left = Math.min(Math.max(x(i) - 70, 4), w - 150);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, y(cur[i]) - 74) + 'px';
  };
  const hide = () => { guide.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
  wrap.replaceChildren(svg, tip);
}

// ---------------------------------------------------------------- small pieces
const barRow = (label, n, pctOfMax, extra = {}) => h('div', { class: 'fa-row' + (extra.gold ? ' gold' : '') },
  h('span', { class: 'fa-rl' }, label, extra.badge && h('em', null, extra.badge)),
  h('span', { class: 'fa-rt', 'aria-hidden': 'true' }, sized(h('i'), 'width', `${Math.max(n > 0 ? 2 : 0, pctOfMax)}%`)),
  h('span', { class: 'fa-rn' }, num(n), extra.share != null && h('small', null, ` ${extra.share}%`)),
  extra.delta || h('span', { class: 'fa-delta' }));

function breakdown(title, group, empty) {
  const max = group.items[0]?.n || 0;
  return h('div', { class: 'card fa-card' }, h('h2', null, title),
    group.items.length ? group.items.map((it) => barRow(it.label, it.n, max ? Math.round((it.n / max) * 100) : 0, { share: it.share })) : h('p', { class: 'muted' }, empty));
}

function devicesCard(group) {
  const phone = group.items.find((i) => i.key === 'mobile');
  const desk = group.items.find((i) => i.key === 'desktop');
  const p = phone?.share || 0, d = desk?.share || 0;
  return h('div', { class: 'card fa-card' }, h('h2', null, 'Phone or computer'),
    group.total ? [
      h('div', { class: 'fa-split', role: 'img', 'aria-label': `${p}% phone, ${d}% computer or tablet` }, p > 0 && sized(h('i', { class: 'a' }), 'width', `${p}%`), d > 0 && sized(h('i', { class: 'b' }), 'width', `${d}%`)),
      h('div', { class: 'fa-legend' }, h('span', null, h('i', { class: 'a' }), 'Phone ', h('b', null, `${p}%`), h('small', null, ` (${num(phone?.n || 0)})`)), h('span', null, h('i', { class: 'b' }), 'Computer or tablet ', h('b', null, `${d}%`), h('small', null, ` (${num(desk?.n || 0)})`))),
      p >= 60 && h('p', { class: 'muted' }, 'Most people find you on a phone, so the Call and Message buttons matter most.'),
    ] : h('p', { class: 'muted' }, 'Appears once visitors have been counted.'));
}

function weekdayCard(report) {
  const max = Math.max(1, ...report.weekdays.map((d) => d.average));
  const order = [1, 2, 3, 4, 5, 6, 0].map((i) => report.weekdays[i]);
  return h('div', { class: 'card fa-card' }, h('h2', null, 'Busiest days'), h('p', { class: 'muted fa-sub' }, 'Average page views per day of the week'),
    h('div', { class: 'fa-week' }, order.map((d) => h('div', { class: 'fa-wd' }, h('span', { class: 'fa-wv' }, d.average ? (d.average >= 10 ? Math.round(d.average) : d.average) : ''),
      sized(h('i', { title: `${d.name}: ${d.average} a day on average` }), 'height', `${Math.max(d.average > 0 ? 3 : 0, Math.round((d.average / max) * 72))}px`), h('span', { class: 'fa-wn' }, d.name.slice(0, 3))))));
}

function tableView(report) {
  return h('details', { class: 'fa-table' }, h('summary', null, 'View the daily numbers as a table'),
    h('div', { class: 'fa-tscroll' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Day'), METRICS.map((m) => h('th', { class: 'n' }, m.label)))),
      h('tbody', null, [...report.series].reverse().map((s) => h('tr', null, h('td', null, dayText(s.day, { weekday: 'short', month: 'short', day: 'numeric' })), METRICS.map((m) => h('td', { class: 'n' }, num(s[m.key])))))))));
}

// ---------------------------------------------------------------- the view
export function analyticsView({ base, mode = 'owner', slug, name = '', onPlanChange }) {
  const root = h('div', { class: 'fa' });
  let days = 30, metricKey = 'views', data = null, resizeObs = null;

  async function load() {
    root.replaceChildren(h('p', { class: 'muted' }, 'Loading your analytics…'));
    try {
      data = await api('GET', `${base}/analytics?days=${days}`);
      draw();
    } catch (err) { root.replaceChildren(note('msg-err', err.message)); }
  }

  const startTrial = async (btn) => {
    btn.disabled = true;
    try { await api('POST', `${base}/trial`); if (onPlanChange) onPlanChange(); await load(); }
    catch (err) { btn.disabled = false; btn.after(note('msg-err', err.message)); }
  };

  const adminTrial = async (method, body) => {
    try { await api(method, `${base}/trial`, body); await load(); } catch (err) { root.prepend(note('msg-err', err.message)); }
  };

  // ---- Basic firms: their own 30-day numbers, and what Featured would add
  function lockedView() {
    const { summary: s, plan } = data;
    const tile = (n, label) => h('div', { class: 'lx-tile' }, h('b', null, num(n)), h('span', null, label));
    const used = plan.trial && plan.trial.status !== 'active';
    return h('div', null,
      h('div', { class: 'lx-tiles' }, tile(s.views, 'Page views, last 30 days'), tile(s.visitors, 'Visitors'), tile(s.clicks, 'Button clicks'), tile(s.enquiries, 'Enquiries')),
      h('div', { class: 'card lx-locked' },
        used ? h('p', { class: 'fa-banner ended' }, `Your free month ended on ${fmtEnd(plan.trial.endsAt)}.`, plan.trial.views != null ? ` During it your page had ${num(plan.trial.views)} views, ${num(plan.trial.actions)} button clicks and ${num(plan.trial.enquiries)} enquiries.` : '') : null,
        h('h2', null, 'See what your visitors do'),
        h('p', { class: 'muted' }, 'On the Basic plan you see these four totals. Featured opens the full dashboard:'),
        h('ul', { class: 'lx-perks' }, [
          'A daily chart of page views, visitors, clicks and enquiries, compared with the period before',
          'Every button counted: calls, messages, emails, website, directions, booking, social profiles and your articles',
          'Where visitors came from: Google, other sites, social networks or LawDB itself',
          'Phone or computer, and which provinces your visitors are in',
          'Your busiest days, a plain-language summary, a spreadsheet export and a weekly email',
        ].map((t) => h('li', null, t))),
        plan.trialAvailable ? h('div', null,
          h('div', { class: 'row' }, (() => { const b = h('button', { class: 'primary', type: 'button' }, `Start your free month`); b.addEventListener('click', () => startTrial(b)); return b; })()),
          h('p', { class: 'muted' }, `No card needed. Your listing is Featured for ${plan.trialDays} days with everything above, then goes back to Basic by itself unless you subscribe (${plan.price}).`))
        : plan.upgradeUrl ? h('div', null, h('a', { href: plan.upgradeUrl, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, `Upgrade to Featured, ${plan.price}`)), h('p', { class: 'muted' }, 'Cancel any time. Checkout opens on Stripe.'))
        : h('p', { class: 'muted' }, 'Upgrading is not available right now.')));
  }

  // ---- the banner about the free month
  function trialBanner() {
    const t = data.plan.trial;
    if (mode === 'admin') {
      return h('div', { class: 'fa-banner admin' },
        h('span', null, t ? `Free month: ${t.status}${t.status === 'active' ? `, ends ${fmtEnd(t.endsAt)}` : ''} (${t.source === 'admin' ? 'given by you' : 'started by the owner'}).` : 'No free month used.'),
        h('span', { class: 'row' },
          (!t || t.status !== 'active') && !data.plan.featured && (() => { const b = h('button', { type: 'button' }, 'Give a free month (30 days)'); b.addEventListener('click', () => adminTrial('POST', { days: 30 })); return b; })(),
          t && t.status === 'active' && (() => { const b = h('button', { type: 'button' }, 'Add another 30 days'); b.addEventListener('click', () => adminTrial('POST', { days: 30 })); return b; })(),
          t && t.status === 'active' && (() => { const b = h('button', { type: 'button', title: 'The firm stays Featured with no end date, like a plan you set by hand' }, 'Keep Featured for good'); b.addEventListener('click', () => adminTrial('POST', { keep: true })); return b; })(),
          t && t.status === 'active' && (() => { const b = h('button', { type: 'button' }, 'End it now'); b.addEventListener('click', () => adminTrial('DELETE')); return b; })()));
    }
    if (!t || t.status !== 'active') return null;
    const left = t.daysLeft;
    return h('div', { class: 'fa-banner' },
      h('span', null, h('b', null, 'Your free month of Featured: '), `${left} ${left === 1 ? 'day' : 'days'} left (until ${fmtEnd(t.endsAt)}). Nothing is charged.`),
      data.plan.upgradeUrl ? h('a', { href: data.plan.upgradeUrl, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, `Keep Featured, ${data.plan.price}`)) : null);
  }

  function fullView() {
    const r = data.report, t = r.totals, p = r.previous;
    const metric = METRICS.find((m) => m.key === metricKey);
    const chartBox = h('div', { class: 'fa-chart' });

    const tiles = METRICS.map((m) => {
      const now = t[m.key], before = p[m.key];
      const chip = deltaChip(r.change[m.key], now, before);
      const b = h('button', { type: 'button', class: 'fa-kpi' + (m.key === metricKey ? ' on' : ''), 'aria-pressed': m.key === metricKey ? 'true' : 'false', title: m.hint },
        h('span', { class: 'fa-kl' }, m.label), h('b', null, num(now)), chip, h('small', null, `${num(before)} before`));
      b.addEventListener('click', () => { metricKey = m.key; draw(); });
      return b;
    });

    const rangeBtns = [7, 30, 90].map((n) => {
      const b = h('button', { type: 'button', class: n === days ? 'primary' : '', 'aria-pressed': n === days ? 'true' : 'false' }, `${n} days`);
      b.addEventListener('click', () => { days = n; load(); });
      return b;
    });

    const maxAct = r.actions[0]?.n || 0;
    const actionsCard = h('div', { class: 'card fa-card wide' },
      h('div', { class: 'row spread' }, h('h2', null, 'What visitors did on your page'), h('span', { class: 'fa-key' }, h('i', { class: 'gold' }), ' contact you ', h('i', null), ' other')),
      r.actions.some((a) => a.n > 0)
        ? r.actions.filter((a) => a.n > 0 || a.contact).map((a) => barRow(a.label, a.n, maxAct ? Math.round((a.n / maxAct) * 100) : 0, { gold: a.contact, share: a.share, delta: deltaChip(a.delta, a.n, a.prev) }))
        : h('p', { class: 'muted' }, 'No button has been clicked in this period yet. Calls, messages, emails, website and directions clicks show up here as they happen.'));

    const insights = r.insights.length ? h('div', { class: 'card fa-card fa-insights' }, h('h2', null, 'What we noticed'), h('ul', null, r.insights.map((i) => h('li', null, i)))) : null;

    const skip = mode === 'owner' ? (() => {
      const box = h('input', { type: 'checkbox', checked: skipState() !== '0', id: 'fa-skip' });
      box.addEventListener('change', () => setSkip(box.checked));
      const rep = h('input', { type: 'checkbox', checked: !data.reportsOff, id: 'fa-rep' });
      rep.addEventListener('change', async () => { try { await api('PATCH', `${base}/reports`, { off: !rep.checked }); } catch (err) { rep.checked = !rep.checked; } });
      return h('div', { class: 'fa-prefs' },
        h('label', { for: 'fa-skip' }, box, " Don't count my own visits from this device"),
        h('label', { for: 'fa-rep' }, rep, ' Email me a weekly summary on Mondays'));
    })() : null;

    const csv = mode === 'owner' ? h('a', { class: 'fa-csv', href: `${base}/analytics.csv?days=${days}`, download: '' }, h('button', { type: 'button' }, 'Download as spreadsheet')) : null;

    const view = h('div', null,
      trialBanner(),
      h('div', { class: 'row spread fa-top' },
        h('p', { class: 'muted fa-range' }, `${dayText(r.from, { month: 'short', day: 'numeric', year: 'numeric' })} to ${dayText(r.to, { month: 'short', day: 'numeric', year: 'numeric' })}, compared with the ${days} days before`),
        h('div', { class: 'row' }, rangeBtns, csv)),
      h('div', { class: 'fa-kpis' }, tiles),
      h('div', { class: 'card fa-card' },
        h('div', { class: 'row spread' }, h('h2', null, `${metric.label} per day`), h('span', { class: 'fa-key' }, h('i', { class: 'line ' + metric.tone }), ' this period ', h('i', { class: 'dash' }), ' period before')),
        chartBox,
        r.since === null && h('p', { class: 'muted' }, 'Nothing counted yet. Numbers appear within a minute of the first visit.'),
        tableView(r)),
      insights,
      actionsCard,
      h('div', { class: 'fa-grid3' },
        breakdown('Where visitors came from', r.sources, 'Appears once visitors have been counted.'),
        devicesCard(r.devices),
        breakdown('Where visitors are', r.regions, 'Appears once visitors have been counted.')),
      h('div', { class: 'fa-grid2' }, weekdayCard(r),
        r.campaigns.items.length ? breakdown('Your campaign links', r.campaigns, '') : h('div', { class: 'card fa-card' }, h('h2', null, 'Your campaign links'), h('p', { class: 'muted' }, 'Add ?utm_source=newsletter (or any word) to the link to your LawDB page in an email, post or advert, and see here how many visitors each one brought.'))),
      skip,
      h('p', { class: 'muted fa-foot' }, 'LawDB counts page views and button clicks. It does not store who visited: no names, no addresses, no cookies. A visitor is one browser visit to your page, so the same person on a different day or device counts again. Numbers update within a minute.'));

    queueMicrotask(() => {
      const draw1 = () => lineChart(r, metric, chartBox.getBoundingClientRect().width || 640, chartBox);
      draw1();
      if (resizeObs) resizeObs.disconnect();
      if ('ResizeObserver' in window) { let last = 0; resizeObs = new ResizeObserver(() => { const w = chartBox.getBoundingClientRect().width; if (Math.abs(w - last) > 4) { last = w; draw1(); } }); resizeObs.observe(chartBox); }
    });
    return view;
  }

  function draw() {
    if (mode === 'owner' && !data.locked && skipState() === null) setSkip(true); // the owner's own visits are not counted by default
    root.replaceChildren(h('h1', null, `Analytics${data.name ? ' for ' + data.name : name ? ' for ' + name : ''}`), data.locked ? lockedView() : fullView());
  }

  load();
  return root;
}
