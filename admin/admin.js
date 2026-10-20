// LawDB admin. No framework, no build step.
// SECURITY: visitor-submitted text (leads) is only ever inserted with textContent / text nodes,
// never innerHTML, so hostile messages cannot run code in an admin's browser.

import { h, api, when, note, hoursEditor, categoryChecks, splitTags, field, picturesPanel, feedPanel, CASE_LABELS, PROVINCES } from './ui.js';

const app = document.getElementById('app');

const mount = (...nodes) => app.replaceChildren(...nodes);

// ---------------------------------------------------------------- sign in
function renderLogin() {
  const msg = h('div');
  const email = h('input', { type: 'email', id: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Email me a sign-in link');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.replaceChildren();
      try {
        await api('POST', '/api/auth/request-link', { email: email.value });
        msg.replaceChildren(note('msg-ok', 'If that email is authorized, a sign-in link is on its way. It works once and expires in 15 minutes.'));
      } catch (err) {
        msg.replaceChildren(note('msg-err', err.message));
        btn.disabled = false;
      }
    },
  }, h('label', { for: 'email' }, 'Email'), email, h('div', { class: 'row' }, btn), msg);
  mount(h('div', { class: 'wrap' }, h('div', { class: 'center card' }, h('h1', null, 'LawDB Admin'), h('p', { class: 'muted' }, 'Sign in with a one-time link sent to your email. No password.'), form)));
}

// ---------------------------------------------------------------- shell
let pendingCount = 0;
let paymentCount = 0;
const TABS = [['overview', 'Overview'], ['approvals', 'Approvals'], ['leads', 'Leads'], ['firms', 'Firms'], ['logos', 'Logos'], ['news', 'News'], ['traffic', 'Traffic'], ['projects', 'Projects'], ['journal', 'Journal'], ['search', 'Search'], ['reviews', 'Reviews'], ['payments', 'Payments'], ['people', 'People'], ['activity', 'Activity']];

function shell(user, active, content) {
  return h('div', null,
    h('header', { class: 'top' }, h('div', { class: 'wrap' },
      h('a', { class: 'brand', href: '/admin/' }, h('img', { src: '/images/logo-icon.png', alt: '' }), 'LawDB Admin'),
      h('div', { class: 'who' }, user.email, h('br'),
        h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout').catch(() => {}); location.reload(); } }, 'Sign out'), ' · ',
        h('a', { href: '#', title: 'Ends every session on every device', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout-all').catch(() => {}); location.reload(); } }, 'Sign out everywhere')))),
    h('div', { class: 'wrap' },
      h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS.map(([id, label]) => h('a', { href: `#${id}`, 'aria-current': id === active ? 'page' : false }, label, id === 'approvals' && pendingCount > 0 && h('span', { class: 'count' }, pendingCount), id === 'payments' && paymentCount > 0 && h('span', { class: 'count' }, paymentCount)))),
      content));
}

// ---------------------------------------------------------------- overview
async function viewOverview() {
  const s = await api('GET', '/api/admin/stats');
  pendingCount = s.pendingApprovals;
  paymentCount = s.paymentsToReview;
  const stat = (n, label) => h('div', { class: 'card stat' }, h('b', null, n), h('span', null, label));
  const backupOut = h('div');
  const stale = !s.lastBackupAt || Date.now() - new Date(s.lastBackupAt.replace(' ', 'T') + 'Z').getTime() > 36 * 3600 * 1000;
  const backupBtn = h('button', { type: 'button', onclick: async () => {
    backupBtn.disabled = true;
    try { const r = await api('POST', '/api/admin/backup'); backupOut.replaceChildren(note('msg-ok', `Backed up (${Math.round(r.bytes / 1024)} KB). Reload to see the time.`)); }
    catch (err) { backupOut.replaceChildren(note('msg-err', err.message)); }
    backupBtn.disabled = false;
  } }, 'Back up now');
  return h('div', null, h('h1', null, 'Overview'),
    s.mailFailures24h > 0 && note('msg-err', `${s.mailFailures24h} email${s.mailFailures24h === 1 ? '' : 's'} failed to send in the last 24 hours. Owners may not be getting sign-in links. Check the Activity tab and your Brevo account.`),
    s.paymentsToReview > 0 && h('div', { class: 'msg-err' }, `${s.paymentsToReview} Featured payment${s.paymentsToReview === 1 ? '' : 's'} need${s.paymentsToReview === 1 ? 's' : ''} your review. `, h('a', { href: '#payments' }, 'Open Payments')),
    s.openReports > 0 && h('div', { class: 'msg-err' }, `${s.openReports} listing report${s.openReports === 1 ? '' : 's'} waiting. `, h('a', { href: '#leads' }, 'Open Leads')),
    stale && note('msg-err', 'No backup in the last day and a half. Press "Back up now" and check the Activity tab.'),
    h('div', { class: 'grid' },
      stat(s.leads.new, 'New leads'), stat(s.leadsLast7Days, 'Leads, last 7 days'),
      stat(s.pendingApprovals, 'Waiting for your approval'), stat(s.featuredSubscriptions, 'Featured subscriptions'), stat(money(s.featuredMonthlyCents), 'Featured, per month'), stat(s.firms, 'Firms listed'), stat(s.featured, 'Featured firms'), stat(s.blogPosts, 'Blog posts')),
    h('div', { class: 'card' }, h('b', null, 'Backups'),
      h('p', { class: 'muted' }, s.lastBackupAt ? 'Last backup: ' + when(s.lastBackupAt) + '. A copy is made every night and kept for 35 days.' : 'No backup has run yet.'),
      h('div', { class: 'row' }, backupBtn), backupOut),
    h('div', { class: 'card' }, h('b', null, 'Leads by status'),
      h('p', { class: 'muted' }, `New ${s.leads.new} · Contacted ${s.leads.contacted} · Closed ${s.leads.closed} · Spam ${s.leads.spam}`)),
    await signinCard());
}

// Shows exactly what LawDB sends to Google and LinkedIn, to compare with the settings in each app. Never shows a secret.
async function signinCard() {
  let providers = [];
  try { providers = (await api('GET', '/api/admin/signin-check')).providers; } catch { return null; }
  const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
  return h('div', { class: 'card' }, h('b', null, 'Sign-in check (Google and LinkedIn)'),
    h('p', { class: 'muted' }, 'If a sign-in button fails, compare these values with the settings in that provider\'s app. Secrets are never shown here.'),
    providers.map((p) => h('div', { class: 'signin-check' },
      h('h3', null, p.name, ' ', h('span', { class: 'badge ' + (p.configured && !p.problems.length ? '' : 'new') }, p.configured ? (p.problems.length ? 'Check this' : 'Keys saved') : 'Not set up')),
      h('dl', null, ...row('Client ID LawDB sends', p.clientId || '(none)'), ...row('Client ID length', String(p.clientIdLength)), ...row('Client Secret saved', p.secretLength ? `yes, ${p.secretLength} characters` : 'no'),
        ...row('Redirect URL LawDB sends', p.redirectUri), ...row('Permissions asked for', p.scope)),
      p.problems.map((t) => note('msg-err', t)))));
}

// ---------------------------------------------------------------- leads
async function viewLeads() {
  const list = h('div');
  const more = h('div', { class: 'row' });
  const filter = h('select', { 'aria-label': 'Filter by status' },
    [['', 'All leads'], ['new', 'New'], ['contacted', 'Contacted'], ['closed', 'Closed'], ['spam', 'Spam']].map(([v, l]) => h('option', { value: v }, l)));
  let next = null;

  const card = (l) => {
    const status = h('select', { 'aria-label': 'Lead status', onchange: async () => {
      status.disabled = true;
      try { await api('PATCH', `/api/admin/leads/${l.id}`, { status: status.value }); badge.textContent = status.value; badge.className = 'badge ' + (status.value === 'new' ? 'new' : ''); }
      catch (err) { alert(err.message); status.value = badge.textContent; }
      status.disabled = false;
    } }, ['new', 'contacted', 'closed', 'spam'].map((s) => h('option', { value: s, selected: s === l.status }, s)));
    const badge = h('span', { class: 'badge ' + (l.status === 'new' ? 'new' : '') }, l.status);
    const extras = Object.entries(l.payload || {}).filter(([, v]) => v);
    return h('article', { class: 'card lead' },
      h('div', { class: 'row spread' }, h('b', null, l.name || '(no name)'), badge),
      h('div', { class: 'meta' },
        h('a', { href: 'mailto:' + l.email }, l.email),
        l.phone && h('a', { href: 'tel:' + l.phone.replace(/[^\d+]/g, '') }, l.phone),
        h('span', null, l.form), h('span', null, when(l.created_at))),
      l.message && h('div', { class: 'body' }, l.message),
      extras.length > 0 && h('dl', null, extras.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('div', { class: 'row' }, h('label', { class: 'muted' }, 'Status '), status));
  };

  async function load(reset) {
    if (reset) { list.replaceChildren(); next = null; }
    more.replaceChildren();
    try {
      const q = new URLSearchParams({ limit: '30' });
      if (filter.value) q.set('status', filter.value);
      if (next) q.set('before', next);
      const data = await api('GET', '/api/admin/leads?' + q);
      if (!data.leads.length && reset) list.append(h('p', { class: 'muted' }, 'No leads yet.'));
      data.leads.forEach((l) => list.append(card(l)));
      next = data.next;
      if (next) more.append(h('button', { type: 'button', onclick: () => load(false) }, 'Load more'));
    } catch (err) { list.append(note('msg-err', err.message)); }
  }
  filter.addEventListener('change', () => load(true));
  await load(true);
  return h('div', null, h('div', { class: 'row spread' }, h('h1', null, 'Leads'), filter), list, more);
}

// ---------------------------------------------------------------- firms
// "Give this firm to its owner": after a phone call, email them a sign-in link that opens their own profile editor.
function invitePanel(slug, firm, pageMode) {
  const email = h('input', { type: 'email', placeholder: 'owner@theirfirm.ca', autocomplete: 'off', required: true, 'aria-label': 'Owner email' });
  const isStatic = pageMode === 'static';
  const showEdits = h('input', { type: 'checkbox', checked: isStatic && !firm.featured });
  const out = h('div');
  const history = h('div');
  const go = h('button', { class: 'primary', type: 'submit' }, 'Send invite');

  async function loadHistory() {
    try {
      const { invites } = await api('GET', `/api/admin/firms/${encodeURIComponent(slug)}/invites`);
      history.replaceChildren(...invites.map((i) => h('p', { class: 'muted small' },
        `${i.email}: ${i.usedAt ? 'signed in ' + i.usedAt.slice(0, 10) : i.expired ? 'expired' : 'waiting (sent ' + i.createdAt.slice(0, 10) + ')'}`)));
    } catch { /* optional */ }
  }

  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      const r = await api('POST', `/api/admin/firms/${encodeURIComponent(slug)}/invite`, { email: email.value, switchPage: isStatic && showEdits.checked });
      const link = h('input', { type: 'text', readonly: true, value: r.link, 'aria-label': 'Invite link' });
      const copy = h('button', { type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(r.link); copy.textContent = 'Copied'; } catch { link.select(); copy.textContent = 'Press copy on your keyboard'; }
      } }, 'Copy link');
      out.replaceChildren(note('msg-ok', `Invite emailed to ${r.email}. The link works once and lasts ${r.expiresInDays} days. You can also paste it into a text or read it out:`), h('div', { class: 'row' }, link, copy));
      email.value = '';
      loadHistory();
    } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
    go.disabled = false;
  } },
    h('h2', null, 'Give this firm to its owner'),
    h('p', { class: 'muted' }, 'After you speak with them, enter their email. They get a link that signs them straight in to edit this firm, with no approval step. Later they can sign in with Google or LinkedIn using the same email.'),
    field('Owner email', email),
    isStatic && h('label', { class: 'check small' }, showEdits, firm.featured
      ? 'Show the owner\'s edits on the firm\'s page (replaces this Featured firm\'s custom hand-built layout)'
      : 'Show the owner\'s edits on the firm\'s page (switches it to the database-built page)'),
    h('div', { class: 'row' }, go), out, history);
  loadHistory();
  return form;
}

async function viewFirms() {
  const results = h('div');
  const editor = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search firms by name or city', 'aria-label': 'Search firms' });
  let timer;

  async function find() {
    try {
      const { firms } = await api('GET', '/api/admin/firms?limit=25&q=' + encodeURIComponent(search.value.trim()));
      results.replaceChildren(...(firms.length ? firms.map((f) => h('button', { class: 'firm-row', type: 'button', onclick: () => edit(f.slug) },
        h('span', null, f.name, h('small', null, `${f.city}, ${f.province}`)), f.featured && h('span', { class: 'badge featured' }, 'Featured'), f.status === 'pending' && h('span', { class: 'badge new' }, 'Awaiting approval'))) : [h('p', { class: 'muted' }, 'No firms match.')]));
    } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
  }

  async function edit(slug) {
    const { firm, hours, pageMode } = await api('GET', '/api/admin/firms/' + encodeURIComponent(slug));
    const out = h('div');
    const f = {
      name: h('input', { type: 'text', value: firm.name, maxlength: 200 }),
      blurb: h('textarea', { maxlength: 500 }, firm.blurb || ''),
      about: h('textarea', { class: 'tall', maxlength: 2000 }, firm.about || ''),
      phone: h('input', { type: 'text', value: firm.phone || '', maxlength: 30 }),
      website: h('input', { type: 'text', value: firm.website || '', maxlength: 300 }),
      address: h('input', { type: 'text', value: firm.address || '', maxlength: 300 }),
      tags: h('input', { type: 'text', value: (firm.tags || []).join(', ') }),
      featured: h('input', { type: 'checkbox', checked: !!firm.featured }),
      pageMode: h('select', null, [['static', 'Original hand-built page'], ['dynamic', 'New page, built from the database']].map(([v, l]) => h('option', { value: v, selected: v === pageMode }, l))),
    };
    const cats = categoryChecks(firm.caseTypes);
    const hrs = hoursEditor(hours);
    const save = h('button', { class: 'primary', type: 'submit' }, 'Save changes');
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        const payload = {
          name: f.name.value, blurb: f.blurb.value, about: f.about.value, phone: f.phone.value, website: f.website.value, address: f.address.value,
          tags: splitTags(f.tags.value), caseTypes: cats.get(), featured: f.featured.checked, pageMode: f.pageMode.value,
        };
        if (hrs.isDirty()) payload.hours = hrs.anyOpen() ? hrs.get() : null;
        const res = await api('PATCH', '/api/admin/firms/' + encodeURIComponent(slug), payload);
        out.replaceChildren(note('msg-ok', res.changed.length ? `Saved: ${res.changed.join(', ')}.` : 'No changes to save.'));
        find();
      } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
      save.disabled = false;
    } },
      h('div', { class: 'row spread' }, h('h2', null, firm.name), h('a', { href: `/firms/${slug}`, target: '_blank', rel: 'noopener' }, 'View public page')),
      field('Name', f.name), field('Short description (shown in lists)', f.blurb),
      field('About the firm (shown on the profile page)', f.about, 'Plain text. A blank line starts a new paragraph.'),
      field('Phone', f.phone), field('Website', f.website), field('Address', f.address),
      field('Practice areas (comma separated)', f.tags),
      h('label', null, 'Categories'), cats.el,
      h('label', null, 'Opening hours'), hrs.el,
      h('label', { class: 'check' }, f.featured, 'Featured firm'),
      field('Profile page style', f.pageMode, 'The original pages are hand-built and keep their own wording. The new style is built from the database, so it shows everything you enter here.'),
      h('p', { class: 'muted' }, 'Saved right away; public pages update within about a minute. Rating, reviews and map position come from Google and are not editable here.'),
      h('div', { class: 'row' }, save, h('button', { type: 'button', onclick: () => editor.replaceChildren() }, 'Close')), out);
    editor.replaceChildren(form, invitePanel(slug, firm, pageMode), picturesPanel(`/api/admin/firms/${encodeURIComponent(slug)}/images`), feedPanel(`/api/admin/firms/${encodeURIComponent(slug)}/feed`));
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addFirm() {
    const out = h('div');
    const f = {
      name: h('input', { type: 'text', required: true, maxlength: 200 }),
      city: h('input', { type: 'text', required: true, maxlength: 80 }),
      province: h('select', null, Object.entries(PROVINCES).map(([c, n]) => h('option', { value: c }, n))),
      address: h('input', { type: 'text', maxlength: 300 }),
      phone: h('input', { type: 'text', maxlength: 30 }),
      website: h('input', { type: 'text', maxlength: 300, placeholder: 'https://' }),
      tags: h('input', { type: 'text', placeholder: 'Divorce, Child Custody' }),
      about: h('textarea', { class: 'tall', maxlength: 2000 }),
      lat: h('input', { type: 'text', inputmode: 'decimal', placeholder: '43.6505' }),
      lng: h('input', { type: 'text', inputmode: 'decimal', placeholder: '-79.3857' }),
    };
    const cats = categoryChecks([]);
    const hrs = hoursEditor(null);
    const go = h('button', { class: 'primary', type: 'submit' }, 'Create firm');
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        const payload = {
          name: f.name.value, city: f.city.value, province: f.province.value, address: f.address.value, phone: f.phone.value,
          website: f.website.value, tags: splitTags(f.tags.value), caseTypes: cats.get(), about: f.about.value,
          lat: f.lat.value === '' ? null : Number(f.lat.value), lng: f.lng.value === '' ? null : Number(f.lng.value),
        };
        if (hrs.anyOpen()) payload.hours = hrs.get();
        const res = await api('POST', '/api/admin/firms', payload);
        out.replaceChildren(h('p', { class: 'msg-ok', role: 'status' }, 'Created. ', h('a', { href: res.url, target: '_blank', rel: 'noopener' }, 'View the new page')));
        find();
      } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
      go.disabled = false;
    } },
      h('h2', null, 'Add a firm'),
      field('Firm name', f.name), field('City', f.city), field('Province', f.province), field('Address', f.address),
      field('Phone', f.phone), field('Website', f.website), field('Practice areas (comma separated)', f.tags),
      h('label', null, 'Categories'), cats.el,
      field('About the firm', f.about),
      field('Latitude (optional)', f.lat, 'Leave both empty and LawDB finds the address, or puts the pin in the middle of the city. Only fill them if you want an exact spot.'), field('Longitude (optional)', f.lng),
      h('label', null, 'Opening hours (optional)'), hrs.el,
      h('div', { class: 'row' }, go, h('button', { type: 'button', onclick: () => editor.replaceChildren() }, 'Cancel')), out);
    editor.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(find, 250); });
  await find();
  return h('div', null, h('div', { class: 'row spread' }, h('h1', null, 'Firms'), h('button', { class: 'primary', type: 'button', onclick: addFirm }, 'Add a firm')), search,
    h('div', { class: 'card' }, h('p', { class: 'muted' },
      'Edits are saved to the database and appear on the Find Lawyers page, the directory pages, search and the map within about a minute. A firm\'s profile page changes too once its style is set to "New page, built from the database"; original hand-built pages stay as they are until you switch them.')),
    editor, results);
}

// ---------------------------------------------------------------- logos
// Firms that still show initials instead of a logo. For each, LawDB looks at the firm's own website and offers what it finds; you pick one or skip.
async function viewLogos() {
  const KEY = 'lawdb_logo_after';
  let after = '';
  try { after = localStorage.getItem(KEY) || ''; } catch { /* optional */ }
  const list = h('div');
  const status = h('p', { class: 'muted' });
  const more = h('div', { class: 'row' });
  const bulk = h('div', { class: 'row' });
  let busy = false;

  const card = (f) => {
    const body = h('div', { class: 'logo-opts' }, h('span', { class: 'muted' }, 'Looking at the website...'));
    const skip = h('button', { type: 'button', onclick: () => c.remove() }, 'Skip');
    const c = h('div', { class: 'card logo-card' },
      h('div', { class: 'row spread' }, h('div', null, h('b', null, f.name), h('div', { class: 'muted' }, `${f.city}, ${f.province} · `, h('a', { href: f.website, target: '_blank', rel: 'noopener' }, 'website'))), skip), body);
    c.ready = api('GET', `/api/admin/firms/${encodeURIComponent(f.slug)}/logo-candidates`).then(({ candidates, note: why }) => {
      if (candidates.length && candidates[0].source === 'logo on the page') {
        // The picture is literally called a logo on the firm's own page: safe enough to offer in one tap for the whole page.
        c.sure = async () => { await api('POST', `/api/admin/firms/${encodeURIComponent(f.slug)}/logo-from-url`, { url: candidates[0].url }); body.replaceChildren(note('msg-ok', 'Saved. The logo shows on the firm\'s page and in search within about a minute.')); skip.remove(); };
      }
      if (!candidates.length) { body.replaceChildren(h('span', { class: 'muted' }, 'No usable logo found' + (why ? ` (${why})` : '') + '. You can upload one in Firms, or skip.')); return; }
      body.replaceChildren(...candidates.map((cand) => {
        const use = h('button', { type: 'button', class: 'primary' }, 'Use this logo');
        use.addEventListener('click', async () => {
          use.disabled = true;
          try { await api('POST', `/api/admin/firms/${encodeURIComponent(f.slug)}/logo-from-url`, { url: cand.url }); body.replaceChildren(note('msg-ok', 'Saved. The logo shows on the firm\'s page and in search within about a minute.')); skip.remove(); }
          catch (err) { use.disabled = false; body.append(note('msg-err', err.message)); }
        });
        return h('div', { class: 'logo-opt' }, h('img', { src: '/api/admin/logo-preview?url=' + encodeURIComponent(cand.url), alt: `Logo candidate for ${f.name}`, width: 96, height: 96 }),
          h('small', { class: 'muted' }, `${cand.source}, ${cand.width}x${cand.height}`), use);
      }));
    }).catch((err) => body.replaceChildren(note('msg-err', err.message)));
    return c;
  };

  async function next() {
    if (busy) return;
    busy = true; more.replaceChildren(); status.textContent = 'Loading...';
    try {
      const q = await api('GET', '/api/admin/logo-queue?limit=10&after=' + encodeURIComponent(after));
      const cards = q.firms.map((f) => card(f));
      cards.forEach((c) => list.append(c));
      Promise.allSettled(cards.map((c) => c.ready)).then(() => {
        const sure = cards.filter((c) => c.sure && c.isConnected);
        if (sure.length < 2) return;
        const all = h('button', { type: 'button', class: 'primary' }, `Save the first logo for the ${sure.length} firms where the website calls it "logo"`);
        const out = h('span', { class: 'muted' });
        all.addEventListener('click', async () => {
          all.disabled = true; let ok = 0;
          for (const c of sure) { try { await c.sure(); ok++; out.textContent = `Saved ${ok} of ${sure.length}...`; } catch { /* leave that card for a manual choice */ } }
          out.textContent = `Saved ${ok} of ${sure.length}. Check the rest by hand.`;
        });
        bulk.replaceChildren(all, out);
      });
      if (q.firms.length) { after = q.firms[q.firms.length - 1].slug; try { localStorage.setItem(KEY, after); } catch { /* optional */ } }
      const left = q.remaining - q.firms.length;
      status.textContent = left > 0 ? `${left} more firm${left === 1 ? '' : 's'} without a logo.` : (q.firms.length ? 'That was the last one.' : 'No firms without a logo are left.');
      if (left > 0) more.append(h('button', { type: 'button', class: 'primary', onclick: next }, 'Next 10 firms'));
    } catch (err) { status.replaceChildren(note('msg-err', err.message)); }
    busy = false;
  }
  const restart = h('button', { type: 'button', onclick: () => { try { localStorage.removeItem(KEY); } catch { /* optional */ } render(me); } }, 'Start from the beginning');
  await next();
  return h('div', null, h('h1', null, 'Logos'),
    h('div', { class: 'card' }, h('p', { class: 'muted' }, 'These firms show their initials because no logo has been added. For each one LawDB reads the firm\'s own website for its logo and shows what it finds. Press "Use this logo" on the right one, or Skip. Nothing is saved unless you choose it, and only real JPEG, PNG or WebP pictures are used (not SVG).'),
      h('div', { class: 'row' }, restart), status),
    bulk, list, more);
}

// ---------------------------------------------------------------- approvals
// One tap decides who may manage a firm. Nothing an owner asks for takes effect before this.
const money = (cents) => '$' + ((cents || 0) / 100).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const matchNote = (m) => ({
  match: m.isNewListing ? note('msg-ok', 'Their email is on the website domain they entered. They typed that website themselves, so it proves little for a new listing.') : note('msg-ok', 'Likely genuine: their email address is on the firm\'s own website domain.'),
  free: note('muted', 'Personal email (Gmail or similar). It cannot confirm the person works at the firm. Consider calling the firm\'s listed number.'),
  mismatch: note('msg-err', 'Warning: their email is NOT on the firm\'s website domain. Verify before approving, for example by calling the firm\'s listed number.'),
  nosite: note('muted', 'The firm has no website on file, so the email cannot be checked.'),
})[m.emailMatch];

async function viewApprovals() {
  const [{ members: pending }, { members: decided }] = await Promise.all([
    api('GET', '/api/admin/members'), api('GET', '/api/admin/members?decided=1'),
  ]);
  pendingCount = pending.length;
  async function decide(m, status, extra, out, buttons) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await api('PATCH', '/api/admin/members/' + m.id, { status, ...extra });
      render(me);
    } catch (err) {
      out.replaceChildren(note('msg-err', err.message));
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  function card(m) {
    const out = h('div');
    const lat = h('input', { type: 'number', step: 'any', placeholder: 'Latitude, e.g. 45.42', 'aria-label': 'Latitude' });
    const lng = h('input', { type: 'number', step: 'any', placeholder: 'Longitude, e.g. -75.69', 'aria-label': 'Longitude' });
    const needsCoords = m.isNewListing && !m.hasCoordinates;
    const switchPage = h('input', { type: 'checkbox', checked: !m.featured });
    const approve = h('button', { class: 'primary', type: 'button' }, m.isNewListing ? 'Approve and publish' : 'Approve');
    const reject = h('button', { type: 'button' }, 'Reject');
    const buttons = [approve, reject];
    approve.addEventListener('click', () => decide(m, 'approved', {
      ...(needsCoords ? { lat: lat.value === '' ? null : Number(lat.value), lng: lng.value === '' ? null : Number(lng.value) } : {}),
      ...(m.pageMode === 'static' ? { switchPage: switchPage.checked } : {}),
    }, out, buttons));
    reject.addEventListener('click', () => decide(m, 'rejected', {}, out, buttons));
    const mapQuery = encodeURIComponent([m.firmName, m.firm.address, m.city, m.province].filter(Boolean).join(' '));
    return h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('b', null, m.firmName), m.isNewListing ? h('span', { class: 'badge featured' }, 'New listing') : h('span', { class: 'badge' }, 'Claim')),
      h('p', { class: 'muted' }, `${m.city}, ${m.province}${m.firm.address ? ' · ' + m.firm.address : ''}`),
      h('p', null, h('b', null, m.contactName), m.jobTitle ? ` (${m.jobTitle})` : '', ' · ', m.email, h('br'), h('span', { class: 'muted' }, 'Asked ' + when(m.requestedAt))),
      matchNote(m),
      m.message && h('p', { class: 'quote' }, m.message),
      m.otherOwners && h('p', { class: 'msg-err' }, 'This firm already has an approved owner: ' + m.otherOwners),
      m.isNewListing && h('p', { class: 'muted' }, 'Not public yet. It goes live when you approve.'),
      needsCoords && h('div', null,
        h('p', { class: 'muted' }, 'The address could not be found exactly. You can approve as is: LawDB puts the pin in the middle of the city and hides the map on the firm page. Or enter the exact position (optional):'),
        h('a', { href: `https://www.google.com/maps/search/${mapQuery}`, target: '_blank', rel: 'noopener' }, 'Find on Google Maps'),
        h('div', { class: 'row' }, lat, lng)),
      m.pageMode === 'static' && h('label', { class: 'check small' }, switchPage,
        m.featured ? 'Show this owner\'s edits on the firm\'s page (replaces its custom Featured layout)' : 'Show this owner\'s edits on the firm\'s page'),
      h('div', { class: 'row' }, approve, reject, h('a', { href: `/firms/${m.slug}`, target: '_blank', rel: 'noopener' }, 'View page')), out);
  }

  function decidedRow(m) {
    const out = h('div');
    const btn = m.status === 'approved' ? h('button', { type: 'button' }, 'Remove access') : h('button', { type: 'button' }, 'Approve instead');
    btn.addEventListener('click', () => decide(m, m.status === 'approved' ? 'rejected' : 'approved', {}, out, [btn]));
    return h('div', { class: 'audit' },
      h('div', null, h('b', null, m.firmName), ` · ${m.email} · `, h('span', { class: m.status === 'approved' ? 'msg-ok' : 'muted' }, m.status === 'approved' ? 'Owner' : 'Rejected')),
      h('div', { class: 'muted' }, m.decidedAt ? when(m.decidedAt) : ''), h('div', { class: 'row' }, btn), out);
  }

  return h('div', null, h('h1', null, 'Approvals'),
    pending.length ? pending.map(card) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Nothing waiting. New requests from firm owners appear here, and you get an email.')),
    h('h2', null, 'Recent decisions'),
    h('div', { class: 'card' }, decided.length ? decided.map(decidedRow) : h('p', { class: 'muted' }, 'None yet.')));
}

// ---------------------------------------------------------------- traffic (our own counts, no tracking of people)
let trafficDays = 30;
const SVG_NS = 'http://www.w3.org/2000/svg';
// (The admin's content-security rules forbid style="" in markup, so the chart is drawn with SVG attributes and classes from admin.css.)
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const niceMax = (n) => { const p = 10 ** Math.floor(Math.log10(Math.max(n, 5))); return Math.ceil(Math.max(n, 5) / p) * p; };

// Visits per day (solid), then the straight-line projection (dashed) with its likely range (shaded).
function trafficChart(d) {
  const W = 720, H = 250, L = 46, R = 14, T = 14, B = 30;
  const actual = d.series.map((x) => ({ day: x.day, v: x.visits }));
  const proj = d.forecast && d.forecast.ready ? d.forecast.points : [];
  const total = actual.length + proj.length;
  const ymax = niceMax(Math.max(...actual.map((p) => p.v), ...proj.map((p) => p.hi), 1));
  const x = (i) => L + (total <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (total - 1));
  const y = (v) => T + (1 - v / ymax) * (H - T - B);
  const line = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const aPts = actual.map((p, i) => [x(i), y(p.v)]);
  const fullPts = aPts.slice(0, -1); // today is still going, so it is shown as a hollow dot, not as the end of the line (it would look like a crash)
  const children = [];
  for (const f of [0, 0.5, 1]) {
    children.push(svg('line', { class: 'ch-grid', x1: L, x2: W - R, y1: y(ymax * f), y2: y(ymax * f) }));
    children.push(svg('text', { class: 'ch-axis', x: L - 6, y: y(ymax * f) + 4, 'text-anchor': 'end' }, String(Math.round(ymax * f))));
  }
  if (proj.length) {
    const up = proj.map((p, i) => [x(actual.length + i), y(p.hi)]);
    const down = proj.map((p, i) => [x(actual.length + i), y(p.lo)]).reverse();
    children.push(svg('path', { class: 'ch-band', d: `${line([fullPts[fullPts.length - 1], ...up])}${down.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('')}Z` }));
  }
  children.push(svg('path', { class: 'ch-area', d: `${line(fullPts)}L${fullPts[fullPts.length - 1][0].toFixed(1)},${y(0)}L${fullPts[0][0].toFixed(1)},${y(0)}Z` }));
  children.push(svg('path', { class: 'ch-line', d: line(fullPts) }));
  children.push(svg('circle', { class: 'ch-now', cx: aPts[aPts.length - 1][0], cy: aPts[aPts.length - 1][1], r: 4 }));
  if (proj.length) children.push(svg('path', { class: 'ch-proj', d: line([fullPts[fullPts.length - 1], ...proj.map((p, i) => [x(actual.length + i), y(p.visits)])]) }));
  children.push(svg('line', { class: 'ch-today', x1: x(actual.length - 1), x2: x(actual.length - 1), y1: T, y2: H - B }));
  const label = (i, text, anchor) => svg('text', { class: 'ch-axis', x: x(i), y: H - 8, 'text-anchor': anchor }, text);
  children.push(label(0, shortDay(actual[0].day), 'start'), label(actual.length - 1, 'today', proj.length ? 'middle' : 'end'));
  if (proj.length) children.push(label(total - 1, shortDay(proj[proj.length - 1].day), 'end'));
  // a dot with a tooltip on every day, so hovering or tapping reads out the number
  actual.forEach((p, i) => children.push(svg('circle', { class: 'ch-dot', cx: x(i), cy: y(p.v), r: 5 }, svg('title', {}, `${longDay(p.day)}: ${p.v} visits${i === actual.length - 1 ? ' so far today (still counting)' : ''}`))));
  proj.forEach((p, i) => children.push(svg('circle', { class: 'ch-dot', cx: x(actual.length + i), cy: y(p.visits), r: 5 }, svg('title', {}, `${longDay(p.day)} (projected): about ${p.visits} visits, likely ${p.lo} to ${p.hi}`))));
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Visits per day from ${shortDay(actual[0].day)} to today${proj.length ? `, then a projection to ${shortDay(proj[proj.length - 1].day)}` : ''}. The numbers are in the table below.` }, children);
}

async function viewTraffic() {
  const d = await api('GET', `/api/admin/traffic?days=${trafficDays}`);
  const num = (n) => Number(n || 0).toLocaleString();
  const place = (k) => (!k ? 'no place given' : k === 'near-me' ? 'Near me' : PROVINCES[k] ? `${PROVINCES[k]} (whole province)` : k.replace('|', ', '));
  const kase = (k) => (k ? CASE_LABELS[k] || k : 'any kind of lawyer');
  const table = (heads, rows, empty) => (rows.length
    ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, heads.map((t, i) => h('th', { class: i === heads.length - 1 ? 'n' : '' }, t)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i === r.length - 1 ? 'n' : '' }, c))))))
    : h('p', { class: 'muted' }, empty || 'Nothing yet.'));
  const box = (title, hint, body) => h('div', { class: 'card' }, h('h2', null, title), hint && h('p', { class: 'muted' }, hint), body);
  const simple = (rows, empty) => table(['', 'Count'], rows.map((r) => [r.label, num(r.n)]), empty);

  const f = d.forecast;
  const headline = f && f.ready
    ? h('p', null, h('b', null, `If this trend holds: about ${num(f.next30)} visits over the next 30 days`), ` (the last 30 days: ${num(f.last30)}). The daily average is ${num(f.avgNow)} and is ${f.perWeekPct >= 0 ? 'climbing' : 'falling'} about ${Math.abs(f.perWeekPct)}% a week.`,
      !f.steady && h('span', { class: 'muted' }, ' The days so far bounce around too much for this to be more than a rough guide.'))
    : h('p', { class: 'muted' }, `The projection appears after 7 full days of counting (${f ? f.haveDays : 0} so far). Today is left out because it is still going.`);
  const days = h('div', { class: 'row' }, [7, 30, 90].map((n) => {
    const b = h('button', { type: 'button', 'aria-pressed': n === trafficDays ? 'true' : 'false', class: n === trafficDays ? 'primary' : '' }, `Last ${n} days`);
    b.addEventListener('click', () => { trafficDays = n; render(me); });
    return b;
  }));
  const dailyRows = [...d.series].reverse().map((x) => [longDay(x.day), num(x.pageViews), num(x.visits)]);

  // Where growth could come from: listings against visits, by province.
  const prov = {};
  for (const g of d.geo) { const [c, r] = g.label.split(' '); if (c === 'CA' && r) prov[r] = (prov[r] || 0) + g.n; }
  const caVisits = Object.values(prov).reduce((a, b) => a + b, 0);
  const firmsTotal = d.coverage.reduce((a, c) => a + c.firms, 0);
  const share = (n, t) => (t > 0 ? `${Math.round((n / t) * 100)}%` : '–');
  const where = table(['Province', 'Firms listed', 'Share of firms', 'Visits', 'Share of visits'],
    d.coverage.map((c) => [PROVINCES[c.province] || c.province, num(c.firms), share(c.firms, firmsTotal), num(prov[c.province] || 0), share(prov[c.province] || 0, caVisits)]).map((r) => r), 'No firms yet.');

  return h('div', { class: 'traffic' },
    h('h1', null, 'Traffic'),
    h('p', { class: 'muted' }, `Our own counts, kept without tracking anyone: no cookies, no IP addresses, no visitor ids. Robots and visitors who send Do Not Track are left out. ${d.since ? `Counting since ${d.since}.` : 'Nothing has been counted yet; numbers appear as people visit.'} Days are Toronto days.`),
    days,
    h('div', { class: 'grid' },
      [['Visits', d.totals.visits], ['Page views', d.totals.pageViews], ['Searches', d.totals.searches], ['Clicks that matter', d.totals.clicks]].map(([label, n]) => h('div', { class: 'card stat' }, h('b', null, num(n)), h('span', null, label)))),
    h('div', { class: 'card' },
      h('h2', null, 'Visits per day, and where they are heading'),
      headline,
      trafficChart(d),
      h('div', { class: 'legend' }, h('span', { class: 'key k-line' }, 'Visits (full days)'), f && f.ready && h('span', { class: 'key k-proj' }, 'Projection'), f && f.ready && h('span', { class: 'key k-band' }, 'Likely range'), h('span', { class: 'muted' }, ' Hover or tap a point for the day.')),
      f && f.ready && h('p', { class: 'muted' }, 'The projection is a straight line through the full days counted so far. It does not know about weekends, holidays or what you do next, so treat it as a rough guide.'),
      h('details', null, h('summary', null, 'Show the numbers as a table'), table(['Day', 'Page views', 'Visits'], dailyRows))),
    h('div', { class: 'card tips' },
      h('h2', null, 'What you could do to grow traffic'),
      h('p', { class: 'muted' }, 'Written from the numbers on this page, so it changes as the numbers do. Each point says which number it comes from.'),
      h('ol', null, d.tips.map((t) => h('li', null, h('b', null, t.title), h('p', { class: 'why' }, t.why), h('p', null, h('span', { class: 'do' }, 'Do: '), t.action))))),
    box('Where traffic could grow', 'Listings against Canadian visits, by province. A province with a bigger share of visits than of firms is asking for more listings; the opposite means listings that nobody is finding yet.', where),
    h('h2', null, 'What people look for'),
    h('div', { class: 'two' },
      box('Searches', 'The kind of lawyer and where, most common first.', table(['Kind of lawyer', 'Where', 'Searches'], d.searches.map((r) => [kase(r.kase), place(r.place), num(r.n)]), 'No searches yet.')),
      box('Towns people want that we have no page for', 'The firms nearest to them were shown instead. Good places to add firms. Kept 90 days.', table(['Town', 'Kind of lawyer', 'Searches'], d.towns.map((r) => [r.label, kase(r.kase), num(r.n)]), 'None yet.')),
      box('Searches that matched nothing', 'Words typed that were not a lawyer type, a city or a province. Kept 90 days.', simple(d.noparse, 'None yet.'))),
    h('h2', null, 'Where visitors come from'),
    h('div', { class: 'two' },
      box('Websites that sent visitors', null, simple(d.refs)),
      box('First page of a visit', 'The pages people land on.', simple(d.entries)),
      box('Country and province', 'From Cloudflare\'s coarse location, new visits only.', simple(d.geo)),
      box('Phone or computer', 'By the width of the screen.', simple(d.devices)),
      d.utm.length ? box('Campaign links (utm_source)', null, simple(d.utm)) : null),
    h('h2', null, 'What they view and do'),
    h('div', { class: 'two' },
      box('Most viewed pages', null, simple(d.pages)),
      box('Most viewed firms', null, table(['Firm', 'Page views'], d.firms.map((r) => [h('a', { href: r.path, target: '_blank', rel: 'noopener' }, r.label), num(r.n)]))),
      box('Clicks that matter', 'Call, website and directions buttons, follows, claims, and the buttons that sell Featured or listing.', simple(d.events)),
      box('Firms getting call, website and directions clicks', null, table(['Firm', 'Button', 'Clicks'], d.eventFirms.map((r) => [r.label, r.kind, num(r.n)])))));
}

// ---------------------------------------------------------------- future projects
const PROJECT_STATUS = [['doing', 'In progress'], ['next', 'Next up'], ['idea', 'Ideas'], ['done', 'Done']];
async function viewProjects() {
  const { projects } = await api('GET', '/api/admin/projects');
  const out = h('div');
  const fail = (err) => out.replaceChildren(note('msg-err', err.message));
  const patch = async (id, body) => { try { await api('PATCH', `/api/admin/projects/${id}`, body); render(me); } catch (err) { fail(err); } };

  function card(p) {
    const body = h('div', { class: 'proj' });
    const showView = () => {
      const status = h('select', { 'aria-label': `Status of ${p.title}` }, PROJECT_STATUS.map(([v, label]) => h('option', { value: v, selected: v === p.status }, label)));
      status.addEventListener('change', () => patch(p.id, { status: status.value }));
      const edit = h('button', { type: 'button' }, 'Edit');
      edit.addEventListener('click', showEdit);
      const del = h('button', { type: 'button' }, 'Delete');
      del.addEventListener('click', async () => { if (!confirm(`Delete "${p.title}"?`)) return; try { await api('DELETE', `/api/admin/projects/${p.id}`); render(me); } catch (err) { fail(err); } });
      const up = h('button', { type: 'button', 'aria-label': 'Move up', title: 'Move up' }, '↑');
      const down = h('button', { type: 'button', 'aria-label': 'Move down', title: 'Move down' }, '↓');
      up.addEventListener('click', () => patch(p.id, { move: 'up' }));
      down.addEventListener('click', () => patch(p.id, { move: 'down' }));
      body.replaceChildren(
        h('div', { class: 'row spread' }, h('b', { class: 'proj-title' }, p.title),
          h('span', { class: `badge ${p.source === 'you' ? 'b-you' : 'b-claude'}` }, p.source === 'you' ? `You asked${p.askedOn ? ' · ' + shortDay(p.askedOn) : ''}` : 'Claude\'s idea')),
        p.detail && h('p', { class: 'proj-detail' }, p.detail),
        h('div', { class: 'row' }, status, up, down, edit, del));
    };
    function showEdit() {
      const title = h('input', { type: 'text', value: p.title, maxlength: 120, 'aria-label': 'Title' });
      const detail = h('textarea', { maxlength: 1200, 'aria-label': 'Details' }, p.detail);
      const save = h('button', { class: 'primary', type: 'button' }, 'Save');
      const cancel = h('button', { type: 'button' }, 'Cancel');
      save.addEventListener('click', () => patch(p.id, { title: title.value, detail: detail.value }));
      cancel.addEventListener('click', showView);
      body.replaceChildren(title, detail, h('div', { class: 'row' }, save, cancel));
    }
    showView();
    return h('div', { class: 'card' }, body);
  }

  const groups = PROJECT_STATUS.map(([status, label]) => {
    const list = projects.filter((p) => p.status === status);
    if (!list.length) return null;
    const cards = list.map(card);
    return status === 'done'
      ? h('details', null, h('summary', null, `${label} (${list.length})`), cards)
      : h('div', null, h('h2', null, `${label} (${list.length})`), cards);
  });

  const title = h('input', { type: 'text', maxlength: 120, placeholder: 'A big thing to do, e.g. "French pages for Quebec"', 'aria-label': 'New project title' });
  const detail = h('textarea', { maxlength: 1200, placeholder: 'Why it matters and what it would take (optional)', 'aria-label': 'New project details' });
  const add = h('button', { class: 'primary', type: 'button' }, 'Add project');
  add.addEventListener('click', async () => {
    if (!title.value.trim()) return;
    add.disabled = true;
    try { await api('POST', '/api/admin/projects', { title: title.value, detail: detail.value, status: 'idea', source: 'you', askedOn: new Date().toISOString().slice(0, 10) }); render(me); } catch (err) { fail(err); add.disabled = false; }
  });

  return h('div', { class: 'projects' },
    h('h1', null, 'Future projects'),
    h('p', { class: 'muted' }, 'The big things you have asked for that are not done yet, and ideas Claude has suggested. Change a project\'s status, move it up or down, edit it, or add your own. Small fixes do not belong here.'),
    out,
    groups,
    h('div', { class: 'card' }, h('h2', null, 'Add a project'), title, detail, h('div', { class: 'row' }, add)));
}

// ---------------------------------------------------------------- daily journal
async function viewJournal() {
  const data = await api('GET', '/api/admin/journal');
  const out = h('div');
  const num = (n) => Number(n || 0).toLocaleString();
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

  function entry(e, live) {
    const lines = [];
    if (e.shipped.length) lines.push(h('div', null, h('b', null, live ? 'Shipped so far' : 'Shipped'), h('ul', null, e.shipped.map((t) => h('li', null, t)), e.moreShipped > 0 && h('li', { class: 'muted' }, `and ${e.moreShipped} more`))));
    if (e.visits || e.pageViews || e.searches || e.clicks) {
      // a day that is still going is not compared with a whole day
      const change = !live && e.prevVisits > 0 ? Math.round(((e.visits - e.prevVisits) / e.prevVisits) * 100) : null;
      const vs = change === null ? '' : change === 0 ? ' (same as the day before)' : ` (${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% from the day before)`;
      lines.push(h('p', null, h('b', null, 'Site: '), `${plural(e.visits, 'visit', 'visits')}${vs} · ${plural(e.pageViews, 'page view', 'page views')} · ${plural(e.searches, 'search', 'searches')} · ${plural(e.clicks, 'click that matters', 'clicks that matter')}`));
    }
    const people = [e.enquiries && plural(e.enquiries, 'enquiry', 'enquiries'), e.ownerRequests && plural(e.ownerRequests, 'owner request', 'owner requests'), e.payments && plural(e.payments, 'new payment', 'new payments')].filter(Boolean);
    if (people.length) lines.push(h('p', null, h('b', null, 'People: '), people.join(' · ')));
    if (e.wanted) lines.push(h('p', null, h('b', null, 'Most wanted town with no page: '), `${e.wanted.town}${e.wanted.kase ? ` (${CASE_LABELS[e.wanted.kase] || e.wanted.kase})` : ''}`));
    if (e.problems.length) lines.push(h('p', { class: 'problem' }, h('b', null, 'Problems: '), e.problems.join(' · ')));
    if (!lines.length) lines.push(h('p', { class: 'muted' }, 'Nothing yet today.'));
    // a note stays out of the way: shown as text when there is one, and edited from a small "note" link
    const noteBox = h('textarea', { maxlength: 500, placeholder: 'A note for this day', 'aria-label': `Note for ${longDay(e.day)}` }, e.note || '');
    const save = h('button', { type: 'button' }, 'Save note');
    const shown = h('p', { class: 'note', hidden: !e.note }, e.note || '');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await api('PATCH', `/api/admin/journal/${e.day}`, { note: noteBox.value }); shown.textContent = noteBox.value.trim(); shown.hidden = !noteBox.value.trim(); save.textContent = 'Saved'; } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
      setTimeout(() => { save.disabled = false; save.textContent = 'Save note'; }, 1200);
    });
    return h('div', { class: 'card journal-day' }, h('h2', null, live ? `Today so far · ${longDay(e.day)}` : longDay(e.day)), lines, shown,
      h('details', null, h('summary', null, e.note ? 'Edit the note' : 'Add a note'), noteBox, h('div', { class: 'row' }, save)));
  }

  const SHOWN = 10;
  const older = h('div', { hidden: true }, data.entries.slice(SHOWN).map((e) => entry(e, false)));
  const more = h('button', { type: 'button', hidden: data.entries.length <= SHOWN }, `Show ${data.entries.length - SHOWN} older days`);
  more.addEventListener('click', () => { older.hidden = false; more.hidden = true; });
  const rebuild = h('button', { type: 'button' }, data.entries.length ? 'Fill in any missing days' : 'Write the last two weeks now');
  rebuild.addEventListener('click', async () => { rebuild.disabled = true; try { await api('POST', '/api/admin/journal/rebuild'); render(me); } catch (err) { out.replaceChildren(note('msg-err', err.message)); rebuild.disabled = false; } });

  return h('div', { class: 'journal' },
    h('h1', null, 'Journal'),
    h('p', { class: 'muted' }, 'Written for you every night, short on purpose: what shipped that day, a few numbers, and anything that broke. A day with nothing in it is skipped. What shipped comes from the site\'s own deploys; the numbers come from the Traffic counts.'),
    out,
    entry(data.today, true),
    data.entries.slice(0, SHOWN).map((e) => entry(e, false)),
    older,
    data.entries.length ? null : h('p', { class: 'muted' }, 'No saved days yet. The first one is written tonight; you can also write the last two weeks now.'),
    h('div', { class: 'row' }, more, rebuild));
}

// ---------------------------------------------------------------- search (Google Search Console)
// The site talks to Google Search Console by itself: it submits the sitemap and asks Google, a batch of pages at a time, which pages are on Google and why not.
// Requesting indexing for a single page is the one thing Google does not allow software to do.
async function viewSearch() {
  const data = await api('GET', '/api/admin/search');
  const out = h('div');
  const reload = () => render(me);
  const stamp = (v) => (v ? when(v) : 'never');

  if (!data.connected) {
    return h('div', null, h('h1', null, 'Search'),
      h('div', { class: 'card' },
        h('p', null, h('b', null, 'Not connected to Google Search Console yet.')),
        h('p', { class: 'muted' }, 'Once connected, this site submits the sitemap to Google every night and checks, a batch of pages at a time, which pages are on Google and why not. About ten minutes of setup, once:'),
        h('ol', null,
          h('li', null, 'In Google Cloud (console.cloud.google.com) make a project, turn on the "Google Search Console API", create a service account and download its key (a .json file).'),
          h('li', null, 'In Search Console: Settings, Users and permissions, Add user. Paste the service account\'s email and give it Full permission (Owner if Google lets you).'),
          h('li', null, 'In Cloudflare: Workers & Pages, lawdb, Settings, Variables and Secrets. Add a secret named GSC_SERVICE_ACCOUNT_JSON and paste the whole contents of the .json file. Never paste the key anywhere else.'),
          h('li', null, 'Come back here and press Check connection.')),
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: reload }, 'Check connection'))));
  }

  const busy = (btn, text) => { btn.disabled = true; out.replaceChildren(note('msg-ok', text)); };
  const run = (part, label) => {
    const b = h('button', { type: 'button' }, label);
    b.addEventListener('click', async () => {
      busy(b, part === 'sitemap' ? 'Sending the sitemap to Google...' : 'Asking Google about the next pages. This takes a minute...');
      try {
        const r = await api('POST', '/api/admin/search/run', { part });
        if (!r.ok) { out.replaceChildren(note('msg-err', r.error || 'Google reported a problem.')); b.disabled = false; return; }
        reload();
      } catch (err) { out.replaceChildren(note('msg-err', err.message)); b.disabled = false; }
    });
    return b;
  };

  const urlBox = h('input', { type: 'text', placeholder: 'Check one page, e.g. /find-lawyers', 'aria-label': 'Page address to check' });
  const one = h('div');
  const checkOne = h('button', { type: 'button' }, 'Ask Google');
  checkOne.addEventListener('click', async () => {
    if (!urlBox.value.trim()) return;
    checkOne.disabled = true; one.replaceChildren(note('msg-ok', 'Asking Google...'));
    try {
      const { page } = await api('POST', '/api/admin/search/inspect', { url: urlBox.value });
      one.replaceChildren(note(page.verdict === 'PASS' ? 'msg-ok' : 'msg-err', `${page.url}: ${page.coverageState || 'no answer'}${page.lastCrawlAt ? ', last crawled ' + when(page.lastCrawlAt) : ''}`));
    } catch (err) { one.replaceChildren(note('msg-err', err.message)); }
    checkOne.disabled = false;
  });

  const sm = data.sitemap;
  const smLine = sm
    ? `Sitemap sent ${stamp(sm.at)}${sm.lastDownloaded ? '; Google read it ' + stamp(sm.lastDownloaded) : ''}${sm.submitted ? `; ${sm.submitted} pages listed` : ''}${sm.errors ? `; ${sm.errors} errors` : ''}${sm.warnings ? `; ${sm.warnings} warnings` : ''}.`
    : 'The sitemap has not been sent yet.';
  const last = data.lastRun;

  return h('div', null, h('h1', null, 'Search'),
    h('div', { class: 'card' },
      h('p', null, h('span', { class: 'badge' }, 'Connected'), ' ', h('span', { class: 'muted' }, `as ${data.clientEmail}${data.site ? ', property ' + data.site : ''}`)),
      h('p', null, smLine),
      last && h('p', { class: last.ok ? 'muted' : 'msg-err' }, `Last run ${stamp(last.at)}: ${last.ok ? 'worked' + (last.checked != null ? `, ${last.checked} pages checked` : '') : last.error}`),
      h('p', null, h('b', null, `${data.onGoogle} of ${data.pagesChecked} checked pages are on Google`), ` (${data.sitemapPages} pages are in our sitemap). Every night the next 40 pages are checked, round and round, so the whole site is covered in about two weeks.`),
      h('div', { class: 'row' }, run('sitemap', 'Send sitemap now'), run('inspect', 'Check the next 40 pages')), out),
    h('div', { class: 'card' }, h('h2', null, 'Check one page'), h('div', { class: 'row' }, urlBox, checkOne), one),
    data.heldBack && h('div', { class: 'card' }, h('h2', null, 'Profiles held back from Google'),
      h('p', { class: 'muted' }, `A profile with no real description (under ${data.heldBack.minWords} words) is a thin page, so it carries a noindex tag and stays out of the sitemap until a description is added. ${data.heldBack.count} of ${data.heldBack.of} database-built profiles are held back right now.`),
      data.heldBack.sample.length
        ? h('ul', null, ...data.heldBack.sample.map((f) => h('li', null, h('a', { href: '/firms/' + f.slug, target: '_blank', rel: 'noopener' }, f.name), ` (${f.words} words)`)))
        : h('p', { class: 'muted' }, 'None. Every profile has a description.')),
    h('div', { class: 'card' }, h('h2', null, 'What Google says'),
      data.states.length ? h('ul', null, ...data.states.map((s) => h('li', null, `${s.state}: ${s.n}`))) : h('p', { class: 'muted' }, 'No pages checked yet. Press "Check the next 40 pages".')),
    h('div', { class: 'card' }, h('h2', null, 'Pages that are not on Google yet'),
      h('p', { class: 'muted' }, `${data.notOnGoogle} checked pages are not on Google yet${data.problems.length < data.notOnGoogle ? ` (the ${data.problems.length} most recently checked are shown)` : ''}. To ask Google to look at one sooner, open it in Search Console\'s URL Inspection box and press Request indexing. Google does not allow that step to be automated.`),
      data.problems.length
        ? h('div', null, ...data.problems.map((p) => h('div', { class: 'audit' }, h('div', null, h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.url)), h('div', { class: 'muted' }, p.error ? 'Could not be checked: ' + p.error : `${p.state || 'Unknown'}${p.lastCrawlAt ? ', last crawled ' + when(p.lastCrawlAt) : ', not crawled yet'}`))))
        : h('p', { class: 'muted' }, 'Nothing to list yet.')));
}

// ---------------------------------------------------------------- reviews (member ratings)
// Stars show straight away; a comment is shown only after you approve it. You can hide any rating at any time.
async function viewReviews() {
  const data = await api('GET', '/api/admin/reviews');
  const out = h('div');
  const reload = () => render(me);
  const act = (r, action, label) => {
    const b = h('button', { type: 'button' }, label);
    b.addEventListener('click', async () => { b.disabled = true; try { await api('PATCH', `/api/admin/reviews/${r.userId}/${encodeURIComponent(r.slug)}`, { action }); reload(); } catch (err) { out.replaceChildren(note('msg-err', err.message)); b.disabled = false; } });
    return b;
  };
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const row = (r, pending) => h('div', { class: 'audit' },
    h('div', null, h('b', null, r.firm), ' ', h('span', { class: 'muted' }, `${stars(r.stars)} · ${r.email} · ${when(r.at)}${r.status === 'hidden' ? ' · HIDDEN' : ''}${!pending && r.comment ? ' · comment ' + r.commentStatus : ''}`)),
    r.comment && h('div', null, r.comment),
    h('div', { class: 'row' }, pending ? [act(r, 'approve', 'Approve comment'), act(r, 'reject', 'Reject comment')] : [], r.status === 'hidden' ? act(r, 'show', 'Show rating') : act(r, 'hide', 'Hide rating'), h('a', { href: `/firms/${r.slug}`, target: '_blank', rel: 'noopener' }, 'Open firm')));
  return h('div', null, h('h1', null, 'Reviews'), out,
    h('h2', null, `Comments waiting for you (${data.pending.length})`),
    h('div', { class: 'card' }, data.pending.length ? data.pending.map((r) => row(r, true)) : h('p', { class: 'muted' }, 'Nothing waiting.')),
    h('h2', null, 'Latest ratings'),
    h('div', { class: 'card' }, data.recent.length ? data.recent.map((r) => row(r, false)) : h('p', { class: 'muted' }, 'No ratings yet.')));
}

// ---------------------------------------------------------------- payments
// Featured subscriptions paid through Stripe. A payment from a verified owner turns Featured on by itself; anything the
// site could not match to an owner waits here for you.
async function viewPayments() {
  const data = await api('GET', '/api/admin/payments');
  paymentCount = data.needsReview.length;
  const dollars = (r) => (r.amountCents == null ? '' : money(r.amountCents) + (r.currency ? ' ' + r.currency.toUpperCase() : ''));

  function reviewCard(r) {
    const out = h('div');
    const pick = { slug: r.slug || '' };
    const search = h('input', { type: 'search', placeholder: 'Search for the firm to feature', 'aria-label': 'Search firms' });
    const results = h('div');
    let timer;
    const choose = h('p', { class: 'muted' }, r.slug ? `Payer named: ${r.firmName}` : 'No firm was named in this payment.');
    const assign = h('button', { class: 'primary', type: 'button' }, r.slug ? `Feature ${r.firmName}` : 'Feature the chosen firm');
    assign.disabled = !pick.slug;
    assign.addEventListener('click', async () => {
      assign.disabled = true;
      try { await api('POST', `/api/admin/payments/${encodeURIComponent(r.id)}/assign`, { slug: pick.slug }); render(me); }
      catch (err) { out.replaceChildren(note('msg-err', err.message)); assign.disabled = false; }
    });
    const dismiss = h('button', { type: 'button' }, 'Dismiss');
    dismiss.addEventListener('click', async () => {
      if (!confirm('Dismiss this payment? Nobody will be made Featured.')) return;
      try { await api('POST', `/api/admin/payments/${encodeURIComponent(r.id)}/dismiss`); render(me); } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
    });
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = search.value.trim();
        if (q.length < 2) return results.replaceChildren();
        try {
          const { firms } = await api('GET', '/api/admin/firms?limit=8&q=' + encodeURIComponent(q));
          results.replaceChildren(...firms.map((f) => h('button', { class: 'firm-row', type: 'button', onclick: () => { pick.slug = f.slug; assign.disabled = false; assign.textContent = `Feature ${f.name}`; choose.textContent = `Chosen: ${f.name}, ${f.city}`; results.replaceChildren(); } }, h('span', null, f.name, h('small', null, `${f.city}, ${f.province}`)))));
        } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
      }, 250);
    });
    return h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('b', null, r.payerEmail || '(no email)'), h('span', { class: 'badge new' }, 'Needs review')),
      h('p', { class: 'muted' }, `${dollars(r)} a month · paid ${when(r.createdAt)}`),
      choose,
      r.owners && r.owners.length > 0 && h('p', { class: 'muted' }, 'Approved owners of that firm: ' + r.owners.join(', ')),
      r.slug && note('msg-err', 'The payer\'s email is not an approved owner of this firm, so nothing was changed automatically.'),
      !r.slug && h('div', null, search, results),
      h('div', { class: 'row' }, assign, dismiss), out);
  }

  const row = (r) => h('div', { class: 'audit' },
    h('div', null, h('b', null, r.firmName || '(no firm)'), ' · ', r.payerEmail || '', ' · ', h('span', { class: 'pay-money' }, dollars(r)),
      r.status === 'past_due' && h('span', { class: 'badge new' }, ' Payment problem')),
    h('div', { class: 'muted' }, r.status === 'canceled' ? `Ended ${when(r.updatedAt)}` : `Since ${when(r.createdAt)}${r.periodEnd ? ' · renews ' + when(r.periodEnd) : ''}${r.cancelAtPeriodEnd ? ' · will not renew' : ''}`));

  return h('div', null, h('h1', null, 'Payments'),
    h('div', { class: 'grid' },
      h('div', { class: 'card stat' }, h('b', null, data.totals.activeCount), h('span', null, 'Featured subscriptions')),
      h('div', { class: 'card stat' }, h('b', null, money(data.totals.monthlyCents)), h('span', null, 'Featured, per month'))),
    data.needsReview.length > 0 && h('h2', null, 'Needs your review'),
    data.needsReview.map(reviewCard),
    h('h2', null, 'Active'),
    h('div', { class: 'card' }, data.active.length ? data.active.map(row) : h('p', { class: 'muted' }, 'No paid Featured listings yet. They appear here as soon as a firm pays.')),
    data.ended.length > 0 && h('h2', null, 'Recently ended'),
    data.ended.length > 0 && h('div', { class: 'card' }, data.ended.map(row)));
}

// ---------------------------------------------------------------- news
// LawDB News shows blog cards from firms that have them switched on. Here you choose which firms, and whether the page is
// for every firm with a blog or only for Featured members.
async function viewNews() {
  const data = await api('GET', '/api/admin/news');
  const out = h('div');
  const reload = () => render(me);

  const only = h('input', { type: 'checkbox', checked: data.featuredOnly, id: 'news-only' });
  only.addEventListener('change', async () => {
    try { await api('PATCH', '/api/admin/news', { featuredOnly: only.checked }); out.replaceChildren(note('msg-ok', only.checked ? 'The page now shows Featured members only.' : 'The page now shows every firm with its blog switched on.')); }
    catch (err) { out.replaceChildren(note('msg-err', err.message)); only.checked = !only.checked; }
  });

  const statusText = (f) => {
    if (!f.enabled) return 'Switched off';
    if (f.status === 'ok') return `Working: ${f.posts} post${f.posts === 1 ? '' : 's'}${f.lastCheckedAt ? ', checked ' + when(f.lastCheckedAt) : ''}`;
    if (f.status === 'none') return 'No blog found yet. We keep looking; or paste the blog address in the firm\'s editor.';
    if (f.status === 'error') return 'Problem: ' + (f.lastError || 'could not read it') + (f.posts ? ' (earlier posts kept)' : '');
    return 'Looking for the blog...';
  };

  const row = (f) => {
    const msg = h('span');
    const check = h('button', { type: 'button' }, 'Check now');
    check.addEventListener('click', async () => {
      check.disabled = true; msg.replaceChildren(note('msg-ok', 'Checking...'));
      try { await api('POST', `/api/admin/firms/${encodeURIComponent(f.slug)}/feed/refresh`); reload(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); check.disabled = false; }
    });
    const toggle = h('button', { type: 'button' }, f.enabled ? 'Remove from News' : 'Add to News');
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try { await api('PATCH', `/api/admin/firms/${encodeURIComponent(f.slug)}/feed`, { enabled: !f.enabled }); reload(); } catch (err) { msg.replaceChildren(note('msg-err', err.message)); toggle.disabled = false; }
    });
    return h('div', { class: 'audit' },
      h('div', null, h('b', null, f.name), ' ', f.featured && h('span', { class: 'badge featured' }, 'Featured'), ' ', h('span', { class: 'muted' }, `${f.city}, ${f.province}`)),
      h('div', { class: 'muted' }, statusText(f)),
      h('div', { class: 'row' }, check, toggle, h('a', { href: `/news?firm=${f.slug}`, target: '_blank', rel: 'noopener' }, 'See on News')), msg);
  };

  const search = h('input', { type: 'search', placeholder: 'Add a firm: search by name or city', 'aria-label': 'Search firms to add' });
  const results = h('div');
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) return results.replaceChildren();
      try {
        const { firms } = await api('GET', '/api/admin/firms?limit=8&q=' + encodeURIComponent(q));
        results.replaceChildren(...firms.map((f) => h('button', { class: 'firm-row', type: 'button', onclick: async () => {
          try { await api('PATCH', `/api/admin/firms/${encodeURIComponent(f.slug)}/feed`, { enabled: true }); out.replaceChildren(note('msg-ok', `${f.name} was added. We are looking for its blog now; refresh in a minute.`)); results.replaceChildren(); search.value = ''; }
          catch (err) { out.replaceChildren(note('msg-err', err.message)); }
        } }, h('span', null, f.name, h('small', null, `${f.city}, ${f.province}`)), f.featured && h('span', { class: 'badge featured' }, 'Featured'))));
      } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
    }, 250);
  });

  return h('div', null, h('h1', null, 'News'),
    h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'LawDB News shows blog cards: a headline, a short preview and a link to the full article on the firm\'s own website. Featured firms are added automatically; you can add any other firm too.'),
      h('label', { class: 'check', for: 'news-only' }, only, 'Show Featured members only'),
      h('p', { class: 'muted' }, 'Tick this when you want the page limited to Featured members. Until then it shows every firm below that is switched on.'),
      h('div', { class: 'row' }, h('a', { href: '/news', target: '_blank', rel: 'noopener' }, 'Open LawDB News')), out),
    h('div', { class: 'card' }, search, results),
    h('div', { class: 'card' }, data.firms.length ? data.firms.map(row) : h('p', { class: 'muted' }, 'No firms have blog cards yet.')));
}

// ---------------------------------------------------------------- people
async function viewPeople() {
  const list = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search by email', 'aria-label': 'Search people' });
  let timer;
  async function load() {
    try {
      const { users } = await api('GET', '/api/admin/users?q=' + encodeURIComponent(search.value.trim()));
      list.replaceChildren(...(users.length ? users.map((u) => {
        const out = h('span');
        const btn = h('button', { type: 'button' }, u.disabled ? 'Enable' : 'Disable');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try { await api('PATCH', '/api/admin/users/' + u.id, { disabled: !u.disabled }); load(); }
          catch (err) { out.replaceChildren(note('msg-err', err.message)); btn.disabled = false; }
        });
        return h('div', { class: 'audit' },
          h('div', null, h('b', null, u.email), ' ', u.disabled && h('span', { class: 'badge new' }, 'Disabled')),
          h('div', { class: 'muted' }, `${u.firms} firm${u.firms === 1 ? '' : 's'} managed · joined ${when(u.createdAt)}${u.lastLoginAt ? ' · last sign-in ' + when(u.lastLoginAt) : ''}`),
          h('div', { class: 'row' }, btn, out));
      }) : [h('p', { class: 'muted' }, 'No one matches.')]));
    } catch (err) { list.replaceChildren(note('msg-err', err.message)); }
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  await load();
  return h('div', null, h('h1', null, 'People'),
    h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Firm owners with an account. Disabling someone signs them out everywhere and blocks them from signing in again. Their past edits stay until you undo them in Activity.'), search, list));
}

// ---------------------------------------------------------------- activity
// Restores what an edit replaced. Featured and page style are never undone from here.
function undoButton(e) {
  if (e.action !== 'firm.update' || !e.detail || !Object.keys(e.detail).some((k) => k !== 'featured' && k !== 'pageMode')) return null;
  const out = h('span');
  const btn = h('button', { type: 'button' }, 'Undo this edit');
  btn.addEventListener('click', async () => {
    if (!confirm('Put back the values this edit replaced? Later changes to the same fields will be overwritten.')) return;
    btn.disabled = true;
    try { await api('POST', `/api/admin/audit/${e.id}/revert`); out.replaceChildren(note('msg-ok', 'Undone.')); }
    catch (err) { out.replaceChildren(note('msg-err', err.message)); btn.disabled = false; }
  });
  return h('div', { class: 'row' }, btn, out);
}

async function viewActivity() {
  const { entries } = await api('GET', '/api/admin/audit?limit=100');
  return h('div', null, h('h1', null, 'Activity'), h('div', { class: 'card' },
    entries.length ? entries.map((e) => h('div', { class: 'audit' },
      h('div', null, h('code', null, e.action), ' ', e.entity ? `${e.entity} ${e.entity_id}` : ''),
      h('div', { class: 'muted' }, `${e.actor_email || 'system'} · ${when(e.at)}`),
      e.detail && h('div', { class: 'muted' }, JSON.stringify(e.detail)),
      undoButton(e))) : h('p', { class: 'muted' }, 'Nothing yet.')));
}

// ---------------------------------------------------------------- router
const VIEWS = { overview: viewOverview, approvals: viewApprovals, leads: viewLeads, firms: viewFirms, logos: viewLogos, news: viewNews, traffic: viewTraffic, projects: viewProjects, journal: viewJournal, search: viewSearch, reviews: viewReviews, payments: viewPayments, people: viewPeople, activity: viewActivity };

let me; // the signed-in admin, for re-rendering after an action
async function render(user) {
  me = user;
  const id = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  mount(shell(user, id, h('p', { class: 'muted' }, 'Loading…')));
  try {
    const [view] = await Promise.all([VIEWS[id](), id === 'overview' || id === 'approvals' || id === 'payments' ? null : api('GET', '/api/admin/stats').then((st) => { pendingCount = st.pendingApprovals; paymentCount = st.paymentsToReview; }).catch(() => {})]);
    mount(shell(user, id, view));
  } catch (err) {
    if (err.status === 401) return boot();
    mount(shell(user, id, note('msg-err', err.message)));
  }
}

async function boot() {
  let who;
  try { who = await api('GET', '/api/auth/me'); } catch (err) { return mount(h('div', { class: 'wrap' }, note('msg-err', err.message))); }
  if (!who.user) return renderLogin();
  if (who.user.role !== 'admin') return location.replace('/account/'); // firm owners have their own area
  window.addEventListener('hashchange', () => render(who.user));
  render(who.user);
}

boot();
