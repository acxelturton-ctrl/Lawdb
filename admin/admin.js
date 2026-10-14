// LawDB admin. No framework, no build step.
// SECURITY: visitor-submitted text (leads) is only ever inserted with textContent / text nodes,
// never innerHTML, so hostile messages cannot run code in an admin's browser.

const app = document.getElementById('app');

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const when = (utc) => new Date(utc.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const mount = (...nodes) => app.replaceChildren(...nodes);
const note = (cls, text) => h('p', { class: cls, role: cls === 'msg-err' ? 'alert' : 'status' }, text);

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
const TABS = [['overview', 'Overview'], ['leads', 'Leads'], ['firms', 'Firms'], ['activity', 'Activity']];

function shell(user, active, content) {
  return h('div', null,
    h('header', { class: 'top' }, h('div', { class: 'wrap' },
      h('a', { class: 'brand', href: '/admin/' }, h('img', { src: '/images/logo-icon.png', alt: '' }), 'LawDB Admin'),
      h('div', { class: 'who' }, user.email, h('br'),
        h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout').catch(() => {}); location.reload(); } }, 'Sign out')))),
    h('div', { class: 'wrap' },
      h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS.map(([id, label]) => h('a', { href: `#${id}`, 'aria-current': id === active ? 'page' : false }, label))),
      content));
}

// ---------------------------------------------------------------- overview
async function viewOverview() {
  const s = await api('GET', '/api/admin/stats');
  const stat = (n, label) => h('div', { class: 'card stat' }, h('b', null, n), h('span', null, label));
  return h('div', null, h('h1', null, 'Overview'),
    h('div', { class: 'grid' },
      stat(s.leads.new, 'New leads'), stat(s.leadsLast7Days, 'Leads, last 7 days'),
      stat(s.firms, 'Firms listed'), stat(s.featured, 'Featured firms'), stat(s.blogPosts, 'Blog posts')),
    h('div', { class: 'card' }, h('b', null, 'Leads by status'),
      h('p', { class: 'muted' }, `New ${s.leads.new} · Contacted ${s.leads.contacted} · Closed ${s.leads.closed} · Spam ${s.leads.spam}`)));
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
async function viewFirms() {
  const results = h('div');
  const editor = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search firms by name or city', 'aria-label': 'Search firms' });
  let timer;

  async function find() {
    try {
      const { firms } = await api('GET', '/api/admin/firms?limit=25&q=' + encodeURIComponent(search.value.trim()));
      results.replaceChildren(...(firms.length ? firms.map((f) => h('button', { class: 'firm-row', type: 'button', onclick: () => edit(f.slug) },
        h('span', null, f.name, h('small', null, `${f.city}, ${f.province}`)), f.featured && h('span', { class: 'badge featured' }, 'Featured'))) : [h('p', { class: 'muted' }, 'No firms match.')]));
    } catch (err) { results.replaceChildren(note('msg-err', err.message)); }
  }

  async function edit(slug) {
    const { firm } = await api('GET', '/api/admin/firms/' + encodeURIComponent(slug));
    const out = h('div');
    const f = {
      name: h('input', { type: 'text', value: firm.name, maxlength: 200 }),
      blurb: h('textarea', { maxlength: 500 }, firm.blurb || ''),
      phone: h('input', { type: 'text', value: firm.phone || '', maxlength: 30 }),
      website: h('input', { type: 'text', value: firm.website || '', maxlength: 300 }),
      address: h('input', { type: 'text', value: firm.address || '', maxlength: 300 }),
      tags: h('input', { type: 'text', value: (firm.tags || []).join(', ') }),
      featured: h('input', { type: 'checkbox', checked: !!firm.featured }),
    };
    const field = (label, el) => [h('label', null, label), el];
    const save = h('button', { class: 'primary', type: 'submit' }, 'Save changes');
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        const res = await api('PATCH', '/api/admin/firms/' + encodeURIComponent(slug), {
          name: f.name.value, blurb: f.blurb.value, phone: f.phone.value, website: f.website.value, address: f.address.value,
          tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean), featured: f.featured.checked,
        });
        out.replaceChildren(note('msg-ok', res.changed.length ? `Saved: ${res.changed.join(', ')}.` : 'No changes to save.'));
        find();
      } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
      save.disabled = false;
    } },
      h('div', { class: 'row spread' }, h('h2', null, firm.name), h('a', { href: `/firms/${slug}.html`, target: '_blank', rel: 'noopener' }, 'View public page')),
      field('Name', f.name), field('Description', f.blurb), field('Phone', f.phone), field('Website', f.website),
      field('Address', f.address), field('Tags (comma separated)', f.tags),
      h('label', { class: 'check' }, f.featured, 'Featured firm'),
      h('p', { class: 'muted' }, 'Saved right away and live on the directory pages within about a minute. Rating, reviews and map position come from Google and are not editable here.'),
      h('div', { class: 'row' }, save, h('button', { type: 'button', onclick: () => editor.replaceChildren() }, 'Close')), out);
    editor.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(find, 250); });
  await find();
  return h('div', null, h('h1', null, 'Firms'), search, h('div', { class: 'card' }, h('p', { class: 'muted' },
    'Edits are saved to the database and appear on the Find Lawyers page, the city and province directory pages, search suggestions and the map within about a minute. Individual firm profile pages are pre-built and do not change yet.')),
    editor, results);
}

// ---------------------------------------------------------------- activity
async function viewActivity() {
  const { entries } = await api('GET', '/api/admin/audit?limit=100');
  return h('div', null, h('h1', null, 'Activity'), h('div', { class: 'card' },
    entries.length ? entries.map((e) => h('div', { class: 'audit' },
      h('div', null, h('code', null, e.action), ' ', e.entity ? `${e.entity} ${e.entity_id}` : ''),
      h('div', { class: 'muted' }, `${e.actor_email || 'system'} · ${when(e.at)}`),
      e.detail && h('div', { class: 'muted' }, JSON.stringify(e.detail)))) : h('p', { class: 'muted' }, 'Nothing yet.')));
}

// ---------------------------------------------------------------- router
const VIEWS = { overview: viewOverview, leads: viewLeads, firms: viewFirms, activity: viewActivity };

async function render(user) {
  const id = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  mount(shell(user, id, h('p', { class: 'muted' }, 'Loading…')));
  try {
    mount(shell(user, id, await VIEWS[id]()));
  } catch (err) {
    if (err.status === 401) return boot();
    mount(shell(user, id, note('msg-err', err.message)));
  }
}

async function boot() {
  let me;
  try { me = await api('GET', '/api/auth/me'); } catch (err) { return mount(h('div', { class: 'wrap' }, note('msg-err', err.message))); }
  if (!me.user) return renderLogin();
  if (me.user.role !== 'admin') return mount(h('div', { class: 'wrap' }, h('div', { class: 'center card' }, h('h1', null, 'No access'), h('p', null, 'This area is for LawDB administrators.'))));
  window.addEventListener('hashchange', () => render(me.user));
  render(me.user);
}

boot();
