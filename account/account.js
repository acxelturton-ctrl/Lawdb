// LawDB firm-owner dashboard. No framework, no build step.
// SECURITY: everything shown here (including enquiries typed by the public) is inserted as text nodes only.

import { h, api, when, note, hoursEditor, categoryChecks, splitTags, field, picturesPanel, feedPanel, planPanel, PROVINCES } from '/admin/ui.js';

const app = document.getElementById('app');
const mount = (...nodes) => app.replaceChildren(...nodes);
let user = null;
let memberships = [];

// ---------------------------------------------------------------- sign in / create account
function renderLogin() {
  const msg = h('div');
  const email = h('input', { type: 'email', id: 'email', required: true, autocomplete: 'email', placeholder: 'you@yourfirm.ca' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Email me a link');
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
  }, h('label', { for: 'email' }, 'Work email'), email, h('div', { class: 'row' }, btn), msg);
  mount(h('div', { class: 'wrap' }, h('div', { class: 'center card' },
    h('h1', null, 'Manage your firm on LawDB'),
    h('p', { class: 'muted' }, 'Update your firm\'s details and hours, and see the enquiries people send you. No password: we email you a one-time link. New here? The same link creates your free account.'),
    form)));
}

// ---------------------------------------------------------------- shell
function shell(active, content) {
  const tabs = [['feed', 'Feed'], ['following', 'Following'], ['saved', 'Saved'], ['firms', 'My firms'], ['find', 'Add or claim a firm']];
  return h('div', null,
    h('header', { class: 'top' }, h('div', { class: 'wrap' },
      h('a', { class: 'brand', href: '/account/' }, h('img', { src: '/images/logo-icon.png', alt: '' }), 'LawDB'),
      h('div', { class: 'who' }, user.email, h('br'),
        h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout').catch(() => {}); location.replace('/account/'); } }, 'Sign out'), ' · ',
        h('a', { href: '#', title: 'Ends every session on every device', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout-all').catch(() => {}); location.replace('/account/'); } }, 'Sign out everywhere')))),
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
  const nF = (await api('GET', '/api/account/following')).firms.length;
  return h('div', null, h('h1', null, 'Your feed'),
    h('p', { class: 'muted' }, 'The latest stories from the firms you follow.'),
    nF === 0
      ? h('div', { class: 'card' }, h('p', null, 'You are not following any firms yet.'), h('p', { class: 'muted' }, 'Follow firms to see their new articles here. You can follow any firm from its profile page, from LawDB News, or search for firms below.'), h('a', { href: '#following' }, h('button', { class: 'primary', type: 'button' }, 'Find firms to follow')))
      : stories.length
        ? h('div', { class: 'card' }, stories.map((s) => storyRow(s)))
        : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'The firms you follow have no stories yet. New ones appear here when they publish.')));
}

async function viewFollowing() {
  const out = h('div');
  const search = h('input', { type: 'search', placeholder: 'Find a firm to follow: name or city', 'aria-label': 'Search firms to follow' });
  const results = h('div');
  const list = h('div', { class: 'card' });
  const draw = async () => {
    const { firms } = await api('GET', '/api/account/following');
    list.replaceChildren(...(firms.length ? firms.map((f) => {
      const b = h('button', { type: 'button' }, 'Unfollow');
      b.addEventListener('click', async () => { b.disabled = true; try { await api('DELETE', `/api/account/follow/${encodeURIComponent(f.slug)}`); await draw(); } catch (err) { out.replaceChildren(note('msg-err', err.message)); b.disabled = false; } });
      return h('div', { class: 'audit' }, h('div', null, h('a', { href: `/firms/${f.slug}` }, h('b', null, f.name)), ' ', f.featured && h('span', { class: 'badge featured' }, 'Featured'), ' ', h('span', { class: 'muted' }, `${f.city}, ${PROVINCES[f.province] || f.province} · ${f.followers} follower${f.followers === 1 ? '' : 's'}`)), h('div', { class: 'row' }, b));
    }) : [h('p', { class: 'muted' }, 'You are not following any firms yet.')]));
  };
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) return results.replaceChildren();
      try {
        const { firms } = await api('GET', '/api/account/search?q=' + encodeURIComponent(q));
        results.replaceChildren(...firms.map((f) => h('button', { class: 'firm-row', type: 'button', onclick: async () => {
          try { await api('POST', '/api/account/follow', { slug: f.slug }); search.value = ''; results.replaceChildren(); await draw(); } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
        } }, h('span', null, f.name, h('small', null, `${f.city}, ${PROVINCES[f.province] || f.province}`)), h('span', { class: 'muted' }, 'Follow'))));
      } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
    }, 250);
  });
  await draw();
  return h('div', null, h('h1', null, 'Following'),
    h('p', { class: 'muted' }, 'Only you can see who you follow. Firms see just how many people follow them.'),
    h('div', { class: 'card' }, search, results), out, list);
}

async function viewSaved() {
  const { stories } = await api('GET', '/api/account/saved');
  const box = h('div', { class: 'card' });
  const draw = () => box.replaceChildren(...(stories.length ? stories.map((s) => storyRow(s, (x) => { if (!x.saved) { stories.splice(stories.indexOf(x), 1); draw(); } })) : [h('p', { class: 'muted' }, 'Nothing saved yet. Tap Save on any story to keep it here.')]));
  draw();
  return h('div', null, h('h1', null, 'Saved stories'), box);
}

// After signing in from a Follow or Save button on a public page, finish what the person asked for.
async function finishPending() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('lawdb_pending') || 'null'); localStorage.removeItem('lawdb_pending'); } catch {}
  if (!p) return false;
  try {
    if (p.type === 'follow') { await api('POST', '/api/account/follow', { slug: p.slug }); location.hash = '#following'; return true; }
    if (p.type === 'save') { await api('POST', '/api/account/saved', { postId: Number(p.id) }); location.hash = '#saved'; return true; }
  } catch { /* the page still opens; the person can try again */ }
  return false;
}

// ---------------------------------------------------------------- router
async function loadMe() {
  const data = await api('GET', '/api/account/me');
  user = data.user;
  memberships = data.memberships;
}

async function render() {
  const [name, arg] = location.hash.slice(1).split('/');
  const tab = ['feed', 'following', 'saved', 'find'].includes(name) ? name : (!name && !approved().length && !memberships.length ? 'feed' : 'firms');
  mount(shell(tab, h('p', { class: 'muted' }, 'Loading…')));
  try {
    let view;
    if (name === 'find') view = viewFind();
    else if (tab === 'feed') view = await viewFeed();
    else if (tab === 'following') view = await viewFollowing();
    else if (tab === 'saved') view = await viewSaved();
    else if (name === 'edit' && arg) view = await viewEdit(arg);
    else if (name === 'leads') view = await viewLeads(arg);
    else { await loadMe(); view = viewFirms(); }
    mount(shell(tab, view));
  } catch (err) {
    if (err.status === 401) return boot();
    mount(shell(tab, note('msg-err', err.message)));
  }
}

async function boot() {
  try {
    const who = await api('GET', '/api/auth/me');
    if (!who.user) return renderLogin();
    await loadMe();
  } catch (err) { return mount(h('div', { class: 'wrap' }, note('msg-err', err.message))); }
  await finishPending();
  window.removeEventListener('hashchange', render);
  window.addEventListener('hashchange', render);
  render();
}

boot();
