// The "Edit Profile" page, laid out like the MSPdatabase admin: a title with the @handle, a collapsible Profile Images bar, three columns of cards
// (Basic Information, Website & Blog, Location), then Description, Address and Opening hours, and a Save bar that stays at the bottom and is greyed out
// until something changes. One editor for three jobs:
//   mode 'admin'  the admin edits any firm (every field);
//   mode 'owner'  an approved owner edits their own firm: the facts always, and what is a Featured benefit (description, tagline, booking link,
//                 pictures) only on a Featured plan; the city, map position, status and plan are shown but not editable;
//   mode 'new'    the admin adds a firm.
// Only the fields that changed are sent, so an owner on the Basic plan never trips over a locked field they did not touch.
// SECURITY: every value is put in with text nodes or element properties, never innerHTML.

import { h, api, when, note, hoursEditor, categoryChecks, splitTags, picturesPanel, feedPanel, planPanel, startFreeMonth, PROVINCES } from './ui.js';

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
  // Owners: customizing the page is a Featured benefit; a Basic firm keeps its facts up to date and can still clear what it has.
  const locked = mode === 'owner' && !firm.featured;
  // Opens "Your plan" at the top, which has the free-month and upgrade buttons.
  let planEl = null;
  const openPlan = () => { if (planEl) { planEl.open = true; planEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  const lockNote = (why) => h('p', { class: 'ed-lock' }, icon('lock'), h('span', null, why, ' ', h('button', { type: 'button', class: 'linkish', onclick: openPlan }, 'Unlock with Featured')));
  const social0 = firm.social && typeof firm.social === 'object' ? firm.social : {};
  const offices0 = (Array.isArray(firm.offices) ? firm.offices : []).map((o) => ({ name: o.name || '', address: o.address || '' }));

  // ---- the controls
  const c = {
    name: text(firm.name, { maxlength: 200, required: true, 'aria-label': 'Official firm name' }),
    blurb: h('textarea', { maxlength: 500, rows: 2, disabled: locked, placeholder: locked ? 'A short line shown in lists and search results' : null }, firm.blurb || ''),
    tags: text((firm.tags || []).join(', '), { placeholder: 'Divorce, Child Custody' }),
    website: text(firm.website, { maxlength: 300, placeholder: 'https://' }),
    bookingUrl: text(firm.bookingUrl, { maxlength: 500, placeholder: locked ? 'https://calendly.com/your-firm' : 'https://', disabled: locked }),
    about: h('textarea', { class: 'tall', maxlength: 2000, disabled: locked, placeholder: locked ? 'Tell clients about your firm, who you help and how you work.' : null }, firm.about || ''),
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
    pageMode: h('select', { disabled: !admin }, [['dynamic', 'Built from the database'], ['static', 'Original hand-built page']].map(([v, l]) => h('option', { value: v, selected: v === (data.pageMode || 'dynamic') }, l))),
    appointmentOnly: h('input', { type: 'checkbox', checked: !!firm.appointmentOnly }),
  };
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
        put('pageMode', c.pageMode.value, data.pageMode || 'dynamic');
        if (num(c.lat.value) !== (firm.lat ?? null) || num(c.lng.value) !== (firm.lng ?? null)) { p.lat = num(c.lat.value); p.lng = num(c.lng.value); }
      } else if (c.lat.value.trim() || c.lng.value.trim()) { p.lat = num(c.lat.value); p.lng = num(c.lng.value); }
    }
    if (!isNew) {
      const s = Object.fromEntries(SOCIALS.map(([k]) => [k, social[k].value.trim()]).filter(([, v]) => v));
      const s0 = Object.fromEntries(SOCIALS.map(([k]) => [k, (social0[k] || '').trim()]).filter(([, v]) => v));
      if (JSON.stringify(s) !== JSON.stringify(s0)) p.social = s;
      const o = currentOffices(); if (JSON.stringify(o) !== JSON.stringify(offices0.filter((x) => x.address).map((x) => (x.name ? x : { address: x.address })))) p.offices = o;
      if (c.appointmentOnly.checked !== !!firm.appointmentOnly) p.appointmentOnly = c.appointmentOnly.checked;
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

  // ---- Basic Information
  const basic = card('Basic Information', 'info',
    !isNew && h('p', { class: 'ed-id' }, 'ID: ', data.id ?? ''),
    isNew ? fld('Profile Status', c.status, 'Hidden: saved, but shown nowhere until you switch it on.')
      : h('div', { class: 'ed-row' },
        fld('Profile Status', c.status, data.status === 'pending' ? 'Approve it under Approvals.' : null),
        fld('Plan', c.featured, mode === 'owner' ? 'Managed by LawDB (see Your plan)' : null)),
    admin && !isNew && fld('Profile page style', c.pageMode, 'The original pages keep their own wording; the database style shows everything entered here.'),
    fld('Official Firm Name', c.name),
    !isNew && fld('Username', text('@' + slug, { readonly: true, 'aria-label': 'Username' }), 'The address of the page: lawdb.ca/firms/' + slug),
    !isNew && fld('Tagline', c.blurb, 'Shown in lists and search results.', locked ? lockNote('Writing your own tagline needs Featured.') : null),
    fld('Practice areas', c.tags, 'Comma separated, up to 10.'),
    h('label', null, 'Categories'), cats.el);

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
    fld('About the firm', c.about, 'Plain text. A blank line starts a new paragraph.', locked ? lockNote('Writing your own description needs Featured. Your page shows a short standard line until then.') : null), count);
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
  const grid = h('div', { class: 'ed-grid' }, h('div', { class: 'ed-stack' }, basic), h('div', { class: 'ed-stack' }, web, desc), h('div', { class: 'ed-stack' }, loc, addr, hours));
  const hand = mode === 'owner' && data.pageMode !== 'dynamic' && note('msg-err', 'Your page has a custom layout that we update for you. Your changes still appear in the directory, search and map. Write to info@lawdb.ca to have the page itself updated.');
  // On Basic: a clear list of what is locked and the way to unlock it (the free month, or Featured), instead of a sentence nobody reads.
  const unlockBanner = locked && (() => {
    const cta = h('div', { class: 'row' });
    fetch(`${base}/plan`, { credentials: 'same-origin' }).then((r) => r.json()).then((plan) => {
      if (plan.trialAvailable) { const b = h('button', { class: 'primary', type: 'button' }, 'Start my free month'); b.addEventListener('click', () => startFreeMonth(base, b)); cta.append(b, h('span', { class: 'muted' }, `${plan.trialDays} days of Featured, no card needed`)); }
      else if (plan.upgradeUrl) cta.append(h('a', { href: plan.upgradeUrl, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, 'Upgrade to Featured')), h('span', { class: 'muted' }, plan.price));
    }).catch(() => {});
    const item = (t) => h('li', null, icon('lock'), t);
    return h('div', { class: 'ed-unlock' },
      h('div', null, h('b', null, 'Locked on the Basic plan'), h('p', { class: 'muted' }, 'You can always keep your facts up to date here: name, phone, address, website, practice areas, opening hours and social profiles. Featured unlocks:')),
      h('ul', null, ['Your own description and tagline', 'A booking link and the Book a call button', 'Profile pictures: logo, cover and photos', 'Sending enquiries to a second email address', 'The analytics dashboard', 'The enquiries inbox, with notes and export'].map(item)),
      cta);
  })();

  form.append(...[head, flash ? note('msg-ok', flash) : null, hand, unlockBanner, imagesBar, grid, out, h('p', { class: 'muted ed-foot' }, 'Your rating and review count come from Google and update on their own.'), bar].filter(Boolean));
  // The plan (and what Featured adds) is one tap away at the top, not a page-long card in front of the form.
  const plan = mode === 'owner' && h('details', { class: 'ed-collapse ed-plan' }, h('summary', null, 'Your plan: ', h('b', null, firm.featured ? 'Featured' : 'Basic (free)'), !firm.featured && h('span', { class: 'ed-plan-cta' }, 'See what Featured adds')), h('div', { class: 'inner' }, planPanel(`${base}/plan`)));
  planEl = plan || null;
  const root = h('div', { class: 'ed-wrap' }, plan, form);
  changed();
  return root;
}
