// Small UI helpers shared by the admin area and the owner dashboard. No framework, no build step.
// SECURITY: text from visitors is only ever inserted with text nodes (never innerHTML).

export function h(tag, props, ...kids) {
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

export async function api(method, path, body) {
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

export const when = (utc) => new Date(utc.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export const note = (cls, text) => h('p', { class: cls, role: cls === 'msg-err' ? 'alert' : 'status' }, text);

export const CASE_LABELS = {
  traffic: 'Traffic Ticket', criminal: 'Criminal Charges', family: 'Family Law / Divorce', injury: 'Personal Injury / Accident',
  realestate: 'Buying or Selling a Home', wills: 'Wills, Estates & Power of Attorney', business: 'Business / Corporate',
  employment: 'Employment Dispute', immigration: 'Immigration', litigation: 'Civil Lawsuit / Litigation',
};
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const PROVINCES = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' };

// Opening hours editor. Days that already have split hours (two ranges) are kept as they are.
export function hoursEditor(hours) {
  let dirty = false;
  const rows = DAY_NAMES.map((name, i) => {
    const ivs = (hours && hours[String(i + 1)]) || [];
    const multi = ivs.length > 1;
    const open = h('input', { type: 'checkbox', checked: ivs.length > 0, 'aria-label': `${name} open`, disabled: multi });
    const from = h('input', { type: 'time', value: ivs[0] ? ivs[0][0] : '09:00', 'aria-label': `${name} opens` });
    const to = h('input', { type: 'time', value: ivs[0] ? ivs[0][1] : '17:00', 'aria-label': `${name} closes` });
    const mark = () => { dirty = true; };
    [open, from, to].forEach((el) => el.addEventListener('change', mark));
    return { name, ivs, multi, open, from, to, el: h('div', { class: 'hrow' }, h('span', null, name), open, multi ? h('span', { class: 'muted hwide' }, 'Split hours kept as they are') : [from, to]) };
  });
  return {
    el: h('div', { class: 'hours-edit' }, rows.map((r) => r.el)),
    isDirty: () => dirty,
    anyOpen: () => rows.some((r) => r.multi || r.open.checked),
    get() {
      const out = {};
      rows.forEach((r, i) => {
        if (r.multi) out[String(i + 1)] = r.ivs;
        else if (r.open.checked) out[String(i + 1)] = [[r.from.value, r.to.value]];
      });
      return out;
    },
  };
}

export function categoryChecks(selected) {
  const boxes = Object.entries(CASE_LABELS).map(([id, label]) => {
    const input = h('input', { type: 'checkbox', value: id, checked: (selected || []).includes(id) });
    return { id, input, el: h('label', { class: 'check small' }, input, label) };
  });
  return { el: h('div', { class: 'checks' }, boxes.map((b) => b.el)), get: () => boxes.filter((b) => b.input.checked).map((b) => b.id) };
}

export const splitTags = (v) => v.split(',').map((t) => t.trim()).filter(Boolean);
export const field = (label, el, hint) => [h('label', null, label), el, hint && h('p', { class: 'muted' }, hint)];


// ---------------------------------------------------------------- pictures
// Logo, cover and photos for one firm. `base` is the images endpoint (owner or admin). Each upload or removal
// is saved straight away; it does not wait for the profile form's Save button.
export function picturesPanel(base) {
  const root = h('div', { class: 'card pics' });
  const out = h('div');
  const MAX = 3 * 1024 * 1024;

  async function send(method, url, file) {
    const res = await fetch(url, {
      method,
      headers: file ? { 'content-type': file.type || 'application/octet-stream' } : {},
      body: file,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  async function upload(kind, file, alt) {
    if (!file) return;
    if (file.size > MAX) return out.replaceChildren(note('msg-err', 'That picture is over 3 MB. Please choose a smaller one.'));
    out.replaceChildren(note('msg-ok', 'Uploading…'));
    try {
      await send('POST', `${base}?kind=${kind}${alt ? '&alt=' + encodeURIComponent(alt) : ''}`, file);
      out.replaceChildren(note('msg-ok', 'Saved. It appears on the site within about a minute.'));
      await load();
    } catch (err) { out.replaceChildren(note('msg-err', err.message)); }
  }

  async function remove(img) {
    if (!confirm('Remove this picture?')) return;
    try { await send('DELETE', `${base}/${img.id}`); out.replaceChildren(note('msg-ok', 'Removed.')); await load(); }
    catch (err) { out.replaceChildren(note('msg-err', err.message)); }
  }

  function section(title, kind, imgs, hint, multi) {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': `Choose ${title.toLowerCase()}` });
    const alt = multi ? h('input', { type: 'text', maxlength: 120, placeholder: 'Short description (optional)', 'aria-label': 'Picture description' }) : null;
    const go = h('button', { type: 'button' }, imgs.length && !multi ? 'Replace' : 'Upload');
    go.addEventListener('click', () => upload(kind, input.files[0], alt ? alt.value.trim() : ''));
    return h('div', { class: 'pics-sec' },
      h('b', null, title), h('p', { class: 'muted' }, hint),
      h('div', { class: 'thumbs' }, imgs.map((img) => h('figure', null,
        h('img', { src: img.url, alt: img.alt || title, loading: 'lazy' }),
        h('button', { type: 'button', onclick: () => remove(img) }, 'Remove')))),
      h('div', { class: 'row' }, input, alt, go));
  }

  function draw(images) {
    const by = (k) => images.filter((i) => i.kind === k);
    root.replaceChildren(
      h('h2', null, 'Pictures'),
      h('p', { class: 'muted' }, 'JPEG, PNG or WebP, up to 3 MB each. Only upload pictures you own or have permission to use, and do not show clients without their consent.'),
      section('Logo', 'logo', by('logo'), 'Shown on your listing and page. A square picture works best.', false),
      section('Cover picture', 'cover', by('cover'), 'The wide picture at the top of your page.', false),
      section('Photos', 'photo', by('photo'), 'Up to 6 photos, shown on your page.', true),
      out);
  }

  async function load() {
    try { draw((await api('GET', base)).images); }
    catch (err) { root.replaceChildren(note('msg-err', err.message)); }
  }
  load();
  return root;
}

// ---------------------------------------------------------------- blog cards
// "Latest from the firm's blog": cards built from the firm's public blog feed. `base` is the feed endpoint
// (owner or admin). Changes are saved straight away.
export function feedPanel(base) {
  const root = h('div', { class: 'card feedp' });
  const out = h('div');

  async function call(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  const act = async (fn, okText) => {
    try { const d = await fn(); out.replaceChildren(note('msg-ok', okText(d))); draw(d); }
    catch (err) { out.replaceChildren(note('msg-err', err.message)); }
  };

  function statusLine(feed, posts) {
    if (!feed) return 'Not set up yet. Switch it on and we will look for the firm\'s blog feed.';
    if (!feed.enabled) return 'Switched off. Nothing is shown on the page.';
    if (feed.status === 'ok') return `Working. ${posts.length} recent post${posts.length === 1 ? '' : 's'} found${feed.lastCheckedAt ? ', last checked ' + when(feed.lastCheckedAt) : ''}.`;
    if (feed.status === 'none') return 'We could not find a blog feed on the website yet. If the firm has a blog, enter its feed address below. We try again every week.';
    if (feed.status === 'error') return 'The last check failed: ' + (feed.lastError || 'unknown problem') + ' We keep the earlier posts and try again tonight.';
    return 'Looking for the blog feed. Check back in a minute.';
  }

  function draw({ feed, posts }) {
    const enabled = h('input', { type: 'checkbox', checked: !!(feed && feed.enabled), id: 'feed-on' });
    enabled.addEventListener('change', () => act(() => call('PATCH', base, { enabled: enabled.checked }), () => (enabled.checked ? 'Switched on.' : 'Switched off.')));
    const address = h('input', { type: 'text', placeholder: 'Found automatically. Or paste the feed address, e.g. https://yourfirm.ca/feed', value: feed && feed.source === 'manual' ? feed.feedUrl || '' : '', 'aria-label': 'Blog feed address' });
    const save = h('button', { type: 'button' }, 'Save address');
    save.addEventListener('click', () => act(() => call('PATCH', base, { feedUrl: address.value }), () => 'Saved. Checking the feed now.'));
    const check = h('button', { type: 'button' }, 'Check now');
    check.addEventListener('click', () => act(() => call('POST', base + '/refresh'), (d) => (d.result && d.result.status === 'error' ? 'Checked, but there was a problem.' : 'Checked.')));
    root.replaceChildren(h('div', null,
      h('h2', null, 'Blog cards'),
      h('p', { class: 'muted' }, 'Shows the firm\'s latest blog posts on its page as small cards: a headline, a short excerpt, and a link to read the full article on the firm\'s own website. Only the headline and a short excerpt from the public feed are used.'),
      h('label', { class: 'check', for: 'feed-on' }, enabled, 'Show blog cards on the firm\'s page'),
      note('muted', statusLine(feed, posts)),
      posts.length > 0 && h('ul', { class: 'feed-posts' }, posts.slice(0, 3).map((p) => h('li', null, p.title))),
      field('Feed address (optional)', address),
      h('div', { class: 'row' }, save, check),
      out));
  }

  call('GET', base).then(draw).catch((err) => root.replaceChildren(note('msg-err', err.message)));
  return root;
}

// ---------------------------------------------------------------- plan and billing (owner)
// Shows Basic or Featured, and the right button: upgrade (opens the Stripe checkout with the firm and email attached)
// or manage billing (Stripe's own page, where the card can be changed or the subscription cancelled).
export function planPanel(base) {
  const root = h('div', { class: 'card planp' });
  const fmt = (d) => (d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString([], { dateStyle: 'long' }) : '');

  function draw(p) {
    const featured = p.featured;
    const sub = p.subscription;
    let line;
    if (featured && sub) {
      line = sub.status === 'past_due' ? 'Featured. The last payment did not go through. Please update your card on the billing page.'
        : sub.cancelAtPeriodEnd ? `Featured until ${fmt(sub.periodEnd)}. It will not renew.`
        : `Featured${sub.periodEnd ? '. Renews on ' + fmt(sub.periodEnd) : ''}.`;
    } else if (featured) line = 'Featured. Managed by LawDB.';
    else line = 'Basic (free).';
    root.replaceChildren(h('div', null,
      h('div', { class: 'row spread' }, h('h2', null, 'Your plan'), h('span', { class: 'badge' + (featured ? ' featured' : '') }, featured ? 'Featured' : 'Basic')),
      h('p', null, line),
      !featured && h('div', null,
        h('p', { class: 'muted' }, `Featured is ${p.price}. You get priority placement at the top of results, a highlighted marker, and your latest blog posts shown on your page.`),
        p.upgradeUrl ? h('a', { href: p.upgradeUrl, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, 'Upgrade to Featured')) : h('p', { class: 'muted' }, 'Upgrading is not available right now.'),
        p.upgradeUrl && h('p', { class: 'muted' }, 'Checkout opens on Stripe. Your listing becomes Featured automatically once the payment goes through. Please pay with the same email address you sign in with, so the payment can be matched to your firm.')),
      p.portalUrl && h('div', { class: 'row' }, h('a', { href: p.portalUrl, target: '_blank', rel: 'noopener' }, h('button', { type: 'button' }, 'Manage billing')))));
  }

  fetch(base, { credentials: 'same-origin' }).then((r) => r.json().then((d) => (r.ok ? draw(d) : Promise.reject(new Error(d.error || 'Could not load your plan'))))).catch((err) => root.replaceChildren(note('msg-err', err.message)));
  return root;
}
