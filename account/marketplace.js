// The Lead Marketplace tab of the owner dashboard (only shown while the admin has opened the marketplace). A verified firm sees blurred previews (no name, email or phone),
// unlocks the ones it wants with prepaid credits, reads what it unlocked, reports junk within 48 hours, and sets what it wants to see and how it is told.
// SECURITY: everything is inserted as text nodes (the person's own words included), never as HTML.
import { h, api, when, note, PROVINCES } from '/admin/ui.js';

// The dashboard's content security policy refuses style attributes, so styling goes through the style object.
const styled = (el, css) => { Object.assign(el.style, css); return el; };
const credits = (n) => `${n} credit${n === 1 ? '' : 's'}`;
const ago = (m) => (m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`);

export async function viewMarket(slug, firmName) {
  const base = `/api/account/firms/${encodeURIComponent(slug)}/marketplace`;
  const info = await api('GET', base);
  const title = h('h1', null, 'Lead Marketplace');
  if (!info.open) return h('div', null, title, h('div', { class: 'card' }, h('p', null, 'The Lead Marketplace is not open yet. When it opens, this is where verified firms preview and unlock inquiries.')));
  if (!info.eligible) {
    return h('div', null, title, h('div', { class: 'card' }, h('h2', null, firmName),
      h('p', null, info.reason),
      h('a', { href: `#edit/${slug}` }, h('button', { class: 'primary', type: 'button' }, 'Open My firm'))));
  }

  let state = info, section = 'board', widen = false, area = '', city = '';
  const body = h('div'), balance = h('b', { class: 'mk-bal' });
  const drawBalance = () => balance.textContent = credits(state.balance);

  const header = () => h('div', { class: 'card' },
    h('div', { class: 'row spread' }, h('div', null, h('span', { class: 'muted' }, 'Your balance'), styled(h('div', null, balance), { fontSize: '1.6rem' })),
      state.topUps.length
        ? h('div', { class: 'row' }, state.topUps.map((t) => h('a', { href: t.url, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, `Add ${t.credits} credits`))))
        : h('span', { class: 'muted small' }, 'Credits are added by LawDB for now. Write to info@lawdb.ca to add some.')),
    h('p', { class: 'muted small' }, `Each inquiry goes to one firm: the first to unlock it. It is a flat fee that does not depend on whether the person hires you. Prices drop ${state.rules.discountPercent}% after ${state.rules.fullHours} hours, and an inquiry expires after ${state.rules.expiryDays} days.${state.firm.featured ? ` Because you are Featured, you see new inquiries ${state.rules.headStartMinutes} minutes before other firms.` : ''}`));

  const tabs = () => h('div', { class: 'row' }, [['board', 'Inquiries'], ['mine', 'Unlocked'], ['settings', 'Settings'], ['ledger', 'Credits']].map(([id, label]) =>
    h('button', { type: 'button', class: id === section ? 'primary' : '', onclick: () => { section = id; draw(); } }, label)));

  // ---- the board
  async function board() {
    const box = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
    const qs = new URLSearchParams();
    if (widen) qs.set('widen', '1');
    if (area) qs.set('area', area);
    if (city) qs.set('city', city);
    const data = await api('GET', `${base}/board?${qs}`);
    state.balance = data.balance; drawBalance();
    const filters = h('div', { class: 'row' },
      h('select', { 'aria-label': 'Practice area', onchange: (e) => { area = e.target.value; draw(); } }, h('option', { value: '' }, 'My practice areas'), Object.entries(state.areas).map(([k, v]) => h('option', { value: k, selected: k === area }, v))),
      h('input', { type: 'text', placeholder: 'City', 'aria-label': 'City', value: city, onchange: (e) => { city = e.target.value.trim(); draw(); } }),
      h('label', null, h('input', { type: 'checkbox', checked: widen, onchange: (e) => { widen = e.target.checked; draw(); } }), ' Show every province and practice area'));
    const cards = data.leads.length ? data.leads.map((l) => leadCard(l)) : [h('p', { class: 'muted' }, 'No inquiries match right now. New ones appear here as they come in, and we email you when one matches (see Settings).')];
    box.replaceChildren(filters, ...cards);
    return box;
  }
  function leadCard(l) {
    const msg = h('span', { class: 'muted small', 'aria-live': 'polite' });
    const btn = h('button', { class: 'primary', type: 'button' }, `Unlock for ${credits(l.price)}`);
    btn.addEventListener('click', async () => {
      if (!confirm(`Unlock this inquiry for ${credits(l.price)}? The person's name, email and phone are shown after you unlock it, and you cannot undo it.`)) return;
      btn.disabled = true;
      try { const r = await api('POST', `${base}/leads/${l.id}/unlock`); state.balance = r.balance; drawBalance(); section = 'mine'; draw(); }
      catch (err) { msg.replaceChildren(note('msg-err', err.message)); btn.disabled = false; }
    });
    return h('article', { class: 'card lead' },
      h('div', { class: 'row spread' }, h('b', null, `${l.practiceAreaLabel} · ${[l.city, l.province].filter(Boolean).join(', ')}`), h('span', { class: 'badge new' }, l.urgencyLabel)),
      h('div', { class: 'body' }, l.summary),
      h('div', { class: 'meta' }, h('span', null, ago(l.ageMinutes)), h('span', null, l.priceTier === 'discount' ? 'Reduced price' : 'Full price'), l.headStart && h('span', null, 'You see it first (Featured)')),
      h('div', { class: 'row' }, btn, msg));
  }

  // ---- what this firm unlocked
  async function mine() {
    const data = await api('GET', `${base}/unlocked`);
    if (!data.leads.length) return h('p', { class: 'muted' }, 'You have not unlocked any inquiries yet.');
    return h('div', null, data.leads.map((l) => {
      const msg = h('span', { 'aria-live': 'polite' });
      const reasons = { disconnected: 'The phone number is disconnected', spam: 'It is spam', fake: 'It is fake', other: 'Something else' };
      const sel = h('select', { 'aria-label': 'Why is it junk?' }, Object.entries(reasons).map(([k, v]) => h('option', { value: k }, v)));
      const why = h('input', { type: 'text', maxlength: 300, placeholder: 'What is wrong with it? (optional)', 'aria-label': 'Note' });
      const report = h('div', { class: 'row' }, sel, why, h('button', { type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        try { await api('POST', `${base}/unlocked/${l.id}/report`, { reason: sel.value, note: why.value }); draw(); }
        catch (err) { msg.replaceChildren(note('msg-err', err.message)); e.target.disabled = false; }
      } }, 'Report as junk'));
      return h('article', { class: 'card lead' },
        h('div', { class: 'row spread' }, h('b', null, l.name || '(no name)'), h('span', { class: 'muted' }, `${l.practiceAreaLabel} · ${[l.city, l.province].filter(Boolean).join(', ')}`)),
        h('div', { class: 'meta' }, l.email && h('a', { href: 'mailto:' + l.email }, l.email), l.phone && h('a', { href: 'tel:' + l.phone.replace(/[^\d+]/g, '') }, l.phone), h('span', null, `Unlocked ${when(l.unlockedAt)} for ${credits(l.pricePaid)}`)),
        h('div', { class: 'body' }, l.description),
        l.report ? h('p', { class: 'muted' }, l.report.status === 'open' ? 'You reported this inquiry. We will review it.' : l.report.status === 'approved' ? 'Reported: the credits were returned.' : `Reported: not refunded.${l.report.note ? ' ' + l.report.note : ''}`)
          : l.canReport ? h('div', null, h('p', { class: 'muted small' }, `If it is clearly junk (a disconnected number, spam or a fake request) you can report it until ${when(l.reportUntil)}. Credits are returned only for junk, never because the person did not hire you.`), report, msg) : null);
    }));
  }

  // ---- settings
  function settings() {
    const areas = new Set(state.prefs.practiceAreas), provs = new Set(state.prefs.provinces);
    const msg = h('span', { 'aria-live': 'polite' });
    const checks = (set, all, label) => Object.entries(all).map(([k, v]) => styled(h('label', null, h('input', { type: 'checkbox', checked: set.has(k), onchange: (e) => { e.target.checked ? set.add(k) : set.delete(k); } }), label(k, v)), { display: 'inline-flex', gap: '6px', margin: '4px 14px 4px 0' }));
    const cities = h('input', { type: 'text', value: state.prefs.cities.join(', '), placeholder: 'All cities', 'aria-label': 'Cities' });
    const alerts = h('select', { 'aria-label': 'Alerts' }, [['instant', 'Email me as soon as an inquiry matches'], ['daily', 'One email a day'], ['off', 'No emails']].map(([v, t]) => h('option', { value: v, selected: v === state.alerts }, t)));
    return h('div', { class: 'card' },
      h('h2', null, 'What you want to see'),
      h('p', { class: 'muted' }, 'Practice areas'), h('div', null, checks(areas, state.areas, (k, v) => v)),
      h('p', { class: 'muted' }, 'Provinces'), h('div', null, checks(provs, Object.fromEntries(state.provinces.map((p) => [p, PROVINCES[p] || p])), (k, v) => v)),
      h('p', { class: 'muted' }, 'Cities (optional, separated by commas; empty means all)'), cities,
      h('p', { class: 'muted' }, 'Alerts'), alerts,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await api('PATCH', base, { practiceAreas: [...areas], provinces: [...provs], cities: cities.value.split(',').map((c) => c.trim()).filter(Boolean), alerts: alerts.value });
          state.prefs = r.prefs; state.alerts = r.alerts; msg.replaceChildren(note('muted', 'Saved'));
        } catch (err) { msg.replaceChildren(note('msg-err', err.message)); }
        e.target.disabled = false;
      } }, 'Save'), msg));
  }

  // ---- credits
  async function ledger() {
    const data = await api('GET', `${base}/ledger`);
    if (!data.ledger.length) return h('p', { class: 'muted' }, 'No credit activity yet.');
    return h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'What', 'Credits'].map((t) => h('th', null, t)))),
      h('tbody', null, data.ledger.map((r) => h('tr', null, h('td', null, when(r.createdAt)), h('td', null, r.note || r.type), h('td', null, `${r.amount > 0 ? '+' : ''}${r.amount}`)))));
  }

  async function draw() {
    drawBalance();
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const view = section === 'board' ? await board() : section === 'mine' ? await mine() : section === 'settings' ? settings() : await ledger();
      body.replaceChildren(tabs(), view);
    } catch (err) { body.replaceChildren(tabs(), note('msg-err', err.message)); }
  }
  drawBalance();
  const out = h('div', null, title, h('h2', null, firmName), header(), body);
  draw();
  return out;
}
