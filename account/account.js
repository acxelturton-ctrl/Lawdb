// LawDB firm-owner dashboard. No framework, no build step.
// SECURITY: everything shown here (including enquiries typed by the public) is inserted as text nodes only.

import { h, api, when, note, hoursEditor, categoryChecks, splitTags, field, picturesPanel, feedPanel, planPanel, PROVINCES } from '/admin/ui.js';

const app = document.getElementById('app');
const mount = (...nodes) => app.replaceChildren(...nodes);
let user = null;
let memberships = [];

// ---------------------------------------------------------------- sign in / create account
const ICONS = {
  google: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`,
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="6" fill="#0A66C2"/><path fill="#fff" d="M9 18h6v21H9zM12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM19 18h5.7v2.9h.1c.8-1.5 2.7-3.3 5.7-3.3 6 0 7.1 3.9 7.1 9V39h-6V28c0-2.6 0-6-3.7-6s-4.2 2.8-4.2 5.8V39h-6z"/></svg>`,
};
const icon = (k) => h('img', { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(ICONS[k]), alt: '', width: 20, height: 20 });
const SIGNIN_MESSAGES = {
  failed: 'We could not sign you in with that account. Please try again, or use the other sign-in button.',
  cancelled: 'Sign-in was cancelled. You can try again whenever you like.',
  unavailable: 'That sign-in option is not available right now. Please try the other button, or come back soon.',
};

// LawDB's own LinkedIn page, shown on the sign-in badge. Leave empty to hide the link.
const LAWDB_LINKEDIN = 'https://www.linkedin.com/company/lawdb/';

async function renderLogin() {
  const msg = h('div');
  const q = new URLSearchParams(location.search).get('signin');
  if (SIGNIN_MESSAGES[q]) msg.replaceChildren(note('msg-err', SIGNIN_MESSAGES[q]));
  let providers = {};
  try { providers = await api('GET', '/api/auth/providers'); } catch { /* the email link always works */ }
  const email = h('input', { type: 'email', id: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Email me a sign-in link');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.replaceChildren();
      try {
        await api('POST', '/api/auth/request-link', { email: email.value, signup: true });
        msg.replaceChildren(note('msg-ok', 'Check your email. The link works once and expires in 15 minutes.'));
      } catch (err) {
        msg.replaceChildren(note('msg-err', err.message));
        btn.disabled = false;
      }
    },
  }, h('label', { for: 'email' }, 'Email address'), email, h('div', { class: 'row' }, btn));
  // Members sign in with Google or LinkedIn only. The email-link form stays as a fallback if neither is set up,
  // so nobody is ever locked out (admins still use the email link on /admin/).
  const OFFERED = ['google', 'linkedin'];
  const social = OFFERED.filter((k) => providers[k]).map((k) => h('a', { class: 'provider', href: `/api/auth/${k}/start` }, icon(k), k === 'google' ? 'Continue with Google' : 'Continue with LinkedIn'));
  const badge = h('div', { class: 'lw-badge' },
    h('img', { src: '/images/logo-icon.png', alt: 'LawDB', width: 56, height: 56 }),
    h('div', { class: 'lw-badge-text' }, h('b', null, 'LawDB.ca'), h('span', null, 'Canada\u2019s Legal Directory')),
    LAWDB_LINKEDIN && h('a', { class: 'lw-badge-li', href: LAWDB_LINKEDIN, target: '_blank', rel: 'noopener', 'aria-label': 'LawDB on LinkedIn' }, icon('linkedin'), 'LinkedIn'));
  mount(h('div', { class: 'wrap' }, h('div', { class: 'center card' },
    badge,
    h('h1', null, 'Sign in to LawDB'),
    h('p', { class: 'muted' }, 'Follow law firms, save stories, rate the firms you have worked with, and manage your firm. Free. New here? The same sign-in creates your account.'),
    ...social,
    social.length ? null : form, msg,
    h('p', { class: 'muted small' }, social.length
      ? 'No password to remember or lose. We use your name and email to set up your account, and never post anything on your behalf.'
      : 'No password to remember or lose: we email you a one-time link.'))));
}

// ---------------------------------------------------------------- shell
function shell(active, content) {
  const tabs = [['feed', 'Feed'], ['network', 'My network'], ['saved', 'Saved'], ['firms', 'My firms'], ['profile', 'Profile'], ['find', 'Add or claim a firm']];
  return h('div', null,
    h('div', { class: 'wrap' },
      h('nav', { class: 'tabs', 'aria-label': 'Sections' }, tabs.map(([id, label]) => h('a', { href: `#${id}`, 'aria-current': id === active ? 'page' : false }, label))),
      content));
}

const approved = () => memberships.filter((m) => m.status === 'approved');
const where = (m) => `${m.city}, ${PROVINCES[m.province] || m.province}`;

// ---------------------------------------------------------------- my firms
function viewFirms() {
  if (!memberships.length) {
    return h('div', null, h('h1', null, 'Welcome'),
      h('div', { class: 'card' }, h('p', null, 'You are signed in, but you do not manage a firm yet.'),
        h('p', { class: 'muted' }, 'Find your firm in the directory and ask to manage it, or add it if it is not listed. We check every request, so your listing stays trustworthy.'),
        h('a', { href: '#find' }, h('button', { class: 'primary', type: 'button' }, 'Find or add my firm'))));
  }
  return h('div', null, h('h1', null, 'My firms'), memberships.map((m) => {
    const state = m.status === 'approved' ? null
      : m.status === 'pending' ? note('msg-ok', 'Waiting for approval. We will email you as soon as it is done.')
      : note('msg-err', 'This request was declined. If that is a mistake, write to info@lawdb.ca.');
    return h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('b', null, m.name), h('span', { class: 'badge' + (m.status === 'approved' ? (m.featured ? ' featured' : '') : ' new') }, m.status === 'approved' ? (m.featured ? 'Featured' : 'Basic') : m.status === 'pending' ? 'Pending' : 'Declined')),
      h('p', { class: 'muted' }, where(m)), state,
      m.status === 'approved' && h('div', { class: 'row' },
        h('a', { href: `#edit/${m.slug}` }, h('button', { class: 'primary', type: 'button' }, 'Edit my profile')),
        !m.featured && m.firmStatus === 'live' && h('a', { href: `#edit/${m.slug}` }, h('button', { type: 'button' }, 'Upgrade to Featured')),
        h('a', { href: `#leads/${m.slug}` }, h('button', { type: 'button' }, 'Enquiries')),
        m.firmStatus === 'live' && h('a', { href: `/firms/${m.slug}`, target: '_blank', rel: 'noopener' }, 'View public page')));
  }));
}

// ---------------------------------------------------------------- find / claim / add
function viewFind() {
  const results = h('div');
  const panel = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search by firm name or city', 'aria-label': 'Search firms' });
  let timer;

  async function find() {
    const q = search.value.trim();
    if (q.length < 2) return results.replaceChildren();
    try {
      const { firms } = await api('GET', '/api/account/search?q=' + encodeURIComponent(q));
      results.replaceChildren(...(firms.length
        ? firms.map((f) => h('button', { class: 'firm-row', type: 'button', onclick: () => claimForm(f) },
            h('span', null, f.name, h('small', null, `${f.city}, ${f.province}`)), f.managed && h('span', { class: 'badge' }, 'Has an owner')))
        : [h('p', { class: 'muted' }, 'No match. If your firm is not listed you can add it below.')]));
    } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
  }

  function contactFields() {
    const f = {
      contactName: h('input', { type: 'text', required: true, maxlength: 100, autocomplete: 'name' }),
      jobTitle: h('input', { type: 'text', maxlength: 100, placeholder: 'e.g. Partner, Office manager' }),
      message: h('textarea', { maxlength: 1000, placeholder: 'Anything that helps us confirm it is you (optional)' }),
    };
    const terms = h('input', { type: 'checkbox', required: true, id: 'terms' });
    return {
      f,
      el: [field('Your name', f.contactName), field('Your role at the firm', f.jobTitle), field('Note for our team', f.message),
        h('label', { class: 'check small', for: 'terms' }, terms, h('span', null, 'I am authorised to act for this firm and I accept the ', h('a', { href: '/terms#firm-terms', target: '_blank', rel: 'noopener' }, 'Terms for firms'), '.'))],
      get: () => ({ contactName: f.contactName.value, jobTitle: f.jobTitle.value, message: f.message.value, acceptTerms: terms.checked }),
    };
  }

  function claimForm(firm) {
    const c = contactFields();
    const out = h('div');
    const go = h('button', { class: 'primary', type: 'submit' }, 'Ask to manage this firm');
    panel.replaceChildren(h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        await api('POST', '/api/account/claims', { slug: firm.slug, ...c.get() });
        await loadMe();
        location.hash = '#firms';
      } catch (err) { out.replaceChildren(note('msg-err', err.message)); go.disabled = false; }
    } },
      h('h2', null, firm.name), h('p', { class: 'muted' }, `${firm.city}, ${firm.province}. We will email you when your request is approved. Signed in with your work email (the same address as the firm's website)? That helps us approve you faster.`),
      c.el, h('div', { class: 'row' }, go, h('button', { type: 'button', onclick: () => panel.replaceChildren() }, 'Cancel')), out));
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addForm() {
    const c = contactFields();
    const out = h('div');
    const f = {
      name: h('input', { type: 'text', required: true, maxlength: 200 }),
      city: h('input', { type: 'text', required: true, maxlength: 80 }),
      province: h('select', null, Object.entries(PROVINCES).map(([code, n]) => h('option', { value: code }, n))),
      address: h('input', { type: 'text', maxlength: 300, placeholder: 'Street address, so clients and the map find you' }),
      phone: h('input', { type: 'text', maxlength: 30 }),
      website: h('input', { type: 'text', maxlength: 300, placeholder: 'https://' }),
      tags: h('input', { type: 'text', placeholder: 'e.g. Family Law, Divorce, Child Custody' }),
      about: h('textarea', { class: 'tall', maxlength: 2000 }),
    };
    const cats = categoryChecks([]);
    const hrs = hoursEditor(null);
    const go = h('button', { class: 'primary', type: 'submit' }, 'Submit for approval');
    panel.replaceChildren(h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        const payload = {
          ...c.get(), name: f.name.value, city: f.city.value, province: f.province.value, address: f.address.value, phone: f.phone.value,
          website: f.website.value, tags: splitTags(f.tags.value), caseTypes: cats.get(), about: f.about.value,
        };
        if (hrs.anyOpen()) payload.hours = hrs.get();
        await api('POST', '/api/account/firms', payload);
        await loadMe();
        location.hash = '#firms';
      } catch (err) {
        out.replaceChildren(note('msg-err', err.message));
        if (err.message.includes('already listed')) out.append(h('p', { class: 'muted' }, 'Search for it above and ask to manage it.'));
        go.disabled = false;
      }
    } },
      h('h2', null, 'Add your firm'), h('p', { class: 'muted' }, 'It appears on LawDB once we have checked it. Everything here can be changed later.'),
      field('Firm name', f.name), field('City', f.city), field('Province', f.province), field('Address', f.address), field('Phone', f.phone), field('Website', f.website),
      field('Practice areas (comma separated)', f.tags), h('label', null, 'Categories'), cats.el,
      field('About the firm', f.about, 'A few sentences clients will read on your page.'),
      h('label', null, 'Opening hours'), hrs.el,
      h('h3', null, 'About you'), c.el,
      h('div', { class: 'row' }, go, h('button', { type: 'button', onclick: () => panel.replaceChildren() }, 'Cancel')), out));
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(find, 250); });
  return h('div', null, h('h1', null, 'Add or claim a firm'),
    h('div', { class: 'card' }, h('b', null, 'Is your firm already listed?'), h('p', { class: 'muted' }, 'Search for it and ask to manage it.'), search, results),
    panel,
    h('div', { class: 'card' }, h('b', null, 'Not listed?'), h('p', { class: 'muted' }, 'Add your firm. It is free.'),
      h('button', { type: 'button', onclick: addForm }, 'Add my firm')));
}

// ---------------------------------------------------------------- edit profile
async function viewEdit(slug) {
  const { firm, hours, pageMode } = await api('GET', '/api/account/firms/' + encodeURIComponent(slug));
  const out = h('div');
  const f = {
    name: h('input', { type: 'text', value: firm.name, maxlength: 200 }),
    blurb: h('textarea', { maxlength: 500 }, firm.blurb || ''),
    about: h('textarea', { class: 'tall', maxlength: 2000 }, firm.about || ''),
    phone: h('input', { type: 'text', value: firm.phone || '', maxlength: 30 }),
    website: h('input', { type: 'text', value: firm.website || '', maxlength: 300 }),
    address: h('input', { type: 'text', value: firm.address || '', maxlength: 300 }),
    tags: h('input', { type: 'text', value: (firm.tags || []).join(', ') }),
  };
  const cats = categoryChecks(firm.caseTypes);
  const hrs = hoursEditor(hours);
  const save = h('button', { class: 'primary', type: 'submit' }, 'Save changes');
  return h('div', null, h('p', null, h('a', { href: '#firms' }, '← My firms')),
    planPanel(`/api/account/firms/${encodeURIComponent(slug)}/plan`),
    h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        const payload = {
          name: f.name.value, blurb: f.blurb.value, about: f.about.value, phone: f.phone.value, website: f.website.value, address: f.address.value,
          tags: splitTags(f.tags.value), caseTypes: cats.get(),
        };
        if (hrs.isDirty()) payload.hours = hrs.anyOpen() ? hrs.get() : null;
        const res = await api('PATCH', '/api/account/firms/' + encodeURIComponent(slug), payload);
        out.replaceChildren(note('msg-ok', res.changed.length ? 'Saved. Your public page updates within about a minute.' : 'No changes to save.'));
      } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
      save.disabled = false;
    } },
      h('div', { class: 'row spread' }, h('h2', null, firm.name), h('a', { href: `/firms/${slug}`, target: '_blank', rel: 'noopener' }, 'View public page')),
      pageMode !== 'dynamic' && note('msg-err', 'Your page has a custom layout that we update for you. Your changes still appear in the directory, search and map. Write to info@lawdb.ca to have the page itself updated.'),
      field('Firm name', f.name), field('Short description (shown in lists)', f.blurb),
      field('About the firm (shown on your page)', f.about, 'Plain text. A blank line starts a new paragraph.'),
      field('Phone', f.phone), field('Website', f.website), field('Address', f.address),
      field('Practice areas (comma separated)', f.tags),
      h('label', null, 'Categories'), cats.el,
      h('label', null, 'Opening hours'), hrs.el,
      h('p', { class: 'muted' }, 'Your rating and review count come from Google and update on their own.'),
      h('div', { class: 'row' }, save), out),
    picturesPanel(`/api/account/firms/${encodeURIComponent(slug)}/images`),
    feedPanel(`/api/account/firms/${encodeURIComponent(slug)}/feed`));
}

// ---------------------------------------------------------------- enquiries
async function viewLeads(slug) {
  const mine = approved();
  if (!slug) {
    if (mine.length === 1) { location.replace(`#leads/${mine[0].slug}`); return h('p', { class: 'muted' }, 'Loading…'); }
    return h('div', null, h('h1', null, 'Enquiries'), mine.length ? mine.map((m) => h('a', { class: 'firm-row', href: `#leads/${m.slug}` }, h('span', null, m.name, h('small', null, where(m))))) : h('p', { class: 'muted' }, 'You do not manage a firm yet.'));
  }
  const firmName = (memberships.find((m) => m.slug === slug) || {}).name || slug;
  const list = h('div');
  const more = h('div', { class: 'row' });
  let next = null;

  const card = (l) => {
    const badge = h('span', { class: 'badge ' + (l.status === 'new' ? 'new' : '') }, l.status);
    const status = h('select', { 'aria-label': 'Enquiry status', onchange: async () => {
      status.disabled = true;
      try { await api('PATCH', `/api/account/leads/${l.id}`, { status: status.value }); badge.textContent = status.value; badge.className = 'badge ' + (status.value === 'new' ? 'new' : ''); }
      catch (err) { alert(err.message); status.value = badge.textContent; }
      status.disabled = false;
    } }, ['new', 'contacted', 'closed', 'spam'].map((s) => h('option', { value: s, selected: s === l.status }, s)));
    return h('article', { class: 'card lead' },
      h('div', { class: 'row spread' }, h('b', null, l.name || '(no name)'), badge),
      h('div', { class: 'meta' }, h('a', { href: 'mailto:' + l.email }, l.email), l.phone && h('a', { href: 'tel:' + l.phone.replace(/[^\d+]/g, '') }, l.phone), h('span', null, when(l.created_at))),
      l.message && h('div', { class: 'body' }, l.message),
      h('div', { class: 'row' }, h('label', { class: 'muted' }, 'Status '), status));
  };

  async function load(reset) {
    if (reset) { list.replaceChildren(); next = null; }
    more.replaceChildren();
    try {
      const data = await api('GET', `/api/account/firms/${encodeURIComponent(slug)}/leads?limit=30${next ? '&before=' + next : ''}`);
      if (!data.leads.length && reset) list.append(h('p', { class: 'muted' }, 'No enquiries yet. When someone contacts you through your LawDB page, it appears here and we email you.'));
      data.leads.forEach((l) => list.append(card(l)));
      next = data.next;
      if (next) more.append(h('button', { type: 'button', onclick: () => load(false) }, 'Load more'));
    } catch (err) { list.append(note('msg-err', err.message)); }
  }
  await load(true);
  return h('div', null, h('p', null, h('a', { href: '#firms' }, '← My firms')), h('h1', null, 'Enquiries for ' + firmName), list, more);
}


// ---------------------------------------------------------------- following, feed, saved
const shortText = (t, n = 200) => (t && t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t || '');

function storyRow(s, onChange) {
  const save = h('button', { type: 'button' }, s.saved ? 'Saved ✓' : 'Save');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const r = s.saved ? await api('DELETE', `/api/account/saved/${s.id}`) : await api('POST', '/api/account/saved', { postId: s.id });
      s.saved = r.saved; save.textContent = s.saved ? 'Saved ✓' : 'Save'; if (onChange) onChange(s);
    } catch (err) { save.textContent = err.message; }
    save.disabled = false;
  });
  return h('div', { class: 'audit' },
    h('div', null, h('a', { href: `/firms/${s.firm.slug}` }, h('b', null, s.firm.name)), ' ', s.firm.featured && h('span', { class: 'badge featured' }, 'Featured'), ' ', h('span', { class: 'muted' }, s.publishedAt ? when(s.publishedAt) : '')),
    h('div', null, h('a', { href: s.href }, s.title)),
    s.excerpt && h('div', { class: 'muted' }, shortText(s.excerpt)),
    h('div', { class: 'row' }, h('a', { href: s.href }, 'Read the story'), save));
}

async function viewFeed() {
  const { stories } = await api('GET', '/api/account/feed');
  api('POST', '/api/account/feed/seen', {}).then(() => { try { sessionStorage.removeItem('lawdb_notif'); } catch (e) {} if (window.lawdbDot) window.lawdbDot(0); }).catch(() => {});
  const nF = (await api('GET', '/api/account/following')).firms.length;
  const first = (user.name || '').split(/\s+/)[0];
  return h('div', null, h('h1', null, first ? `Welcome, ${first}!` : 'Your feed'),
    (!user.name || !user.kind) && h('div', { class: 'card' }, h('p', null, h('b', null, 'Finish your profile')), h('p', { class: 'muted' }, 'Add your name and tell us who you are. It takes a few seconds.'), h('a', { href: '#profile' }, h('button', { class: 'primary', type: 'button' }, 'Continue setting up your profile'))),
    user.name && !user.avatar && h('div', { class: 'card' }, h('p', null, h('b', null, 'Add a profile photo')), h('p', { class: 'muted' }, 'A photo makes your account feel like yours. It takes a few seconds.'), h('a', { href: '#profile' }, h('button', { type: 'button' }, 'Add a photo'))),
    h('p', { class: 'muted' }, 'The latest stories from the firms you follow.'),
    nF === 0
      ? h('div', { class: 'card' }, h('p', null, 'You are not following any firms yet.'), h('p', { class: 'muted' }, 'Follow firms to see their new articles here. You can follow any firm from its profile page, from LawDB News, or search for firms below.'), h('a', { href: '#network' }, h('button', { class: 'primary', type: 'button' }, 'Find firms to follow')))
      : stories.length
        ? h('div', { class: 'card' }, stories.map((s) => storyRow(s)))
        : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'The firms you follow have no stories yet. New ones appear here when they publish.')));
}

const logoSrc = (f) => (f.logo ? (/^(https?:)?\//.test(f.logo) ? f.logo : `/${f.logo}`) : '');
const initialsOf = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// A LinkedIn-style Follow pill: "+ Follow", then "Following" (which turns into "Unfollow" when you point at it).
function followPill(f, onChange) {
  const b = h('button', { type: 'button', class: 'fbtn' });
  let on = !!f.following;
  const paint = () => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.replaceChildren(...(on ? [h('span', { class: 'a' }, '✓ Following'), h('span', { class: 'b' }, 'Unfollow')] : ['+ Follow'])); };
  paint();
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = on ? await api('DELETE', `/api/account/follow/${encodeURIComponent(f.slug)}`) : await api('POST', '/api/account/follow', { slug: f.slug });
      on = r.following; f.followers = r.followers; f.following = on; paint(); if (onChange) onChange(on, r);
    } catch (err) { b.title = err.message; b.textContent = 'Try again'; setTimeout(paint, 2000); }
    b.disabled = false;
  });
  return b;
}

function firmRow(f, onChange) {
  const src = logoSrc(f);
  const place = `${f.city}, ${PROVINCES[f.province] || f.province}`;
  const facts = [f.why, f.followers ? `${f.followers.toLocaleString('en-CA')} follower${f.followers === 1 ? '' : 's'}` : '', f.rating ? `★ ${Number(f.rating).toFixed(1)}` : ''].filter(Boolean).join(' · ');
  return h('div', { class: 'nw-row' },
    h('a', { class: 'nw-ava', href: `/firms/${f.slug}`, 'aria-hidden': 'true', tabindex: '-1' }, src ? h('img', { src, alt: '', loading: 'lazy' }) : initialsOf(f.name)),
    h('div', { class: 'nw-info' }, h('a', { href: `/firms/${f.slug}` }, h('b', null, f.name)), f.featured && h('span', { class: 'badge featured' }, 'Featured'), h('span', { class: 'muted' }, place), facts && h('span', { class: 'muted' }, facts)),
    followPill(f, onChange));
}

// "My network": the firms you follow, and firms worth following next (same place as your firms or you, then the best rated).
async function viewNetwork() {
  const { following, suggestions } = await api('GET', '/api/account/network');
  const count = h('span', null, String(following.length));
  const followingList = h('div', { class: 'card nw-list' }, following.length ? following.map((f) => firmRow({ ...f, following: true })) : [h('p', { class: 'muted' }, 'You are not following any firms yet. Start with the suggestions above, or search for a firm.')]);
  const suggest = h('div', { class: 'card nw-list' }, suggestions.length ? suggestions.map((f) => firmRow(f, (on) => { count.textContent = String(Math.max(0, Number(count.textContent) + (on ? 1 : -1))); })) : [h('p', { class: 'muted' }, 'You follow every firm we can suggest. Nice.')]);
  const search = h('input', { type: 'search', placeholder: 'Search any firm by name or city', 'aria-label': 'Search firms to follow' });
  const results = h('div', { class: 'nw-list' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) return results.replaceChildren();
      try {
        const { firms } = await api('GET', '/api/account/search?q=' + encodeURIComponent(q));
        results.replaceChildren(...firms.map((f) => firmRow({ ...f, following: false })));
      } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
    }, 250);
  });
  return h('div', null, h('h1', null, 'My network'),
    h('p', { class: 'muted' }, 'Follow firms to see their newest articles in your feed. Only you can see who you follow; firms see just how many people follow them.'),
    h('div', { class: 'card' }, search, results),
    h('h2', null, 'Firms you may want to follow'), suggest,
    h('h2', null, 'Following (', count, ')'), followingList);
}

async function viewSaved() {
  const { stories } = await api('GET', '/api/account/saved');
  const box = h('div', { class: 'card' });
  const draw = () => box.replaceChildren(...(stories.length ? stories.map((s) => storyRow(s, (x) => { if (!x.saved) { stories.splice(stories.indexOf(x), 1); draw(); } })) : [h('p', { class: 'muted' }, 'Nothing saved yet. Tap Save on any story to keep it here.')]));
  draw();
  return h('div', null, h('h1', null, 'Saved stories'), box);
}


// ---------------------------------------------------------------- profile
const KIND_LABELS = [['lawyer', 'A lawyer'], ['staff', 'Law firm staff'], ['public', 'Looking for a lawyer'], ['other', 'Something else']];
// Profile photo and cover: the picture is cropped to the right shape (a centred square, or 3:1 for the cover) and shrunk in the browser,
// so uploads are small and fast.
async function cropJpeg(file, w, h) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('That file could not be read as a picture. Try a JPEG or PNG.');
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const sw = w / scale, sh = h / scale;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, h);
  return await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Could not prepare that picture.'))), 'image/jpeg', 0.86));
}

// The top of the profile, like a LinkedIn profile: a cover banner with the profile photo sitting on it.
function photoCard() {
  const box = h('div', { class: 'card pf-head' });
  const msg = h('div');
  const mkInput = (label) => h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'photo-input', 'aria-label': label });
  const avIn = mkInput('Choose a profile photo'), cvIn = mkInput('Choose a cover photo');
  const draw = () => {
    const cover = h('div', { class: user.cover ? 'pf-cover' : 'pf-cover gen' }, user.cover && h('img', { src: user.cover, alt: 'Your cover photo' }),
      h('div', { class: 'pf-cbtns' },
        h('button', { type: 'button', onclick: () => cvIn.click() }, user.cover ? 'Change cover' : 'Add cover photo'),
        user.cover && h('button', { type: 'button', onclick: () => remove('cover') }, 'Remove')));
    const face = user.avatar ? h('img', { src: user.avatar, alt: 'Your profile photo' }) : h('span', null, initialsOf(user.name || user.email));
    const who = h('div', { class: 'pf-who' }, h('b', null, user.name || 'Your name'), [user.jobTitle, user.employer].filter(Boolean).length && h('span', { class: 'muted' }, [user.jobTitle, user.employer].filter(Boolean).join(' at ')), (user.city || user.province) && h('span', { class: 'muted' }, [user.city, PROVINCES[user.province] || user.province].filter(Boolean).join(', ')));
    box.replaceChildren(cover, h('div', { class: 'pf-body' }, h('div', { class: 'ph' }, face), who,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => avIn.click() }, user.avatar ? 'Change photo' : 'Add photo'), user.avatar && h('button', { type: 'button', onclick: () => remove('avatar') }, 'Remove photo')),
      h('p', { class: 'muted pf-note' }, 'Only you can see your photos for now. JPEG, PNG or WebP.'), msg), avIn, cvIn);
  };
  const done = (profile) => {
    user.avatar = profile.avatar; user.cover = profile.cover;
    try { sessionStorage.removeItem('lawdb_me'); } catch (e) {}
    draw(); if (window.lawdbRefresh) window.lawdbRefresh();
  };
  async function remove(kind) {
    try { done((await api('DELETE', `/api/account/${kind}`)).profile); msg.replaceChildren(note('msg-ok', 'Removed.')); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); }
  }
  const wire = (input, kind, w, h2) => input.addEventListener('change', async () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    msg.replaceChildren(note('msg-ok', 'Uploading…'));
    try {
      const blob = await cropJpeg(file, w, h2);
      const res = await fetch(`/api/account/${kind}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
      done(data.profile); msg.replaceChildren(note('msg-ok', 'Saved. Looking good!'));
    } catch (err) { msg.replaceChildren(note('msg-err', err.message)); }
  });
  wire(avIn, 'avatar', 400, 400); wire(cvIn, 'cover', 1200, 400);
  draw();
  return box;
}

async function viewProfile() {
  const { ratings } = await api('GET', '/api/account/ratings');
  const f = (id, label, key, extra = {}) => { const i = h('input', { type: 'text', id, value: user[key] || '', maxlength: 100, ...extra }); return [h('label', { for: id }, label), i, i]; };
  const [l1, name] = f('pname', 'Your name', 'name', { autocomplete: 'name' }); const [l2, city] = f('pcity', 'City', 'city', { autocomplete: 'address-level2' });
  const [l3, title] = f('ptitle', 'Job title', 'jobTitle'); const [l4, emp] = f('pemp', 'Law firm or employer', 'employer');
  const prov = h('select', { id: 'pprov' }, h('option', { value: '' }, 'Province or territory'), Object.entries(PROVINCES).map(([v, l]) => { const o = h('option', { value: v }, l); if (v === user.province) o.selected = true; return o; }));
  const kind = h('select', { id: 'pkind' }, h('option', { value: '' }, 'Choose one'), KIND_LABELS.map(([v, l]) => { const o = h('option', { value: v }, l); if (v === user.kind) o.selected = true; return o; }));
  const msg = h('div');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    try { const r = await api('PATCH', '/api/account/profile', { name: name.value, city: city.value, province: prov.value, jobTitle: title.value, employer: emp.value, kind: kind.value }); Object.assign(user, r.profile); if (window.lawdbRefresh) window.lawdbRefresh(); msg.replaceChildren(note('msg-ok', 'Saved.')); }
    catch (err) { msg.replaceChildren(note('msg-err', err.message)); }
  } }, h('label', { for: 'pname' }, 'Your name'), name, h('label', { for: 'pkind' }, 'I am'), kind, h('label', { for: 'pcity' }, 'City'), city, h('label', { for: 'pprov' }, 'Province or territory'), prov, h('label', { for: 'ptitle' }, 'Job title'), title, h('label', { for: 'pemp' }, 'Law firm or employer'), emp, h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Save')), msg);
  const mine = h('div', { class: 'card' });
  const drawMine = () => mine.replaceChildren(...(ratings.length ? ratings.map((r) => {
    const del = h('button', { type: 'button' }, 'Remove');
    del.addEventListener('click', async () => { del.disabled = true; try { await api('DELETE', `/api/account/ratings/${encodeURIComponent(r.slug)}`); ratings.splice(ratings.indexOf(r), 1); drawMine(); } catch { del.disabled = false; } });
    return h('div', { class: 'audit' }, h('div', null, h('a', { href: `/firms/${r.slug}#rate` }, h('b', null, r.name)), ' ', h('span', { class: 'muted' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) + (r.commentStatus === 'pending' ? ' · comment waiting for review' : ''))), r.comment && h('div', { class: 'muted' }, r.comment), h('div', { class: 'row' }, del));
  }) : [h('p', { class: 'muted' }, 'You have not rated any firms yet. Open a firm page and use "Rate this firm".')]));
  drawMine();
  return h('div', null, h('h1', null, 'Your profile'), h('p', { class: 'muted' }, `Signed in as ${user.email}. Your name personalises your dashboard and emails.`), photoCard(), h('div', { class: 'card' }, form), h('h2', null, 'Your ratings'), mine,
    h('p', { class: 'muted' }, h('a', { href: '#', title: 'Ends every session on every device', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout-all').catch(() => {}); try { localStorage.setItem('lawdb_in', '0'); sessionStorage.removeItem('lawdb_me'); } catch (err) {} location.replace('/account/'); } }, 'Sign out of every device')));
}

// After signing in from a Follow or Save button on a public page, finish what the person asked for.
async function finishPending() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('lawdb_pending') || 'null'); localStorage.removeItem('lawdb_pending'); } catch {}
  if (!p) return false;
  try {
    if (p.type === 'follow') { await api('POST', '/api/account/follow', { slug: p.slug }); location.hash = '#network'; return true; }
    if (p.type === 'back' && typeof p.url === 'string' && /^\/firms\/[a-z0-9-]+(#rate)?$/.test(p.url)) { location.replace(p.url); return true; }
    if (p.type === 'save') { await api('POST', '/api/account/saved', { postId: Number(p.id) }); location.hash = '#saved'; return true; }
  } catch { /* the page still opens; the person can try again */ }
  return false;
}


// ---------------------------------------------------------------- welcome steps (new accounts)
// Four short screens, like a signup wizard: your name, where you are, your current role, and what brings you to LawDB.
const GOALS = [
  ['find', 'I am looking for a lawyer', 'Find a firm near me'],
  ['clients', 'I am a lawyer who wants more clients', 'List or claim my firm'],
  ['staff', 'I work at a law firm', 'Help manage our listing'],
  ['follow', 'I follow the legal profession', 'Follow firms and read their news'],
  ['study', 'I am a student or researcher', 'Learn about firms and the law'],
  ['other', 'Something else', ''],
];
let cityList = null;

function renderWizard() {
  const parts = (user.name || '').trim().split(/\s+/);
  const d = { first: parts[0] || '', last: parts.slice(1).join(' '), city: user.city || '', province: user.province || '', title: user.jobTitle || '', employer: user.employer || '', goal: user.goal || '' };
  let step = 0;
  const steps = 4;
  const valid = [() => d.first.trim() && d.last.trim(), () => d.city.trim(), () => d.title.trim(), () => !!d.goal];

  const input = (id, label, key, attrs = {}) => {
    const i = h('input', { type: 'text', id, value: d[key], maxlength: 80, ...attrs });
    i.addEventListener('input', () => { d[key] = i.value; refresh(); });
    return [h('label', { for: id }, label), i];
  };
  let go;
  const refresh = () => { if (go) go.disabled = !valid[step](); };

  async function finish(skipped) {
    go.disabled = true;
    try {
      const body = skipped ? { complete: true } : { name: `${d.first.trim()} ${d.last.trim()}`.trim(), city: d.city.trim(), province: d.province, jobTitle: d.title.trim(), employer: d.employer.trim(), goal: d.goal, complete: true };
      const r = await api('PATCH', '/api/account/profile', body);
      Object.assign(user, r.profile);
      if (skipped) { location.hash = '#feed'; return render(); }
      if (d.goal === 'find') return location.assign('/find-lawyers');
      location.hash = d.goal === 'clients' || d.goal === 'staff' ? '#find' : '#feed';
      return render();
    } catch (err) { go.disabled = false; msgBox.replaceChildren(note('msg-err', err.message)); }
  }

  const msgBox = h('div');
  function body() {
    if (step === 0) return [h('h1', { class: 'wiz-h' }, 'Join LawDB. It is free'), h('p', { class: 'muted center-text' }, 'Follow firms, save stories and rate the firms you have worked with.'), ...input('w-first', 'First name', 'first', { autocomplete: 'given-name' }), ...input('w-last', 'Last name', 'last', { autocomplete: 'family-name' })];
    if (step === 1) {
      const box = h('input', { type: 'text', id: 'w-city', value: d.city ? (d.province ? `${d.city}, ${d.province}` : d.city) : '', placeholder: 'Start typing a city', autocomplete: 'off', maxlength: 80 });
      const list = h('div', { class: 'wiz-list' });
      const pickCity = (c, pv) => { d.city = c; d.province = pv; box.value = pv ? `${c}, ${pv}` : c; list.replaceChildren(); refresh(); };
      const draw = () => {
        const q = box.value.trim().toLowerCase(); d.city = box.value.trim(); d.province = ''; refresh();
        if (q.length < 1) return list.replaceChildren();
        const hits = (cityList || []).filter((c) => c.city.toLowerCase().startsWith(q) || `${c.city}, ${c.province}`.toLowerCase().startsWith(q)).slice(0, 6);
        list.replaceChildren(...hits.map((c) => h('button', { type: 'button', onclick: () => pickCity(c.city, c.province) }, `${c.city}, ${PROVINCES[c.province] || c.province}`)));
      };
      box.addEventListener('input', draw);
      if (!cityList) api('GET', '/api/cities').then((r) => { cityList = r.cities; }).catch(() => { cityList = []; });
      return [h('h1', { class: 'wiz-h' }, 'Add your location'), h('p', { class: 'muted center-text' }, 'Pick the city closest to you. It helps us show firms nearby.'), h('label', { for: 'w-city' }, 'Location'), box, list];
    }
    if (step === 2) return [h('h1', { class: 'wiz-h' }, 'What is your most recent experience?'), ...input('w-title', 'Job title', 'title', { placeholder: 'For example: Lawyer, Paralegal, Student', autocomplete: 'organization-title' }), ...input('w-emp', 'Law firm or employer (optional)', 'employer', { maxlength: 100, autocomplete: 'organization' })];
    return [h('h1', { class: 'wiz-h' }, 'What brings you to LawDB?'), h('p', { class: 'muted center-text' }, 'This helps us personalise your LawDB.'),
      h('div', { class: 'wiz-opts' }, GOALS.map(([k, label, sub]) => h('button', { type: 'button', class: 'wiz-opt', 'aria-pressed': d.goal === k ? 'true' : 'false', onclick: () => { d.goal = k; draw(); } }, h('b', null, label), sub && h('span', null, sub))))];
  }
  function draw() {
    go = h('button', { class: 'primary wiz-go', type: 'button' }, step === steps - 1 ? 'Finish' : 'Continue');
    go.addEventListener('click', () => { if (!valid[step]()) return; if (step === steps - 1) finish(false); else { step++; draw(); const f = app.querySelector('input'); if (f) f.focus(); } });
    mount(h('div', { class: 'wiz' },
      h('div', { class: 'wiz-top' }, h('a', { class: 'brand', href: '/' }, h('img', { src: '/images/logo-icon.png', alt: '' }), 'LawDB'), h('a', { href: '#', class: 'wiz-skip', onclick: (e) => { e.preventDefault(); finish(true); } }, 'Skip for now')),
      h('div', { class: 'card wiz-card' }, step > 0 && h('button', { type: 'button', class: 'wiz-back', 'aria-label': 'Back', onclick: () => { step--; draw(); } }, '←'), ...body(), go, msgBox),
      h('div', { class: 'wiz-bar', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': steps, 'aria-valuenow': step + 1 }, Array.from({ length: steps }, (_, i) => h('i', { class: i <= step ? 'on' : '' })))));
    refresh();
  }
  draw();
}

// ---------------------------------------------------------------- router
async function loadMe() {
  const data = await api('GET', '/api/account/me');
  user = data.user;
  memberships = data.memberships;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq; // a slower, older render must never overwrite a newer one
  document.body.classList.toggle('lw-focus', !!(user && !user.onboarded));
  if (user && !user.onboarded) return renderWizard();
  const [name, arg] = location.hash.slice(1).split('/');
  const tab = ['feed', 'network', 'saved', 'profile', 'find'].includes(name) ? name : name === 'following' ? 'network' : (!name && !approved().length && !memberships.length ? 'feed' : 'firms');
  mount(shell(tab, h('p', { class: 'muted' }, 'Loading…')));
  try {
    let view;
    if (name === 'find') view = viewFind();
    else if (tab === 'feed') view = await viewFeed();
    else if (tab === 'network') view = await viewNetwork();
    else if (tab === 'saved') view = await viewSaved();
    else if (tab === 'profile') view = await viewProfile();
    else if (name === 'edit' && arg) view = await viewEdit(arg);
    else if (name === 'leads') view = await viewLeads(arg);
    else { await loadMe(); view = viewFirms(); }
    if (seq !== renderSeq) return;
    mount(shell(tab, view));
  } catch (err) {
    if (err.status === 401) return boot();
    if (seq !== renderSeq) return;
    mount(shell(tab, note('msg-err', err.message)));
  }
}

async function boot() {
  try {
    const who = await api('GET', '/api/auth/me');
    try { localStorage.setItem('lawdb_in', who.user ? '1' : '0'); } catch (e) {}
    if (!who.user) return await renderLogin();
    await loadMe();
  } catch (err) { return mount(h('div', { class: 'wrap' }, note('msg-err', err.message))); }
  await finishPending();
  window.removeEventListener('hashchange', render);
  window.addEventListener('hashchange', render);
  render();
}

boot();
