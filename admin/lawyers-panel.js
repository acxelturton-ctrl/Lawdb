// "Lawyers" on the Edit Profile page (see src/lib/lawyer-edit.js). The firm confirms what we read from its website, corrects it, hides a lawyer (or the whole
// Lawyers page), adds a lawyer we did not find, removes one, and adds a picture. Used by an owner (their own firm) and by the admin (any firm).
// Every change is saved straight away; the server sends back the whole list each time, and the panel draws what it gets.
// SECURITY: every value is put in with text nodes or element properties, never innerHTML.
import { h, api, note, lockIcon } from './ui.js';

const initials = (name) => { const w = String(name).split(/\s+/).filter((x) => /^\p{Lu}/u.test(x)); return ((w[0] || '')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
const MAX_PHOTO = 3 * 1024 * 1024;

export function lawyersPanel({ base, mode, featured }) {
  const url = `${base}/lawyers`;
  const slug = base.split('/').pop();
  const photoLocked = mode === 'owner' && !featured; // adding a picture is a Featured benefit (an admin is never limited)
  const paidLocked = photoLocked; // so are the awards and the direct phone number
  const root = h('div', { class: 'card lwp' }, h('p', { class: 'muted' }, 'Loading…'));
  const out = h('div', { class: 'lwp-out' });
  let state = null;
  let open = null; // the address of the lawyer being edited, or 'new'

  const say = (cls, text) => out.replaceChildren(note(cls, text));
  async function call(method, path, body, okText) {
    try { state = await api(method, path, body); if (okText) say('msg-ok', okText); draw(); return true; }
    catch (err) { say('msg-err', err.message); return false; }
  }
  async function sendPhoto(method, path, file) {
    const res = await fetch(path, { method, headers: file ? { 'content-type': file.type || 'application/octet-stream' } : {}, body: file, credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  async function photoCall(method, path, file, okText) {
    try { state = await sendPhoto(method, path, file); say('msg-ok', okText); draw(); } catch (err) { say('msg-err', err.message); }
  }

  const avatar = (l, big) => h('span', { class: 'lwp-av' + (big ? ' lwp-av-lg' : '') },
    l.photo.state === 'none' ? initials(l.name) : h('img', { src: l.photo.url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));

  // ---- one lawyer: the facts in a form
  function form(l) {
    const isNew = !l;
    const v = l || { name: '', title: '', callYear: null, education: [], languages: [], linkedin: '', site: '', achievements: [], phone: '', photo: { state: 'none' } };
    const name = h('input', { type: 'text', maxlength: 90, value: v.name, placeholder: 'Pat Q. Smith', autocomplete: 'off', 'aria-label': 'Name' });
    const title = h('input', { type: 'text', maxlength: 70, value: v.title, placeholder: 'Partner', autocomplete: 'off', 'aria-label': 'Title' });
    const year = h('input', { type: 'number', min: 1950, max: new Date().getFullYear(), value: v.callYear ?? '', placeholder: '2012', 'aria-label': 'Year called to the bar' });
    const edu = [0, 1, 2].map((i) => h('input', { type: 'text', maxlength: 120, value: v.education[i] || '', placeholder: i ? '' : 'J.D., University of Calgary', autocomplete: 'off', 'aria-label': `Education ${i + 1}` }));
    const picked = new Set(v.languages);
    const langs = h('div', { class: 'lwp-langs' }, state.languages.map((lang) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: picked.has(lang), onchange: (e) => { if (e.target.checked) picked.add(lang); else picked.delete(lang); } }), lang)));
    const li = h('input', { type: 'text', inputmode: 'url', maxlength: 300, value: v.linkedin, placeholder: 'https://www.linkedin.com/in/pat-smith', autocomplete: 'off', 'aria-label': 'LinkedIn profile' });
    const site = h('input', { type: 'text', inputmode: 'url', maxlength: 300, value: v.site, placeholder: 'https://yourfirm.ca/team/pat-smith', autocomplete: 'off', 'aria-label': 'Page on your website' });
    const awards = [0, 1, 2].map((i) => h('input', { type: 'text', maxlength: 140, value: (v.achievements || [])[i] || '', placeholder: i ? '' : 'Lexpert Rising Star, 2023', autocomplete: 'off', disabled: paidLocked, 'aria-label': `Award or achievement ${i + 1}` }));
    const phone = h('input', { type: 'tel', maxlength: 30, value: v.phone || '', placeholder: '(403) 555-0100', autocomplete: 'off', disabled: paidLocked, 'aria-label': 'Direct phone number' });
    const err = h('div', { role: 'alert' });
    const f = (label, el, hint) => h('div', { class: 'ed-field' }, h('label', null, label), el, hint && h('p', { class: 'ed-hint' }, hint));
    const save = h('button', { class: 'primary', type: 'button' }, isNew ? 'Add lawyer' : 'Save');
    save.addEventListener('click', async () => {
      const body = { name: name.value, title: title.value, callYear: year.value === '' ? null : Number(year.value), education: edu.map((e) => e.value).filter((e) => e.trim()), languages: [...picked], linkedin: li.value, site: site.value };
      if (!paidLocked) { body.achievements = awards.map((a) => a.value).filter((a) => a.trim()); body.phone = phone.value; }
      if (!isNew) body.confirmed = true; // saving the form is the firm saying these details are right, even when nothing was changed
      save.disabled = true;
      try {
        state = await api(isNew ? 'POST' : 'PATCH', isNew ? url : `${url}/${l.slug}`, body);
        open = null; say('msg-ok', isNew ? 'Added.' : 'Saved. It appears on your page within about a minute.'); draw();
      } catch (e) { err.replaceChildren(note('msg-err', e.message)); save.disabled = false; }
    });
    const cancel = h('button', { type: 'button', onclick: () => { open = null; draw(); } }, 'Cancel');
    return h('div', { class: 'lwp-form' },
      h('div', { class: 'ed-row' }, f('Name', name, "As the law society lists them."), f('Title', title, 'For example Partner, Associate or Senior Counsel.')),
      h('div', { class: 'ed-row' }, f('Year called to the bar', year, 'Shown on the page as years in practice.'), f('LinkedIn', li, "The lawyer's own profile (optional).")),
      f('Page on your website', site, `The lawyer's page on your own website (optional).`),
      h('div', { class: 'ed-field' }, h('label', null, 'Education'), ...edu, h('p', { class: 'ed-hint' }, 'One line each, for example J.D., University of Calgary.')),
      h('div', { class: 'ed-field' }, h('label', null, 'Languages'), langs),
      h('div', { class: 'ed-field' }, h('label', null, 'Awards and achievements', paidLocked && h('span', { class: 'ed-pill' }, lockIcon(), 'Featured')), ...awards, paidLocked ? h('p', { class: 'ed-lock' }, lockIcon(), 'Listing awards and achievements is a Featured benefit. Upgrade to Featured from your dashboard.') : h('p', { class: 'ed-hint' }, 'One line each, up to three, for example Lexpert Rising Star, 2023. Facts only: no ratings, rankings or claims.')),
      h('div', { class: 'ed-field' }, h('label', null, 'Direct phone number', paidLocked && h('span', { class: 'ed-pill' }, lockIcon(), 'Featured')), phone, paidLocked ? h('p', { class: 'ed-lock' }, lockIcon(), "Adding a lawyer's direct number is a Featured benefit. Upgrade to Featured from your dashboard.") : h('p', { class: 'ed-hint' }, "Shown on the lawyer's card and page as a Call button.")),
      err,
      !isNew && photoBlock(l),
      h('div', { class: 'row' }, save, cancel, isNew ? null : h('span', { class: 'muted' }, 'Saving also confirms these details.')));
  }

  // ---- the picture: found on the firm's website (shown only when the firm says so), or uploaded
  function photoBlock(l) {
    const p = l.photo;
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose a picture', disabled: photoLocked });
    const upload = h('button', { type: 'button', disabled: photoLocked }, photoLocked ? [lockIcon(), ' Upload'] : p.state === 'confirmed' ? 'Replace' : 'Upload');
    upload.addEventListener('click', () => {
      const f = file.files[0];
      if (!f) return say('msg-err', 'Choose a picture first.');
      if (f.size > MAX_PHOTO) return say('msg-err', 'That picture is over 3 MB. Please choose a smaller one.');
      say('msg-ok', 'Uploading…');
      photoCall('POST', `${url}/${l.slug}/picture`, f, 'Saved. The picture appears on your Lawyers page within about a minute.');
    });
    const use = p.state === 'found' && h('button', { class: 'primary', type: 'button', disabled: photoLocked, onclick: () => { say('msg-ok', 'Copying the picture…'); photoCall('POST', `${url}/${l.slug}/picture?from=found`, null, 'Saved. The picture appears on your Lawyers page within about a minute.'); } }, photoLocked ? [lockIcon(), ' Use this picture'] : 'Use this picture');
    const drop = p.state !== 'none' && h('button', { type: 'button', onclick: () => photoCall('DELETE', `${url}/${l.slug}/picture`, null, p.state === 'confirmed' ? 'Picture removed.' : 'Done. We will not use that picture.') }, p.state === 'confirmed' ? 'Remove picture' : 'Not this one');
    return h('div', { class: 'ed-field lwp-photo' },
      h('label', null, 'Picture', photoLocked && h('span', { class: 'ed-pill' }, lockIcon(), 'Featured')),
      h('div', { class: 'lwp-photo-row' }, avatar(l, true), h('div', null,
        p.state === 'found' && h('p', { class: 'muted' }, 'We found this picture on your website. It is not shown on your page until you confirm it.'),
        p.state === 'confirmed' && h('p', { class: 'muted' }, 'This picture is shown on your Lawyers page.'),
        p.state === 'none' && h('p', { class: 'muted' }, 'No picture yet. A head-and-shoulders photo of the lawyer, JPEG, PNG or WebP, up to 3 MB.'),
        h('div', { class: 'row' }, use, drop))),
      h('div', { class: 'row' }, file, upload),
      photoLocked ? h('p', { class: 'ed-lock' }, lockIcon(), 'Adding lawyer pictures is a Featured benefit. Upgrade to Featured from your dashboard.') : h('p', { class: 'ed-hint' }, 'Only use a picture you own or have permission to use.'));
  }

  function row(l) {
    const status = [
      l.confirmed && h('span', { class: 'badge featured' }, 'Confirmed'),
      !l.confirmed && !l.hidden && h('span', { class: 'badge new' }, 'From your website'),
      l.hidden && h('span', { class: 'badge' }, 'Hidden'),
      l.featured && h('span', { class: 'badge featured' }, l.hasPage ? 'Featured lawyer' : 'Featured lawyer (needs a Featured firm)'),
      l.hasPage && h('a', { class: 'lwp-own', href: `/firms/${slug}/lawyers/${l.slug}`, target: '_blank', rel: 'noopener' }, 'Own page ↗'),
    ];
    const meta = [l.title, l.callYear ? `Called ${l.callYear}` : '', l.languages.join(', ')].filter(Boolean).join(' · '); // the editor says what was entered; pages say years in practice
    const act = (label, fn, cls) => h('button', { type: 'button', class: cls || null, onclick: fn }, label);
    return h('li', { class: 'lwp-row' + (l.hidden ? ' is-hidden' : '') },
      h('div', { class: 'lwp-main' }, avatar(l), h('div', { class: 'lwp-info' }, h('b', null, l.name), meta && h('span', { class: 'muted' }, meta), h('span', { class: 'lwp-badges' }, status)),
        h('div', { class: 'lwp-actions' },
          !l.confirmed && !l.hidden && act('Looks right', () => call('PATCH', `${url}/${l.slug}`, { confirmed: true }, `${l.name} is confirmed.`), 'primary'),
          act(open === l.slug ? 'Close' : 'Edit', () => { open = open === l.slug ? null : l.slug; draw(); }),
          mode === 'admin' && act(l.featured ? 'End Featured listing' : 'Make Featured lawyer', () => call('PATCH', `${url}/${l.slug}`, { featured: !l.featured }, l.featured ? `${l.name}'s Featured lawyer listing is off.` : `${l.name} is a Featured lawyer.`)),
          act(l.hidden ? 'Show' : 'Hide', () => call('PATCH', `${url}/${l.slug}`, { hidden: !l.hidden }, l.hidden ? `${l.name} is shown again.` : `${l.name} is hidden from your profile.`)),
          act('Remove', () => { if (confirm(`Remove ${l.name} from your profile?`)) call('DELETE', `${url}/${l.slug}`, null, `${l.name} was removed.`); }))),
      open === l.slug && form(l));
  }

  function draw() {
    const s = state;
    const add = h('button', { type: 'button', onclick: () => { open = open === 'new' ? null : 'new'; draw(); }, disabled: s.lawyers.length >= s.limits.max }, open === 'new' ? 'Close' : 'Add a lawyer');
    const toggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !s.lawyersOff, onchange: (e) => call('PATCH', url, { lawyersOff: !e.target.checked }, e.target.checked ? 'The Lawyers page is on.' : 'The Lawyers page is off.') }), 'Show the Lawyers page on my profile');
    root.replaceChildren(...[
      h('h2', null, 'Lawyers'),
      h('p', { class: 'muted' }, s.lawyers.length
        ? 'We read these lawyers from your website. Check each one: Looks right confirms it, Edit corrects it, Hide takes it off your profile. What you confirm is shown as you wrote it, and we will not change it again.'
        : 'We did not find lawyers on your website. You can add them here; the Lawyers page appears once two or more are shown.'),
      toggle,
      h('p', { class: 'muted' }, s.pageExists
        ? ['Your Lawyers page is live with ', String(s.shown), ' lawyers: ', h('a', { href: `/firms/${slug}/lawyers`, target: '_blank', rel: 'noopener' }, `/firms/${slug}/lawyers ↗`)]
        : s.lawyersOff ? 'The Lawyers page is off.' : `The Lawyers page appears when ${s.limits.minForPage} or more lawyers are shown (now ${s.shown}).`),
      s.lawyers.length ? h('ul', { class: 'lwp-list' }, s.lawyers.map(row)) : null,
      h('div', { class: 'row' }, add),
      open === 'new' && form(null),
      h('p', { class: 'muted ed-strength-note' }, 'On your profile every lawyer shows their name, role and years in practice. A page of their own, education, languages, a picture, awards, a direct phone number and a pin on the map belong to a Featured lawyer listing, which a lawyer at a Featured firm can add. What you enter here is kept for when they do. None of this is checked with the law society.'),
      !s.firmFeatured && mode === 'owner' && h('p', { class: 'ed-lock' }, lockIcon(), 'Your firm is not Featured yet. Featured lawyer listings are available once it is.'),
      out].filter(Boolean));
  }

  (async () => {
    try { state = await api('GET', url); draw(); } catch (err) { root.replaceChildren(note('msg-err', err.message)); }
  })();
  return root;
}
