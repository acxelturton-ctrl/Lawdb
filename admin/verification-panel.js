// "Verified by LawDB" on the Edit Profile page (see src/lib/verification.js).
//   owner  asks to be verified (the law society, the registered lawyer's name and, if they like, the number), and later sees what was checked;
//   admin  looks the lawyer up in the law society's public directory, ticks what was checked, and marks the firm verified (or removes it).
// The name and number the firm gives are private: the public page shows only the date, what was checked and a link to the directory.
// SECURITY: every value is put in with text nodes or element properties, never innerHTML.
import { h, api, when, note } from './ui.js';

const CHECKS = [
  ['identity', 'The person who manages this profile is who they say they are'],
  ['registration', "The lawyer is listed in the law society's public directory"],
  ['office', 'The office address and phone number match'],
];

export function verificationPanel({ mode, base }) {
  const root = h('section', { class: 'ed-strength ed-verify', id: 'ed-verify', 'aria-label': 'Verified by LawDB' }, h('p', { class: 'muted' }, 'Loading…'));
  const url = `${base}/verification`;
  const out = h('div', { class: 'ed-out' });

  const field = (label, el, hint) => h('div', { class: 'ed-field' }, h('label', null, label), el, hint && h('p', { class: 'ed-hint' }, hint));
  const societySelect = (v) => h('select', { 'aria-label': 'Law society' }, v.societies.map((s) => h('option', { value: s.code, selected: s.code === v.lawSociety.code }, s.name)));
  const checkedList = (v) => h('ul', { class: 'ed-todo' }, CHECKS.filter(([k]) => v.checked && v.checked[k]).map(([, label]) => h('li', null, h('b', null, '✓'), ' ', label)));
  const directory = (v) => h('a', { href: v.lawSociety.directory, target: '_blank', rel: 'noopener nofollow' }, `Open the ${v.lawSociety.name} directory ↗`);

  async function run(fn, btn) {
    btn.disabled = true; out.replaceChildren();
    try { await fn(); await draw(); } catch (err) { out.replaceChildren(note('msg-err', err.message)); btn.disabled = false; }
  }

  // ---- the firm's own view
  function ownerView(v) {
    const head = h('div', { class: 'ed-strength-top' }, h('b', { class: 'ed-vtitle' }, 'Verified by LawDB'),
      v.status === 'verified' && h('span', { class: 'badge featured' }, 'Verified'), v.status === 'requested' && h('span', { class: 'badge new' }, 'Asked, being checked'));
    if (v.status === 'verified') {
      return [head, h('p', { class: 'muted' }, 'Checked on ', when(v.verifiedAt), '. Your page shows a Verified badge, the date, what was checked and a link to the law society’s own directory. It can take a few hours to appear.'), checkedList(v),
        h('p', { class: 'muted ed-strength-note' }, 'It is not an endorsement. It says a check was made on that date, nothing about your work.')];
    }
    const society = societySelect(v);
    const name = h('input', { type: 'text', maxlength: 80, value: v.registrant || '', placeholder: 'For example Pat Smith', autocomplete: 'off', 'aria-label': 'Registered lawyer' });
    const ref = h('input', { type: 'text', maxlength: 30, value: v.registrationRef || '', placeholder: 'Optional', autocomplete: 'off', 'aria-label': 'Law society number' });
    const go = h('button', { class: 'primary', type: 'button' }, v.status === 'requested' ? 'Update my request' : 'Ask LawDB to verify');
    go.addEventListener('click', () => run(() => api('POST', url, { lawSociety: society.value, registrant: name.value, registrationRef: ref.value }), go));
    return [head,
      h('p', { class: 'muted' }, v.status === 'requested'
        ? `You asked on ${when(v.requestedAt)}. We look the lawyer up in the law society’s public directory and email you when it is done.`
        : 'A Verified badge tells visitors we checked that your lawyer is listed with the law society. It is free. Tell us who to look up and we check the public directory.'),
      h('div', { class: 'ed-row' }, field('Law society', society), field('Registered lawyer at your firm', name, 'As the law society lists them.')),
      field('Law society number (optional)', ref, 'It makes the lookup quicker.'),
      h('div', { class: 'row' }, go),
      h('p', { class: 'muted ed-strength-note' }, 'We keep the name and number only to check them. They are never shown on your page.'), out];
  }

  // ---- the admin's view
  function adminView(v) {
    const society = societySelect(v);
    const name = h('input', { type: 'text', maxlength: 80, value: v.registrant || '', placeholder: 'The lawyer you looked up', autocomplete: 'off', 'aria-label': 'Registered lawyer' });
    const ref = h('input', { type: 'text', maxlength: 30, value: v.registrationRef || '', placeholder: 'Optional', autocomplete: 'off', 'aria-label': 'Law society number' });
    const boxes = Object.fromEntries(CHECKS.map(([k]) => [k, h('input', { type: 'checkbox', checked: !!(v.checked && v.checked[k]) })]));
    const noteBox = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Your own note (never shown)', 'aria-label': 'Note' }, v.note || '');
    const verify = h('button', { class: 'primary', type: 'button' }, v.status === 'verified' ? 'Save the checks again' : 'Mark verified');
    verify.addEventListener('click', () => run(() => api('PUT', url, { lawSociety: society.value, registrant: name.value, registrationRef: ref.value, note: noteBox.value,
      checks: Object.fromEntries(Object.entries(boxes).map(([k, el]) => [k, el.checked])) }), verify));
    const remove = h('button', { type: 'button' }, v.status === 'verified' ? 'Remove verification' : 'Decline the request');
    remove.addEventListener('click', () => run(() => api('DELETE', url), remove));
    return [h('div', { class: 'ed-strength-top' }, h('b', { class: 'ed-vtitle' }, 'Verified by LawDB'),
      v.status === 'verified' && h('span', { class: 'badge featured' }, 'Verified'), v.status === 'requested' && h('span', { class: 'badge new' }, 'Requested'), v.status === 'none' && h('span', { class: 'muted' }, 'Not verified')),
      h('p', { class: 'muted' }, v.status === 'requested' ? `The firm asked on ${when(v.requestedAt)}. ` : '', v.status === 'verified' ? `Verified on ${when(v.verifiedAt)}. ` : '',
        'Look the lawyer up in the public directory, tick what you checked, then mark it verified. The page shows the date, what was checked and the link below, never the name or number.'),
      h('p', null, directory(v)),
      h('div', { class: 'ed-row' }, field('Law society', society), field('Registered lawyer', name)),
      field('Law society number', ref),
      h('div', { class: 'ed-field' }, h('label', null, 'What you checked'), ...CHECKS.map(([k, label]) => h('label', { class: 'check' }, boxes[k], label))),
      field('Note', noteBox),
      h('div', { class: 'row' }, verify, v.status !== 'none' && remove), out];
  }

  async function draw() {
    let v;
    try { v = await api('GET', url); } catch (err) { root.replaceChildren(note('msg-err', err.message)); return; }
    root.replaceChildren(...(mode === 'admin' ? adminView(v) : ownerView(v)).filter(Boolean));
  }
  draw();
  return root;
}
