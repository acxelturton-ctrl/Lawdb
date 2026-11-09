// The "Edit Profile" page, laid out like the MSPdatabase admin: a title with the @handle, a collapsible Profile Images bar, three columns of cards
// (Basic Information, Website & Blog, Location), then Description, Address and Opening hours, and a Save bar that stays at the bottom and is greyed out
// until something changes. One editor for three jobs:
//   mode 'admin'  the admin edits any firm (every field);
//   mode 'owner'  an approved owner edits their own firm: the facts, the description and the tagline always, and what is a Featured benefit (booking
//                 link, second enquiry email, pictures) only on a Featured plan; the city, map position, status and plan are shown but not editable;
//   mode 'new'    the admin adds a firm.
// Only the fields that changed are sent, so an owner on the Basic plan never trips over a locked field they did not touch.
// SECURITY: every value is put in with text nodes or element properties, never innerHTML.

import { verificationPanel } from './verification-panel.js';
import { h, api, when, note, hoursEditor, categoryChecks, splitTags, picturesPanel, feedPanel, planPanel, startFreeMonth, PROVINCES } from './ui.js';

// The languages an owner can pick, and the availability choices. Kept in step with src/lib/details.js (LANGUAGES) and src/lib/profile-strength.js
// (AVAILABILITY) by scripts/test-profile-strength.mjs.
export const LANGUAGES = ['English', 'French', 'Spanish', 'Punjabi', 'Hindi', 'Urdu', 'Gujarati', 'Tamil', 'Bengali', 'Arabic', 'Persian', 'Farsi', 'Mandarin', 'Cantonese', 'Korean', 'Vietnamese', 'Tagalog', 'Portuguese', 'Italian', 'Polish', 'Russian', 'Ukrainian', 'Greek', 'German', 'Dutch', 'Turkish', 'Japanese', 'Hebrew', 'Somali', 'Amharic', 'Swahili'];
export const AVAILABILITY = { accepting: 'Accepting new clients', limited: 'Limited availability', closed: 'Not accepting new clients' };
export const SOCIALS = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['x', 'X'], ['youtube', 'YouTube']];
const PROV_SLUG = { ON: 'ontario', QC: 'quebec', BC: 'british-columbia', AB: 'alberta', MB: 'manitoba' };
export const citySlug = (c) => String(c).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Small line icons for the card headings (drawn with createElementNS, not innerHTML).
const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS = {
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  pin: 'M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  text: 'M5 6h14M5 11h14M5 16h9',
  home: 'M4 11l8-6 8 6v8H4zM10 19v-5h4v5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
};
function icon(name) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.9'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', ICONS[name]); svg.appendChild(p);
  return svg;
}

const card = (title, ic, ...kids) => h('section', { class: 'ed-card' }, h('h2', null, icon(ic), title), ...kids);
let uid = 0;
// A label with its control: the label is tied to the control (for/id), so clicking it focuses the field and screen readers read it out.
const fld = (label, el, hint, lockedNote) => {
  const id = el.id || (el.id = 'ed' + (++uid));
  // A field that needs Featured stays visible, greyed out, with a gold "Featured" tag on its label and a line saying why (lockedNote is that line).
  return h('div', { class: 'ed-field' + (lockedNote ? ' is-locked' : '') }, h('label', { for: id }, label, lockedNote && h('span', { class: 'ed-pill' }, icon('lock'), 'Featured')), el, lockedNote && (lockedNote.nodeType ? lockedNote : h('p', { class: 'ed-lock' }, icon('lock'), lockedNote)), hint && h('p', { class: 'ed-hint' }, hint));
};
const text = (value, props) => h('input', { type: 'text', value: value ?? '', ...props });
const sameList = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function profileEditor({ mode, data, base, onSaved, onCreated, flash }) {
  const isNew = mode === 'new';
  const admin = mode === 'admin' || isNew;
  const firm = data.firm || {};
  const slug = data.slug || '';
  // Owners: a Basic firm writes its own description and tagline and keeps its facts up to date. A booking link, a second enquiry email and
  // pictures are Featured benefits, shown here greyed out with the reason.
  const locked = mode === 'owner' && !firm.featured;
  // Opens "Your plan" at the top, which has the free-month and upgrade buttons.
  let planEl = null;
  const openPlan = () => { if (planEl) { planEl.open = true; planEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  const lockNote = (why) => h('p', { class: 'ed-lock' }, icon('lock'), h('span', null, why, ' ', h('button', { type: 'button', class: 'linkish', onclick: openPlan }, 'Unlock with Featured')));
  const social0 = firm.social && typeof firm.social === 'object' ? firm.social : {};
  const offices0 = (Array.isArray(firm.offices) ? firm.offices : []).map((o) => ({ name: o.name || '', address: o.address || '' }));

  const details0 = firm.details && typeof firm.details === 'object' ? firm.details : {};
  const lang0 = (Array.isArray(details0.languages) ? details0.languages : []).filter((l) => LANGUAGES.includes(l));

  // ---- the controls
  const c = {
    name: text(firm.name, { maxlength: 200, required: true, 'aria-label': 'Official firm name' }),
    blurb: h('textarea', { maxlength: 500, rows: 2, placeholder: 'A short line shown in lists and search results' }, firm.blurb || ''),
    tags: text((firm.tags || []).join(', '), { placeholder: 'Divorce, Child Custody' }),
    website: text(firm.website, { maxlength: 300, placeholder: 'https://' }),
    bookingUrl: text(firm.bookingUrl, { maxlength: 500, placeholder: locked ? 'https://calendly.com/your-firm' : 'https://', disabled: locked }),
    about: h('textarea', { class: 'tall', maxlength: 2000, placeholder: 'Tell clients about your firm, who you help and how you work.' }, firm.about || ''),
    enquiryEmail: h('input', { type: 'email', value: data.enquiryEmail || '', maxlength: 254, placeholder: locked ? 'intake@your-firm.ca' : 'intake@yourfirm.ca', disabled: locked, autocomplete: 'off', 'aria-label': 'Send enquiries to' }),
    address: text(firm.address, { maxlength: 300 }),
    phone: text(firm.phone, { maxlength: 30 }),
    city: text(firm.city, { maxlength: 80, disabled: !admin }),
    province: h('select', { disabled: !admin }, Object.entries(PROVINCES).map(([code, name]) => h('option', { value: code, selected: code === (firm.province || 'ON') }, name))),
    lat: text(firm.lat ?? '', { inputmode: 'decimal', disabled: !admin, placeholder: isNew ? 'Optional' : '' }),
    lng: text(firm.lng ?? '', { inputmode: 'decimal', disabled: !admin, placeholder: isNew ? 'Optional' : '' }),
    status: h('select', { disabled: !admin || data.status === 'pending' }, [['live', 'Live'], ['hidden', 'Hidden (shown nowhere)']].concat(data.status === 'pending' ? [['pending', 'Awaiting approval']] : [])
      .map(([v, l]) => h('option', { value: v, selected: v === (data.status || 'live') }, l))),
    featured: h('select', { disabled: !admin }, [[false, 'Basic'], [true, 'Featured']].map(([v, l]) => h('option', { value: String(v), selected: v === !!firm.featured }, l))),
    appointmentOnly: h('input', { type: 'checkbox', checked: !!firm.appointmentOnly }),
    availability: h('select', null, [['', 'Not set']].concat(Object.entries(AVAILABILITY)).map(([v, l]) => h('option', { value: v, selected: v === (firm.availability || '') }, l))),
    virtual: h('input', { type: 'checkbox', checked: firm.virtual === true }),
    founded: h('input', { type: 'number', min: 1850, max: new Date().getFullYear(), step: 1, inputmode: 'numeric', value: details0.founded ?? '', placeholder: 'For example 2009' }),
  };
  // Languages: a tick box for each, up to eight.
  const langBoxes = LANGUAGES.map((l) => { const input = h('input', { type: 'checkbox', value: l, checked: lang0.includes(l) }); return { l, input, el: h('label', { class: 'check ed-lang' }, input, l) }; });
  const langGrid = h('div', { class: 'ed-langs', role: 'group', 'aria-label': 'Languages you serve clients in' }, langBoxes.map((b) => b.el));
  const langsPicked = () => langBoxes.filter((b) => b.input.checked).map((b) => b.l);
  const social = Object.fromEntries(SOCIALS.map(([k]) => [k, text(social0[k] || '', { placeholder: 'https://', maxlength: 200 })]));
  const cats = categoryChecks(firm.caseTypes);
  const hrs = hoursEditor(data.hours);

  // Other offices: a name and an address each.
  const officeList = h('div', { class: 'office-list' });
  const officeRows = [];
  function addOffice(o = { name: '', address: '' }) {
    const name = text(o.name, { placeholder: 'Name (optional)', maxlength: 80, 'aria-label': 'Office name' });
    const address = text(o.address, { placeholder: 'Street address, city, province', maxlength: 300, 'aria-label': 'Office address' });
    const row = { name, address, el: null };
    const remove = h('button', { type: 'button', class: 'ed-x', 'aria-label': 'Remove this office', onclick: () => { officeRows.splice(officeRows.indexOf(row), 1); row.el.remove(); changed(); } }, '×');
    row.el = h('div', { class: 'office-row' }, name, address, remove);
    officeRows.push(row); officeList.append(row.el);
  }
  offices0.forEach(addOffice);

  // ---- what changed
  const currentOffices = () => officeRows.map((r) => ({ name: r.name.value.trim(), address: r.address.value.trim() })).filter((o) => o.address).map((o) => (o.name ? o : { address: o.address }));
  const num = (v) => (String(v).trim() === '' ? null : Number(v));
  function collect() {
    const p = {};
    const put = (k, v, was) => { if (JSON.stringify(v) !== JSON.stringify(was)) p[k] = v; };
    put('name', c.name.value.trim(), firm.name || '');
    if (!isNew) put('blurb', c.blurb.value.trim(), firm.blurb || '');
    put('about', c.about.value.trim(), (firm.about || '').trim());
    put('phone', c.phone.value.trim(), firm.phone || '');
    put('website', c.website.value.trim(), firm.website || '');
    if (!isNew) put('bookingUrl', c.bookingUrl.value.trim(), firm.bookingUrl || '');
    if (!isNew) put('enquiryEmail', c.enquiryEmail.value.trim().toLowerCase(), (data.enquiryEmail || '').toLowerCase());
    put('address', c.address.value.trim(), firm.address || '');
    const tags = splitTags(c.tags.value); if (!sameList(tags, firm.tags || []) || (isNew && tags.length)) p.tags = tags;
    const cs = cats.get(); if (!sameList(cs, firm.caseTypes || []) || (isNew && cs.length)) p.caseTypes = cs;
    if (admin) {
      put('city', c.city.value.trim(), firm.city || '');
      put('province', c.province.value, firm.province || (isNew ? 'ON' : ''));
      if (isNew) { if (c.status.value !== 'live') p.status = c.status.value; p.province = c.province.value; }
      else if (c.status.value !== (data.status || 'live') && c.status.value !== 'pending') p.status = c.status.value;
      if (!isNew) {
        put('featured', c.featured.value === 'true', !!firm.featured);
        if (num(c.lat.value) !== (firm.lat ?? null) || num(c.lng.value) !== (firm.lng ?? null)) { p.lat = num(c.lat.value); p.lng = num(c.lng.value); }
      } else if (c.lat.value.trim() || c.lng.value.trim()) { p.lat = num(c.lat.value); p.lng = num(c.lng.value); }
    }
    if (!isNew) {
      const s = Object.fromEntries(SOCIALS.map(([k]) => [k, social[k].value.trim()]).filter(([, v]) => v));
      const s0 = Object.fromEntries(SOCIALS.map(([k]) => [k, (social0[k] || '').trim()]).filter(([, v]) => v));
      if (JSON.stringify(s) !== JSON.stringify(s0)) p.social = s;
      const o = currentOffices(); if (JSON.stringify(o) !== JSON.stringify(offices0.filter((x) => x.address).map((x) => (x.name ? x : { address: x.address })))) p.offices = o;
      if (c.appointmentOnly.checked !== !!firm.appointmentOnly) p.appointmentOnly = c.appointmentOnly.checked;
      put('availability', c.availability.value, firm.availability || '');
      if (c.virtual.checked !== (firm.virtual === true)) p.virtual = c.virtual.checked;
      put('founded', c.founded.value.trim() === '' ? null : Number(c.founded.value), details0.founded ?? null);
      const langs = langsPicked(); if (!sameList(langs, lang0)) p.languages = langs;
    }
    if (hrs.isDirty()) p.hours = hrs.anyOpen() ? hrs.get() : null;
    return p;
  }

  // ---- save bar
  const out = h('div', { class: 'ed-out' });
  const state = h('span', { class: 'state' }, 'No changes yet');
  const save = h('button', { class: 'primary', type: 'submit', disabled: true }, isNew ? 'Create firm' : 'Save');
  const discard = h('button', { type: 'button', class: 'linkish', hidden: true, onclick: () => onSaved && onSaved('') }, 'Discard changes');
  function changed() {
    const n = Object.keys(collect()).length;
    save.disabled = n === 0;
    state.className = 'state' + (n ? ' dirty' : '');
    state.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No changes yet';
    discard.hidden = n === 0 || isNew;
  }
  const bar = h('div', { class: 'savebar' }, state, discard, save);

  const form = h('form', { class: 'ed', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const payload = collect();
    if (!Object.keys(payload).length) return;
    save.disabled = true; state.textContent = 'Saving…';
    try {
      if (isNew) {
        if (!payload.name || !payload.city) throw new Error('A firm needs a name and a city.');
        const res = await api('POST', '/api/admin/firms', payload);
        if (onCreated) onCreated(res.slug);
        return;
      }
      const res = await api('PATCH', base, payload);
      if (onSaved) await onSaved(res.changed.length ? 'Saved. The public page updates within about a minute.' : 'No changes to save.');
    } catch (err) {
      out.replaceChildren(note('msg-err', err.message));
      out.scrollIntoView({ block: 'nearest' });
      save.disabled = false; changed();
    }
  } });
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);

  // ---- header
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const q = encodeURIComponent(`${firm.name || ''} ${firm.city || ''}`.trim());
  const placeLink = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const head = isNew
    ? h('div', null, h('h1', { class: 'ed-title' }, 'Add a firm'), h('p', { class: 'ed-sub' }, 'Fill in what you know. Pictures, other offices, social profiles and the blog feed can be added once the firm is saved.'))
    : h('div', null,
      h('h1', { class: 'ed-title' }, mode === 'owner' ? 'Edit your profile: ' : 'Edit Profile: ',
        data.status === 'live' ? h('a', { class: 'ed-handle', href: `/firms/${slug}`, target: '_blank', rel: 'noopener', title: 'Open the public page' }, '@' + slug) : h('span', { class: 'ed-handle' }, '@' + slug)),
      h('p', { class: 'ed-sub' },
        firm.website && h('a', { href: firm.website, target: '_blank', rel: 'noopener nofollow' }, icon('globe'), host(firm.website)),
        data.updatedAt && h('span', null, 'Updated: ', when(data.updatedAt)),
        h('span', { class: 'badge' + (firm.featured ? ' featured' : '') }, firm.featured ? 'Featured' : 'Basic'),
        data.status && data.status !== 'live' && h('span', { class: 'badge new' }, data.status === 'pending' ? 'Awaiting approval' : 'Hidden'),
        h('a', { href: placeLink, target: '_blank', rel: 'noopener' }, 'Find on Google Maps ↗'),
        data.status === 'live' && h('a', { href: `/firms/${slug}`, target: '_blank', rel: 'noopener' }, 'View public page ↗')));

  // ---- Profile Images (a collapsible bar, loaded when it is opened)
  let pics = null;
  const imagesBar = isNew ? null : h('details', { class: 'ed-collapse', ontoggle: (e) => {
    if (e.target.open && !pics) { pics = picturesPanel(`${base}/images`, { locked }); e.target.querySelector('.inner').replaceChildren(pics); }
  } }, h('summary', null, 'Profile Images'), h('div', { class: 'inner' }, h('p', { class: 'muted' }, 'Loading…')));

  // ---- Offices and locations (owner): a page for every office, one Featured plan. Adding one is a Featured benefit.
  function locationsPanel() {
    const body = h('div', { class: 'inner' }, h('p', { class: 'muted' }, 'Loading\u2026'));
    let loaded = false;
    const addForm = () => {
      const f = { name: h('input', { type: 'text', maxlength: 200, placeholder: firm.name || '', 'aria-label': 'Office name' }),
        city: h('input', { type: 'text', maxlength: 80, placeholder: 'Toronto', 'aria-label': 'City' }),
        province: h('select', { 'aria-label': 'Province' }, Object.entries(PROVINCES).map(([code, name]) => h('option', { value: code, selected: code === (firm.province || 'ON') }, name))),
        address: h('input', { type: 'text', maxlength: 200, placeholder: '151 Eglinton Ave W, Toronto, ON', 'aria-label': 'Street address' }),
        phone: h('input', { type: 'text', maxlength: 40, placeholder: '(416) 555-0100', 'aria-label': 'Phone' }),
        website: h('input', { type: 'text', maxlength: 300, placeholder: firm.website || 'https://', 'aria-label': 'Website of this office' }) };
      const msg = h('div', { class: 'ed-out' });
      const go = h('button', { type: 'button', class: 'primary' }, 'Add this office page');
      go.addEventListener('click', async () => {
        go.disabled = true; msg.replaceChildren();
        try {
          await api('POST', `${base}/locations`, { name: f.name.value, city: f.city.value, province: f.province.value, address: f.address.value, phone: f.phone.value, website: f.website.value });
          body.replaceChildren(note('msg-ok', 'Thank you. We check each new office page before it goes live; once it does it appears under your firms and in that city\'s list. It is Featured, like this page.'));
        } catch (err) { msg.replaceChildren(note('msg-err', err.message)); go.disabled = false; }
      });
      const row = (label, el, hint) => h('div', { class: 'ed-field' }, h('label', null, label), el, hint && h('p', { class: 'ed-hint' }, hint));
      return h('div', { class: 'ed-locform' },
        h('h3', null, 'Add an office page'),
        row('City', f.city), row('Province', f.province), row('Street address', f.address, 'The address of this office. It places the pin on the map.'),
        row('Phone', f.phone), row('Website (if this office has its own)', f.website, 'Leave blank to use your main website.'),
        row('Name (optional)', f.name, 'Leave blank to use your firm name. The city makes the page address.'),
        h('div', { class: 'row' }, go), msg);
    };
    const draw = (st) => {
      if (st.isLocation) { body.replaceChildren(h('p', null, 'This page is an office of ', h('b', null, st.main.name), '. It is Featured whenever that listing is, and its plan and billing are managed there.')); return; }
      const kids = [h('p', { class: 'ed-hint' }, 'A firm with offices in several cities gets a page for each office, so each shows in its own city\'s list and on the map, with its own address, phone number and website. One Featured plan covers all of them.')];
      if (st.items.length) kids.push(h('ul', { class: 'ed-loc-list' }, st.items.map((l) => h('li', null, h('b', null, l.name), ' ', h('span', { class: 'muted' }, `${l.city}, ${l.province}`), ' ',
        l.status === 'live' ? h('a', { href: `/firms/${l.slug}`, target: '_blank', rel: 'noopener' }, 'View page') : h('span', { class: 'badge new' }, 'Awaiting approval')))));
      if (st.canAdd) kids.push(addForm());
      else kids.push(locked ? lockNote(st.reason) : h('p', { class: 'muted' }, st.reason));
      body.replaceChildren(...kids);
    };
    const load = async () => { try { draw(await api('GET', `${base}/locations`)); } catch (err) { body.replaceChildren(note('msg-err', err.message)); } };
    return h('details', { class: 'ed-collapse', ontoggle: (e) => { if (e.target.open && !loaded) { loaded = true; load(); } } }, h('summary', null, 'Offices and locations'), body);
  }

  // ---- the page address (admin only): moves everything the firm has to the new address and leaves a permanent redirect from the old one
  function addressControl() {
    const input = h('input', { type: 'text', value: slug, maxlength: 80, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'New page address' });
    const go = h('button', { type: 'button' }, 'Change address');
    const msg = h('div', { class: 'ed-out' });
    go.addEventListener('click', async () => {
      const next = input.value.trim().toLowerCase();
      if (!next || next === slug) { msg.replaceChildren(note('msg-err', 'Type a different address.')); return; }
      go.disabled = true; msg.replaceChildren();
      try {
        const r = await api('PUT', `/api/admin/firms/${slug}/slug`, { slug: next });
        location.hash = `#firms/edit/${r.slug}`;
        location.reload();
      } catch (err) { msg.replaceChildren(note('msg-err', err.message)); go.disabled = false; }
    });
    return h('details', { class: 'ed-addr' }, h('summary', null, 'Change the page address'),
      h('p', { class: 'ed-hint' }, 'Lowercase letters, digits and dashes. The old address keeps working: it redirects to the new one for good, for the page and for its stories. The owner, enquiries, ratings, followers and numbers all stay with the firm.'),
      h('div', { class: 'row' }, h('span', { class: 'ed-prefix' }, 'lawdb.ca/firms/'), input),
      h('div', { class: 'row' }, go), msg);
  }

  // ---- merge a duplicate (admin only): keeps the OTHER listing, gives it this listing's owners and numbers, deletes this one and redirects its address
  function mergeControl() {
    const input = h('input', { type: 'text', maxlength: 80, autocomplete: 'off', spellcheck: 'false', placeholder: 'preszler-injury-lawyers', 'aria-label': 'Address of the listing to keep' });
    const look = h('button', { type: 'button' }, 'Look up');
    const go = h('button', { type: 'button', class: 'danger', hidden: true }, 'Merge and delete this listing');
    const msg = h('div', { class: 'ed-out' });
    let keep = null;
    input.addEventListener('input', () => { keep = null; go.hidden = true; go.textContent = 'Merge and delete this listing'; msg.replaceChildren(); });
    look.addEventListener('click', async () => {
      const into = input.value.trim().toLowerCase();
      go.hidden = true; msg.replaceChildren();
      if (!into || into === slug) { msg.replaceChildren(note('msg-err', 'Type the address of the other listing, the one to keep.')); return; }
      try {
        const r = await api('GET', `/api/admin/firms/${encodeURIComponent(into)}`);
        keep = into;
        msg.replaceChildren(h('p', { class: 'ed-hint' }, 'Keep: ', h('b', null, r.firm.name || into), ` (${[r.firm.city, r.firm.province].filter(Boolean).join(', ')}, ${r.status}). `,
          h('b', null, '@' + slug), ' will be deleted. Its owners, enquiries, followers, ratings, blog feed and numbers move to the kept listing, and ',
          h('b', null, `/firms/${slug}`), ' redirects there for good. This cannot be undone.'));
        go.hidden = false;
      } catch (err) { msg.replaceChildren(note('msg-err', err.status === 404 ? `There is no listing at /firms/${into}.` : err.message)); }
    });
    go.addEventListener('click', async () => {
      if (!keep) return;
      if (go.dataset.sure !== keep) { go.dataset.sure = keep; go.textContent = 'Click again to confirm: delete @' + slug; return; }
      go.disabled = true;
      try {
        await api('POST', `/api/admin/firms/${slug}/merge`, { into: keep });
        location.hash = `#firms/edit/${keep}`;
        location.reload();
      } catch (err) { msg.replaceChildren(note('msg-err', err.message)); go.disabled = false; go.textContent = 'Merge and delete this listing'; delete go.dataset.sure; }
    });
    return h('details', { class: 'ed-addr' }, h('summary', null, 'Merge into another listing (duplicate)'),
      h('p', { class: 'ed-hint' }, 'Use this when the same firm is listed twice. Enter the address of the listing to KEEP; this one is removed.'),
      h('div', { class: 'row' }, h('span', { class: 'ed-prefix' }, 'lawdb.ca/firms/'), input, look),
      msg, h('div', { class: 'row' }, go));
  }

  // ---- office pages (admin only): a firm with several offices has one page per office and ONE Featured plan; the office pages follow the main listing's plan
  function locationControl() {
    const msg = h('div', { class: 'ed-out' });
    const rel = data.location;
    if (rel) {
      const un = h('button', { type: 'button' }, 'Unlink this office page');
      un.addEventListener('click', async () => {
        if (un.dataset.sure !== '1') { un.dataset.sure = '1'; un.textContent = 'Click again to confirm'; return; }
        un.disabled = true;
        try { await api('DELETE', `/api/admin/firms/${slug}/location`); location.reload(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); un.disabled = false; un.textContent = 'Unlink this office page'; delete un.dataset.sure; }
      });
      return h('details', { class: 'ed-addr', open: true }, h('summary', null, 'Office page of ' + rel.name),
        h('p', { class: 'ed-hint' }, 'One Featured plan for the whole firm: this page is Featured whenever ', h('a', { href: `#firms/edit/${rel.slug}` }, rel.name), ' is. It has no plan of its own and no free month of its own.'),
        h('div', { class: 'row' }, un), msg);
    }
    const input = h('input', { type: 'text', maxlength: 80, autocomplete: 'off', spellcheck: 'false', placeholder: 'main-listing-address', 'aria-label': 'Address of the firm\'s main listing' });
    const go = h('button', { type: 'button' }, 'Link as an office page');
    go.addEventListener('click', async () => {
      const main = input.value.trim().toLowerCase();
      if (!main || main === slug) { msg.replaceChildren(note('msg-err', 'Type the address of the firm\'s main listing (the one that holds the plan).')); return; }
      go.disabled = true; msg.replaceChildren();
      try { await api('PUT', `/api/admin/firms/${slug}/location`, { main }); location.reload(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); go.disabled = false; }
    });
    const pages = Array.isArray(data.locations) ? data.locations : [];
    return h('details', { class: 'ed-addr', open: pages.length > 0 }, h('summary', null, pages.length ? `Offices of this firm (${pages.length})` : 'Offices in other cities (one plan)'),
      pages.length ? h('ul', { class: 'ed-loc-list' }, pages.map((l) => h('li', null, h('a', { href: `#firms/edit/${l.slug}` }, l.name), ' ', h('span', { class: 'muted' }, `${l.city}, ${l.province}${l.status !== 'live' ? ' (' + l.status + ')' : ''}`)))) : null,
      h('p', { class: 'ed-hint' }, pages.length ? 'Each office page is Featured whenever this listing is. To add another existing listing as an office page, enter this listing\'s address on that listing\'s page.' : 'If this page is another office of a firm that already has a main listing, enter that listing\'s address. This page then follows the main listing\'s Featured plan.'),
      pages.length ? null : h('div', { class: 'row' }, h('span', { class: 'ed-prefix' }, 'lawdb.ca/firms/'), input, go), msg);
  }

  // ---- Basic Information
  const basic = card('Basic Information', 'info',
    !isNew && h('p', { class: 'ed-id' }, 'ID: ', data.id ?? ''),
    isNew ? fld('Profile Status', c.status, 'Hidden: saved, but shown nowhere until you switch it on.')
      : h('div', { class: 'ed-row' },
        fld('Profile Status', c.status, data.status === 'pending' ? 'Approve it under Approvals.' : null),
        fld('Plan', c.featured, mode === 'owner' ? 'Managed by LawDB (see Your plan)' : null)),
    fld('Official Firm Name', c.name),
    !isNew && fld('Username', text('@' + slug, { readonly: true, 'aria-label': 'Username' }), 'The address of the page: lawdb.ca/firms/' + slug + (admin ? '' : '. To change it, write to info@lawdb.ca.')),
    admin && !isNew && addressControl(),
    admin && !isNew && mergeControl(),
    admin && !isNew && locationControl(),
    !isNew && fld('Tagline', c.blurb, 'Shown in lists and search results.'),
    fld('Practice areas', c.tags, 'Comma separated, up to 10.'),
    h('label', null, 'Categories'), cats.el);

  // ---- Good to know: what a visitor wants to see before they call (open to every plan)
  const know = card('Good to know', 'info',
    fld('Taking new clients?', c.availability, 'Shown on your page, so visitors know before they call.'),
    h('label', { class: 'check' }, c.virtual, 'We offer virtual consultations'),
    fld('In practice since', c.founded, 'The year you started practising. Shown under "At a glance".'),
    h('div', { class: 'ed-field' }, h('label', null, 'Languages you serve clients in'), langGrid, h('p', { class: 'ed-hint' }, 'Choose up to 8. Many clients search for a lawyer who speaks their language.')));

  // ---- Website & Blog
  const web = card('Website & Blog', 'globe',
    fld('Website', c.website),
    !isNew && fld('Booking link', c.bookingUrl,
      admin && !firm.featured ? 'Optional. Saved, but the Book a call button only works on the page while the firm is Featured.' : 'Optional. Your calendar or booking page. It turns on the Book a call button.',
      locked ? lockNote(firm.bookingUrl ? 'Your booking link is saved, but the Book a call button on your page stays locked until your listing is Featured.' : 'A booking link needs Featured. Until then the Book a call button on your page stays locked.') : null),
    !isNew && h('div', { class: 'ed-sub-h' }, 'Profiles'),
    !isNew && SOCIALS.map(([k, label]) => fld(label, social[k])),
    !isNew && h('div', { class: 'ed-sub-h' }, 'Blog feed'),
    !isNew && feedPanel(`${base}/feed`));

  // ---- Location
  const cityPath = () => `/${PROV_SLUG[c.province.value] || ''}/${citySlug(c.city.value)}/`;
  const cityLine = h('p', { class: 'ed-hint' });
  let cityTimer;
  function checkCity() {
    clearTimeout(cityTimer);
    cityTimer = setTimeout(async () => {
      if (!PROV_SLUG[c.province.value] || !citySlug(c.city.value)) return cityLine.replaceChildren('');
      const path = cityPath();
      try {
        const r = await fetch(path, { method: 'HEAD' });
        cityLine.replaceChildren(r.ok ? h('span', null, 'City page exists: ', h('a', { href: path, target: '_blank', rel: 'noopener' }, path)) : `No city page yet for ${path}`);
      } catch { cityLine.replaceChildren(''); }
    }, 350);
  }
  c.city.addEventListener('input', checkCity); c.province.addEventListener('change', checkCity);
  const mapOut = h('p', { class: 'ed-hint' });
  const find = h('button', { type: 'button', onclick: async () => {
    find.disabled = true; mapOut.replaceChildren('Looking…');
    try {
      const r = await api('GET', `/api/admin/geocode?address=${encodeURIComponent(c.address.value)}&city=${encodeURIComponent(c.city.value)}&province=${encodeURIComponent(c.province.value)}`);
      if (!r.found) mapOut.replaceChildren('Nothing found. Type the numbers in by hand.');
      else {
        c.lat.value = String(Math.round(r.lat * 1e7) / 1e7); c.lng.value = String(Math.round(r.lng * 1e7) / 1e7); changed();
        mapOut.replaceChildren(r.approx ? 'Only the city was found, so the pin is approximate. Check it, then Save.' : 'Found the address. Save to move the pin.');
      }
    } catch (err) { mapOut.replaceChildren(note('msg-err', err.message)); }
    find.disabled = false;
  } }, 'Find on map');
  const loc = card('Location', 'pin',
    fld('Country', h('select', { disabled: true }, h('option', null, 'Canada'))),
    fld('Province', c.province, !admin ? 'To move your firm, write to info@lawdb.ca.' : null),
    fld('City', c.city), cityLine,
    h('div', { class: 'ed-row' }, fld('Latitude', c.lat), fld('Longitude', c.lng)),
    admin && h('div', { class: 'row' }, find), mapOut,
    !admin && h('p', { class: 'ed-hint' }, 'The map pin follows your address when you save a new one.'));
  if (!isNew) checkCity();

  // ---- Description / Address / Hours
  const count = h('span', { class: 'ed-count' });
  const upd = () => { count.textContent = `${c.about.value.length} / 2000`; };
  c.about.addEventListener('input', upd); upd();
  const desc = card('Description', 'text',
    fld('About the firm', c.about, 'Plain text. A blank line starts a new paragraph.'), count);
  const addr = card('Address', 'home',
    fld('Street address', c.address, 'The map pin and the directions link follow this.'),
    fld('Phone', c.phone),
    !isNew && fld('Send enquiries to', c.enquiryEmail,
      locked ? 'Never shown on your page.' : 'Enquiries from your page are emailed to the address you sign in with, and also to this one, for example your intake desk. Never shown on your page.',
      locked ? lockNote('On Basic, enquiries go only to the email you sign in with. Featured lets you add a second address, like your intake desk.') : null),
    !isNew && h('div', { class: 'ed-sub-h' }, 'Other offices'),
    !isNew && officeList,
    !isNew && h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => { addOffice(); changed(); } }, 'Add an office')),
    !isNew && h('label', { class: 'check' }, c.appointmentOnly, 'All offices are by appointment only'));
  const hours = card('Opening hours', 'clock', hrs.el);

  // Three columns, as on MSPdatabase: Basic Information | Website & Blog, then Description | Location, then Address and Opening hours.
  // On a phone they stack in that order.
  const grid = h('div', { class: 'ed-grid' }, h('div', { class: 'ed-stack' }, basic, know), h('div', { class: 'ed-stack' }, web, desc), h('div', { class: 'ed-stack' }, loc, addr, hours));
  // On Basic: a clear list of what is locked and the way to unlock it (the free month, or Featured), instead of a sentence nobody reads.
  const unlockBanner = locked && (() => {
    const cta = h('div', { class: 'row' });
    fetch(`${base}/plan`, { credentials: 'same-origin' }).then((r) => r.json()).then((plan) => {
      if (plan.trialAvailable) { const b = h('button', { class: 'primary', type: 'button' }, 'Start my free month'); b.addEventListener('click', () => startFreeMonth(base, b)); cta.append(b, h('span', { class: 'muted' }, `${plan.trialDays} days of Featured, no card needed`)); }
      else if (plan.upgradeUrl) cta.append(h('a', { href: plan.upgradeUrl, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, 'Upgrade to Featured')), h('span', { class: 'muted' }, plan.price));
    }).catch(() => {});
    const item = (t) => h('li', null, icon('lock'), t);
    return h('div', { class: 'ed-unlock' },
      h('div', null, h('b', null, 'Locked on the Basic plan'), h('p', { class: 'muted' }, 'On Basic you write your own description and tagline and keep your facts up to date here: name, phone, address, website, practice areas, opening hours and social profiles. Featured unlocks:')),
      h('ul', null, ['A booking link and the Book a call button', 'Profile pictures: logo, cover and photos', 'Sending enquiries to a second email address', 'The analytics dashboard', 'The enquiries inbox, with notes and export', 'A page for every office, with one plan'].map(item)),
      cta);
  })();

  // How complete the profile is, and what to do next (src/lib/profile-strength.js): a number out of 100 and the biggest missing pieces.
  const strengthStrip = !isNew && data.strength && (() => {
    const s = data.strength;
    const fill = h('span', { class: 'ed-bar-fill' });
    fill.style.width = `${Math.max(0, Math.min(100, s.score))}%`;
    return h('section', { class: 'ed-strength', 'aria-label': 'Profile strength' },
      h('div', { class: 'ed-strength-top' }, h('b', { class: 'ed-score' }, String(s.score)), h('span', { class: 'muted' }, ' / 100 profile strength')),
      h('div', { class: 'ed-bar', role: 'img', 'aria-label': `Profile strength ${s.score} out of 100` }, fill),
      s.complete
        ? h('p', { class: 'muted' }, 'Your profile is complete. Nothing left to add.')
        : h('ul', { class: 'ed-todo' }, (s.todo || []).slice(0, 4).map((i) => h('li', null, h('b', null, `+${i.points}`), ' ', i.label, i.hint && h('span', { class: 'muted' }, ' \u00b7 ', i.hint)))),
      h('p', { class: 'muted ed-strength-note' }, 'This measures how complete your profile is. It is shown only to you and LawDB, never to visitors.'));
  })();

  const verifyPanel = isNew ? null : verificationPanel({ mode: mode === 'admin' ? 'admin' : 'owner', base });

  form.append(...[head, strengthStrip, verifyPanel, flash ? note('msg-ok', flash) : null, unlockBanner, imagesBar, mode === 'owner' && !isNew ? locationsPanel() : null, grid, out, h('p', { class: 'muted ed-foot' }, 'Your rating and review count come from Google and update on their own.'), bar].filter(Boolean));
  // The plan (and what Featured adds) is one tap away at the top, not a page-long card in front of the form.
  const plan = mode === 'owner' && h('details', { class: 'ed-collapse ed-plan' }, h('summary', null, 'Your plan: ', h('b', null, firm.featured ? 'Featured' : 'Basic (free)'), !firm.featured && h('span', { class: 'ed-plan-cta' }, 'See what Featured adds')), h('div', { class: 'inner' }, planPanel(`${base}/plan`)));
  planEl = plan || null;
  const root = h('div', { class: 'ed-wrap' }, plan, form);
  changed();
  return root;
}
