// The "Free or Featured" comparison on For Law Firms and List Your Firm: one table that reads from the top down.
//   1. "Free on every listing": what a Basic firm gets (a tick for Basic and for Featured).
//   2. "Featured adds": everything a Featured firm gets on top, in groups; Basic shows a lock on every row.
// It is the same table on both pages (only the two buttons differ), so it is written here once and put into each page between the
// plan-table:start / plan-table:end markers:
//   node scripts/apply-plan-table.mjs          (rewrite both pages)
//   node scripts/apply-plan-table.mjs --check  (fail if a page's table is not this one)
// Style: plan-compare.css (linked from both pages). When Featured gains a feature, add a row to FEATURED below, run this, and update the other
// places listed in docs/ARCHITECTURE.md ("Where Featured is described to firms"). A feature that Basic gets goes in FREE.
//
// Every plan cell is an icon only (a tick or a lock), so nothing in the two plan columns can fall out of line; the wording lives in the
// left-hand column, a title and one line under it.
import { readFileSync, writeFileSync } from 'node:fs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// [title, one line under it]
export const FREE = {
  title: 'Free on every listing',
  note: 'Create an account, add or claim your firm, and run your profile yourself. No card needed.',
  rows: [
    ['List your firm and manage your own profile', 'Create a free account, add or claim your firm'],
    ['Keep your details up to date yourself', 'Name, address, phone, website, hours and practice areas, any time'],
    ['Write your own description and tagline', 'Tell clients about your firm in your own words'],
    ['Say who you serve and whether you are taking clients', 'Languages, the year you started practising, new-client status and virtual consultations'],
    ['Get verified by LawDB', 'We check your law society registration and show a Verified badge, with what we checked and a link to the directory'],
    ['Listed by case type and city', 'Your firm has its own page in the directory'],
    ['Every enquiry emailed to you', 'Straight to your inbox'],
    ['Your numbers for the last 30 days', 'Page views, visitors, clicks and enquiries as totals, with a weekly email'],
    ['Your latest blog posts on your page', 'Shown as cards that link to your own site'],
    ['Your articles on LawDB News', 'Shown as cards'],
    ['Followers and member ratings', 'You see how many, never who'],
  ],
};

export const FEATURED = {
  title: 'Featured adds',
  note: 'Locked on Basic. All of it opens the day you start your free month.',
  groups: [
    ['Be seen first', [
      ['Above Basic firms in search results', 'With a Featured Partner card. Basic firms follow, sorted by rating'],
      ['First in the live search box', 'With a gold badge. Basic firms come after'],
      ['Gold highlighted pin on the map', 'Basic firms get a standard pin'],
      ['Gold tick and Featured badge', 'On your profile and wherever your firm appears'],
      ['First among nearby firms', 'On other firms\' profiles and story pages'],
      ['Featured badge and story pages on LawDB News', 'Story pages that search engines can find, with higher placement'],
    ]],
    ['Your page, your way', [
      ['Your logo, cover picture and photos', 'Make the page look like your firm'],
      ['Book a call button with your own booking link', 'Clients book you straight from your page'],
    ]],
    ['Enquiries', [
      ['Enquiries dashboard', 'Filters, private notes, one-tap reply, spreadsheet export'],
      ['Enquiries also sent to a second email address', 'For example your intake desk'],
    ]],
    ['Analytics', [
      ['Full analytics dashboard', 'Every button clicked, where visitors came from, phone or computer, provinces and busiest days, compared with the period before'],
      ['Spreadsheet export of your numbers', 'Open it in Excel or Google Sheets'],
    ]],
  ],
};

const SPRITE = '<svg class="pc-sprite" width="0" height="0" aria-hidden="true" focusable="false"><symbol id="pc-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></symbol><symbol id="pc-lock" viewBox="0 0 24 24"><path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>';

const tick = (cls) => `<td class="${cls}"><span class="pc-mark ok"><svg class="pc-i" aria-hidden="true"><use href="#pc-check"/></svg></span><span class="sr">Included</span></td>`;
const lock = () => `<td class="pc-b"><span class="pc-mark lock"><svg class="pc-i" aria-hidden="true"><use href="#pc-lock"/></svg></span><span class="sr">Locked on Basic, Featured only</span></td>`;
const label = ([title, sub]) => `<th scope="row" class="pc-lab">${esc(title)}<small>${esc(sub)}</small></th>`;

export function table({ basicHref, basicLabel, basicShort, featHref, featLabel, featShort }) {
  const basicBtn = `<a class="pc-btn" href="${basicHref}"><span class="pc-long">${basicLabel}</span><span class="pc-short">${basicShort}</span></a>`;
  const featBtn = `<a class="pc-btn go" href="${featHref}"><span class="pc-long">${featLabel}</span><span class="pc-short">${featShort}</span></a>`;
  const head = `<thead><tr>
        <th class="pc-lab pc-corner" scope="col">What you get</th>
        <th class="pc-h pc-b" scope="col"><span class="pc-name">Basic</span><span class="pc-price">Free</span><span class="pc-sub">Always free</span>${basicBtn}</th>
        <th class="pc-h pc-f" id="planFeatured" scope="col"><span class="pc-tag">First 30 days free</span><span class="pc-name">Featured</span><span class="pc-price">$89<small> / month</small></span><span class="pc-sub">No card to start. Cancel any time.</span>${featBtn}</th>
      </tr></thead>`;

  const free = `<tr class="pc-band pc-band-free"><th colspan="3" scope="colgroup"><b>${esc(FREE.title)}</b><span>${esc(FREE.note)}</span></th></tr>
      ` + FREE.rows.map((r) => `<tr>${label(r)}${tick('pc-b')}${tick('pc-f')}</tr>`).join('\n      ');

  const featured = `<tr class="pc-band pc-band-feat"><th colspan="3" scope="colgroup"><svg class="pc-i pc-bandlock" aria-hidden="true"><use href="#pc-lock"/></svg><b>${esc(FEATURED.title)}</b><span>${esc(FEATURED.note)}</span></th></tr>
      ` + FEATURED.groups.map(([name, rows]) => `<tr class="pc-group"><th colspan="3" scope="colgroup">${esc(name)}</th></tr>
      ` + rows.map((r) => `<tr class="pc-lk">${label(r)}${lock()}${tick('pc-f')}</tr>`).join('\n      ')).join('\n      ');

  const foot = `<tfoot><tr>
        <td class="pc-lab pc-end"><b>Start free. Upgrade when you are ready.</b><small>Featured is free for your first 30 days. No card to start.</small></td>
        <td class="pc-b">${basicBtn}</td>
        <td class="pc-f">${featBtn}</td>
      </tr></tfoot>`;

  return `<div class="pc" id="plan-compare">${SPRITE}
    <table>
      <caption class="sr">Basic and Featured compared. First what every free listing gets, then what Featured adds, which is locked on Basic.</caption>
      ${head}
      <tbody>
      ${free}
      ${featured}
      </tbody>
      ${foot}
    </table>
  </div>`;
}

export const PAGES = [
  { file: 'for-firms.html', indent: '  ', basicHref: '/list-your-firm', basicLabel: 'List your firm free', basicShort: 'List free', featHref: '/list-your-firm?plan=featured', featLabel: 'Start your free month', featShort: 'Free month' },
  { file: 'list-your-firm.html', indent: '    ', basicHref: '/account/#find', basicLabel: 'Create your free account', basicShort: 'Join free', featHref: '/account/#firms', featLabel: 'Start your free month', featShort: 'Free month' },
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
