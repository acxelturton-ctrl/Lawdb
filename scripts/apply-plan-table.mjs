// The "Free or Featured" comparison on For Law Firms and List Your Firm: one table, every feature a row, Basic and Featured the columns. It is the same table on both
// pages (only the two buttons differ), so it is written here once and put into each page between the plan-table:start / plan-table:end markers:
//   node scripts/apply-plan-table.mjs          (rewrite both pages)
//   node scripts/apply-plan-table.mjs --check  (fail if a page's table is not this one)
// Style: plan-compare.css (linked from both pages). When Featured gains a feature, add a row here, run this, and update the other places listed in
// docs/ARCHITECTURE.md ("Where Featured is described to firms").
import { readFileSync, writeFileSync } from 'node:fs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// kinds: 'yes' (included), 'lock' (not on Basic), or a text. A text is { t, b } with b = bold part.
const YES = 'yes', LOCK = 'lock';
export const GROUPS = [
  ['Your page', [
    ['Name, address, phone, website, hours and practice areas', 'You keep them up to date yourself, any time', YES, YES],
    ['Your own description and tagline', '', LOCK, YES],
    ['Your logo, cover picture and photos', '', LOCK, YES],
    ['Book a call button with your own booking link', 'Clients book you straight from your page', LOCK, YES],
    ['Your latest blog posts as cards on your page', 'Linking to your own site', YES, YES],
  ]],
  ['Getting found', [
    ['Listed by case type and city', '', YES, YES],
    ['Position in search results', '', 'Sorted by rating', { b: 'Above Basic firms', t: ', with a Featured Partner card' }],
    ['Live search box', '', 'After Featured firms', { b: 'First', t: ', with a gold badge' }],
    ['Pin on the map', '', 'Standard pin', { b: 'Gold highlighted pin', t: '' }],
    ['Gold tick and Featured badge', 'On your profile and wherever your firm appears', LOCK, YES],
    ['First among nearby firms', 'On other firms\' profiles and story pages', LOCK, YES],
    ['Your articles on LawDB News', '', 'Shown as cards', { b: 'Featured badge', t: ', story pages search engines can find, higher placement' }],
  ]],
  ['Enquiries', [
    ['Every enquiry emailed to you', '', YES, YES],
    ['Enquiries dashboard', 'Filters, private notes, one-tap reply, spreadsheet export', LOCK, YES],
    ['Enquiries also sent to a second email address', 'For example your intake desk', LOCK, YES],
  ]],
  ['Analytics', [
    ['Your page views, visitors, clicks and enquiries for the last 30 days', 'As totals, with a weekly email', YES, YES],
    ['Full analytics dashboard', 'Every button clicked, where visitors came from, phone or computer, provinces, busiest days, compared with the period before', LOCK, YES],
    ['Spreadsheet export of your numbers', '', LOCK, YES],
  ]],
  ['Community', [
    ['Followers and member ratings', 'You see how many, never who', YES, YES],
  ]],
];

const SPRITE = '<svg class="pc-sprite" width="0" height="0" aria-hidden="true" focusable="false"><symbol id="pc-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol><symbol id="pc-lock" viewBox="0 0 24 24"><path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>';

const cell = (v, cls) => {
  if (v === YES) return `<td class="${cls}"><svg class="pc-i pc-ok" aria-hidden="true"><use href="#pc-check"/></svg><span class="sr">Included</span></td>`;
  if (v === LOCK) return `<td class="${cls}"><svg class="pc-i pc-lock" aria-hidden="true"><use href="#pc-lock"/></svg><span class="sr">Not included on Basic</span></td>`;
  if (typeof v === 'string') return `<td class="${cls}"><span class="pc-t">${esc(v)}</span></td>`;
  return `<td class="${cls}"><svg class="pc-i pc-ok" aria-hidden="true"><use href="#pc-check"/></svg><span class="pc-t"><b>${esc(v.b)}</b>${esc(v.t)}</span></td>`;
};

export function table({ basicHref, basicLabel, basicShort, featHref, featLabel, featShort }) {
  const head = `<thead><tr>
        <th class="pc-lab pc-corner" scope="col">What you get</th>
        <th class="pc-h pc-b" scope="col"><span class="pc-name">Basic</span><span class="pc-price">Free</span><span class="pc-sub">Always free</span><a class="pc-btn" href="${basicHref}"><span class="pc-long">${basicLabel}</span><span class="pc-short">${basicShort}</span></a></th>
        <th class="pc-h pc-f" id="planFeatured" scope="col"><span class="pc-tag">First 30 days free</span><span class="pc-name">Featured</span><span class="pc-price">$89<small> / month</small></span><span class="pc-sub">No card to start. Cancel any time.</span><a class="pc-btn go" href="${featHref}"><span class="pc-long">${featLabel}</span><span class="pc-short">${featShort}</span></a></th>
      </tr></thead>`;
  const body = GROUPS.map(([name, rows]) => `<tr class="pc-group"><th colspan="3" scope="colgroup">${esc(name)}</th></tr>\n      ` + rows.map(([label, sub, b, f]) =>
    `<tr><th scope="row" class="pc-lab">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</th>${cell(b, 'pc-b')}${cell(f, 'pc-f')}</tr>`).join('\n      ')).join('\n      ');
  return `<div class="pc" id="plan-compare">${SPRITE}
    <table>
      <caption class="sr">Basic and Featured compared, feature by feature</caption>
      ${head}
      <tbody>
      ${body}
      </tbody>
    </table>
  </div>`;
}

export const PAGES = [
  { file: 'for-firms.html', indent: '  ', basicHref: '/list-your-firm', basicLabel: 'List your firm free', basicShort: 'List free', featHref: '/list-your-firm?plan=featured', featLabel: 'Start your free month', featShort: 'Free month' },
  { file: 'list-your-firm.html', indent: '    ', basicHref: '/account/#find', basicLabel: 'Create your free account', basicShort: 'Free account', featHref: '/account/#firms', featLabel: 'Start your free month', featShort: 'Free month' },
];

const START = '<!-- plan-table:start -->', END = '<!-- plan-table:end -->';
const check = process.argv.includes('--check');
let bad = 0;
for (const pg of PAGES) {
  const text = readFileSync(pg.file, 'utf8');
  const i = text.indexOf(START), j = text.indexOf(END);
  if (i < 0 || j < i) { console.error(`FAIL  ${pg.file}: the plan-table markers are missing`); bad++; continue; }
  const want = `${START}\n${pg.indent}${table(pg)}\n${pg.indent}`;
  const have = text.slice(i, j);
  if (have === want) continue;
  if (check) { console.error(`FAIL  ${pg.file}: the Free or Featured table is not the one in scripts/apply-plan-table.mjs (run it)`); bad++; } else writeFileSync(pg.file, text.slice(0, i) + want + text.slice(j));
}
if (bad) process.exit(1);
console.log(check ? 'the Free or Featured table is the same on both pages' : 'Free or Featured table written to both pages');
