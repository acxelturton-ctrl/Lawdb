// The Lead Marketplace section of the admin area: open or close it, change prices and rules, review inquiries that are on hold, decide bad-lead reports, give credits,
// and see the ledger and the revenue. Firms are verified in the Firms section (Edit Profile, "Verified by LawDB"), as before.
// SECURITY: everything is inserted as text nodes (the person's own words included), never as HTML.
import { h, api, when, note } from './ui.js';

// The admin area's content security policy refuses style attributes, so styling goes through the style object.
const styled = (el, css) => { Object.assign(el.style, css); return el; };
const credits = (n) => `${n} credit${n === 1 ? '' : 's'}`;

export async function viewMarketplaceAdmin() {
  const root = h('div');
  let section = 'overview';
  const tabs = () => h('div', { class: 'row' }, [['overview', 'Overview and settings'], ['held', 'On hold'], ['reports', 'Reports'], ['firms', 'Firms and credits'], ['ledger', 'Ledger']].map(([id, label]) =>
    h('button', { type: 'button', class: id === section ? 'primary' : '', onclick: () => { section = id; draw(); } }, label)));

  async function overview() {
    const d = await api('GET', '/api/admin/marketplace');
    const c = d.config, s = d.stats, msg = h('div', { 'aria-live': 'polite' });
    const stat = (label, v) => h('div', { class: 'lx-tile' }, h('b', null, String(v)), h('span', null, label));
    const num = (key, v, step = 1) => styled(h('input', { type: 'number', step: String(step), value: String(v), 'data-k': key }), { width: '7em' });
    const prices = Object.entries(d.areas).map(([k, label]) => styled(h('label', null, label, styled(h('input', { type: 'number', min: 1, value: String(c.prices[k]), 'data-price': k }), { width: '5.5em' })), { display: 'inline-flex', gap: '6px', alignItems: 'center', margin: '4px 14px 4px 0' }));
    const hold = Object.entries(d.areas).map(([k, label]) => styled(h('label', null, h('input', { type: 'checkbox', 'data-hold': k, checked: c.holdAreas.includes(k) }), label), { display: 'inline-flex', gap: '6px', margin: '4px 14px 4px 0' }));
    const rules = h('div', null,
      h('p', null, 'Full price for the first ', num('fullHours', c.fullHours, 'any'), ' hours, then ', num('discountPercent', c.discountPercent), '% off, and the inquiry expires after ', num('expiryDays', c.expiryDays, 'any'), ' days.'),
      h('p', null, 'Featured firms see a new inquiry ', num('headStartMinutes', c.headStartMinutes, 'any'), ' minutes before everyone else. A bad-lead report is allowed for ', num('reportHours', c.reportHours, 'any'), ' hours after unlocking.'),
      h('p', null, 'Alerts: up to ', num('alertWaveSize', c.alertWaveSize), ' firms per wave, ', num('alertGapMinutes', c.alertGapMinutes, 'any'), ' minutes apart, at most ', num('alertMaxWaves', c.alertMaxWaves), ' waves. Welcome credits for a firm that joins: ', num('welcomeCredits', c.welcomeCredits), '.'));
    const save = h('button', { class: 'primary', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      const body = { prices: {}, holdAreas: [] };
      for (const el of rules.querySelectorAll('[data-k]')) body[el.dataset.k] = Number(el.value);
      for (const el of prices) body.prices[el.querySelector('input').dataset.price] = Number(el.querySelector('input').value);
      for (const el of hold) if (el.querySelector('input').checked) body.holdAreas.push(el.querySelector('input').dataset.hold);
      try { await api('PUT', '/api/admin/marketplace/config', body); msg.replaceChildren(note('muted', 'Saved')); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); }
      e.target.disabled = false;
    } }, 'Save settings');
    const toggle = h('button', { class: c.open ? '' : 'primary', type: 'button', onclick: async (e) => {
      const next = !c.open;
      if (!confirm(next ? 'Open the Lead Marketplace? The "tell us what you need" request page, the optional box on firm forms, the firm dashboard tab and the alerts go live. Only verified firms can unlock anything.' : 'Close the Lead Marketplace? New requests stop, the firm tab disappears and no alerts are sent. Credits and unlocked inquiries are kept.')) return;
      e.target.disabled = true;
      try { await api('PUT', '/api/admin/marketplace/config', { open: next }); draw(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); e.target.disabled = false; }
    } }, c.open ? 'Close the Lead Marketplace' : 'Open the Lead Marketplace');
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, c.open ? 'The Lead Marketplace is open' : 'The Lead Marketplace is closed'),
        h('p', { class: 'muted' }, c.open ? 'People can send requests, verified firms can unlock them, and alerts go out.' : 'Nothing below is reachable by the public or by firms until you open it. The public page says nothing is available yet.'), toggle),
      h('div', { class: 'lx-tiles' }, stat('Listed now', s.leads.approved || 0), stat('On hold', s.leads.held || 0), stat('Unlocked', s.unlocks), stat('Net revenue', credits(s.netRevenue)), stat('Firms', s.firms), stat('Firm balances', credits(s.balances)), stat('Open reports', s.openReports)),
      h('p', { class: 'muted small' }, `Credits are dollars. Sold by unlocks: ${credits(s.creditsSold)}, refunded: ${credits(s.creditsRefunded)}. Top-ups: ${credits(s.topUps)} in ${s.topUpCount} payments. Granted or adjusted by you: ${credits(s.granted)}.`),
      h('div', { class: 'card' }, h('h2', null, 'Prices (credits)'), h('div', null, prices), h('h2', null, 'Rules'), rules,
        h('h2', null, 'Always hold for review'), h('p', { class: 'muted small' }, 'Inquiries that mention abuse, violence, self-harm, threats or a minor always wait for you. Tick a practice area to hold all of its inquiries too.'), h('div', null, hold),
        h('div', { class: 'row' }, save, msg)));
  }

  async function held() {
    const d = await api('GET', '/api/admin/marketplace/leads?status=held');
    if (!d.leads.length) return h('p', { class: 'muted' }, 'Nothing is waiting for review.');
    return h('div', null, d.leads.map((l) => {
      const msg = h('span');
      const act = (action) => async (e) => { e.target.disabled = true; try { await api('POST', `/api/admin/marketplace/leads/${l.id}/decision`, { action }); draw(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); e.target.disabled = false; } };
      return h('article', { class: 'card lead' },
        h('div', { class: 'row spread' }, h('b', null, `#${l.id} ${l.practiceAreaLabel} · ${[l.city, l.province].filter(Boolean).join(', ')}`), h('span', { class: 'badge new' }, l.hold_reason || 'on hold')),
        h('div', { class: 'meta' }, l.details && h('span', null, `${l.details.name} · ${l.details.email}${l.details.phone ? ' · ' + l.details.phone : ''}`), h('span', null, when(l.created_at)), h('span', null, l.source === 'firm-page' ? 'From a firm page' : 'General request')),
        h('div', { class: 'body' }, l.details ? l.details.description : ''),
        h('p', { class: 'muted small' }, `What firms would see: ${l.summary_public}`),
        h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onclick: act('approve') }, 'Approve and list it'), h('button', { type: 'button', onclick: act('reject') }, 'Reject (clears the details)'), msg));
    }));
  }

  async function reports() {
    const d = await api('GET', '/api/admin/marketplace/reports');
    if (!d.reports.length) return h('p', { class: 'muted' }, 'No reports waiting.');
    return h('div', null, d.reports.map((r) => {
      const note1 = h('input', { type: 'text', maxlength: 300, placeholder: 'A note to the firm (optional)', 'aria-label': 'Note' }), msg = h('span');
      const act = (action) => async (e) => { e.target.disabled = true; try { await api('POST', `/api/admin/marketplace/reports/${r.id}/decision`, { action, note: note1.value }); draw(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); e.target.disabled = false; } };
      return h('article', { class: 'card lead' },
        h('div', { class: 'row spread' }, h('b', null, `${r.firmName || r.firmSlug} reported inquiry #${r.leadId}`), h('span', { class: 'badge new' }, r.reasonLabel)),
        h('div', { class: 'meta' }, r.details && h('span', null, `${r.details.name} · ${r.details.email} · ${r.details.phone || 'no phone'}`), h('span', null, `Paid ${credits(r.pricePaid)}`), h('span', null, when(r.createdAt))),
        r.details && h('div', { class: 'body' }, r.details.description), r.note && h('p', null, `Firm's note: ${r.note}`),
        h('p', { class: 'muted small' }, 'Refund only clear junk (a disconnected number, spam, a fake request), as credit. Never because the person did not hire the firm.'),
        h('div', { class: 'row' }, note1, h('button', { class: 'primary', type: 'button', onclick: act('approve') }, `Refund ${credits(r.pricePaid)}`), h('button', { type: 'button', onclick: act('deny') }, 'Deny'), msg));
    }));
  }

  async function firms() {
    const d = await api('GET', '/api/admin/marketplace/firms');
    const slug = h('input', { type: 'text', placeholder: 'Firm address (slug)', 'aria-label': 'Firm slug', list: 'mkFirms' }), amount = styled(h('input', { type: 'number', placeholder: 'Credits (negative takes away)', 'aria-label': 'Credits' }), { width: '12em' });
    const why = h('input', { type: 'text', placeholder: 'Note', 'aria-label': 'Note' }), msg = h('span', { 'aria-live': 'polite' });
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, 'Give or adjust credits'),
        h('datalist', { id: 'mkFirms' }, d.firms.map((f) => h('option', { value: f.slug }, f.name))),
        h('div', { class: 'row' }, slug, amount, why, h('button', { class: 'primary', type: 'button', onclick: async (e) => {
          e.target.disabled = true;
          const n = Number(amount.value);
          try { const r = await api('POST', `/api/admin/marketplace/firms/${encodeURIComponent(slug.value.trim())}/credits`, { amount: n, note: why.value, type: n < 0 ? 'adjust' : 'promo' }); msg.replaceChildren(note('muted', `Done. New balance: ${credits(r.balance)}`)); draw(); }
          catch (err) { msg.replaceChildren(note('msg-err', err.message)); e.target.disabled = false; }
        } }, 'Apply'), msg)),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Firm', 'Verified', 'Featured', 'Balance', 'Unlocked', 'Alerts'].map((t) => h('th', null, t)))),
        h('tbody', null, d.firms.map((f) => h('tr', null, h('td', null, h('a', { href: `#firms/edit/${f.slug}` }, f.name), h('small', null, ` ${f.city}, ${f.province}`)), h('td', null, f.verification === 'verified' ? 'Yes' : 'No'), h('td', null, f.featured ? 'Yes' : ''), h('td', null, String(f.balance)), h('td', null, String(f.unlocks)), h('td', null, f.alerts))))));
  }

  async function ledger() {
    const d = await api('GET', '/api/admin/marketplace/ledger');
    if (!d.ledger.length) return h('p', { class: 'muted' }, 'No credit activity yet.');
    return h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Firm', 'Type', 'Credits', 'Note'].map((t) => h('th', null, t)))),
      h('tbody', null, d.ledger.map((r) => h('tr', null, h('td', null, when(r.createdAt)), h('td', null, r.firmSlug), h('td', null, r.type), h('td', null, `${r.amount > 0 ? '+' : ''}${r.amount}`), h('td', null, r.note || r.stripeRef || '')))));
  }

  async function draw() {
    root.replaceChildren(h('h1', null, 'Lead Marketplace'), tabs(), h('p', { class: 'muted' }, 'Loading…'));
    try { root.replaceChildren(h('h1', null, 'Lead Marketplace'), tabs(), await { overview, held, reports, firms, ledger }[section]()); }
    catch (err) { root.replaceChildren(h('h1', null, 'Lead Marketplace'), tabs(), note('msg-err', err.message)); }
  }
  await draw();
  return root;
}
