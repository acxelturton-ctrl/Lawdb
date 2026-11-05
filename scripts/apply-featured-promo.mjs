// The "For law firms" box in every page's menu drawer says what Featured includes. It is the same text on all ~720 pages (and in the page template,
// scripts/case-page.shell.html), so it is kept here, once, and written into every page:
//   node scripts/apply-featured-promo.mjs          (rewrite every page whose box is different)
//   node scripts/apply-featured-promo.mjs --check  (fail if any page's box is not this one)
// Change the wording here, run it, then run `node scripts/extract-firm-template.mjs` (the Worker's page pieces are built from a firm page).
// The button must stay "Get Featured" (the menu checks in smoke.mjs and the link checker look for it).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ITEM = (icon, title, text) => `      <li><span class="mp-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span><span><b>${title}</b>${text}</span></li>`;
export const PROMO = [
  '<div class="menu-promo">',
  '    <p class="mp-eyebrow">For law firms</p>',
  '    <p class="mp-head">Grow leads to your law firm</p>',
  '    <ul class="mp-list">',
  ITEM('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', 'Ranked above Basic firms', 'First in search for your city and case type, with a Featured Partner card on top.'),
  ITEM('<path d="M4 20h4L18.5 9.5l-4-4L4 16z"/><path d="M13 7l4 4"/>', 'Your page, your way', 'Add your logo, cover and photos, and a Book a call button with your own booking link.'),
  ITEM('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 'Analytics dashboard', 'See page views, visitors, every button clicked and where visitors come from, with a weekly email.'),
  ITEM('<path d="M4 5h16v14H4z"/><path d="M4 10h16M9 10v9"/>', 'Enquiries dashboard', 'Read, filter, add notes, reply and export every enquiry, and send them to a second email address.'),
  ITEM('<path d="M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/>', 'Gold pin and badge', 'Stand out on the map, in the search box and on your profile.'),
  '    </ul>',
  '    <a class="mp-cta" href="/list-your-firm?plan=featured">Get Featured</a>',
  '    <p class="mp-note">Your first 30 days are free, with no card needed. After that Featured is $89 a month, and you can cancel any time.</p>',
  '    <a class="mp-alt" href="/list-your-firm">List your firm free</a>',
  '  </div>',
].join('\n');

const SKIP = new Set(['node_modules', '.wrangler', '.claude', '.git']);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.html')) files.push(p);
  }
})('.');

const BOX = /<div class="menu-promo">[\s\S]*?\n  <\/div>/;
const check = process.argv.includes('--check');
let changed = 0, found = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const m = text.match(BOX);
  if (!m) continue;
  found++;
  if (m[0] === PROMO) continue;
  changed++;
  if (!check) writeFileSync(f, text.replace(BOX, () => PROMO));
}
if (check) {
  if (changed) { console.error(`FAIL  ${changed} of ${found} pages have a different "For law firms" box (run: node scripts/apply-featured-promo.mjs)`); process.exit(1); }
  console.log(`the "For law firms" box is the same on all ${found} pages`);
} else console.log(`${changed} pages updated, ${found - changed} already right (${found} pages have the box)`);
