// LawDB's own social profiles (X, Facebook, LinkedIn): a row of icons under the footer blurb on every page, a "Follow LawDB" row on the
// Contact page, and the home page's Organization data (sameAs) plus its twitter:site tag. The addresses are the profiles' own, without the
// tracking parts the share links came with. The icons are Simple Icons paths (CC0), the same ones the firm "Profiles" box uses.
//   node scripts/apply-site-socials.mjs          adds what is missing
//   node scripts/apply-site-socials.mjs --check  fails if a page lacks it (a new page copied from an old template)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHECK = process.argv.includes('--check');

export const SOCIALS = [
  { key: 'x', label: 'X', url: 'https://x.com/lawdbca', color: '#000000',
    d: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z' },
  { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/profile.php?id=61595212632512', color: '#1877f2',
    d: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
  { key: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/lawdb', color: '#0a66c2',
    d: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
];

const link = (s, size, fill, extra = '') =>
  `<a href="${s.url}" target="_blank" rel="noopener me" aria-label="LawDB on ${s.label}" title="${s.label}"${extra}>` +
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" aria-hidden="true" style="display:block"><path d="${s.d}"/></svg></a>`;

// Footer: grey icons that turn white on hover through the footer's own link colours; each link has an 8px pad (a 36px tap target) that
// does not move the icon.
const FOOTER_ROW = `<div class="fsoc" style="display:flex;gap:16px;margin-top:16px">${SOCIALS.map((s) => link(s, 20, 'currentColor', ' style="display:block;padding:8px;margin:-8px"')).join('')}</div>`;
// Contact page: brand colours on the page's light background, under the form card.
const CONTACT_ROW = `<p class="ct-follow" style="display:flex;align-items:center;justify-content:center;gap:16px;margin:28px 0 0;font-size:1rem">` +
  `<span>Follow LawDB</span>${SOCIALS.map((s) => link(s, 24, s.color, ' style="display:inline-flex;text-decoration:none"')).join('')}</p>`;

const FSOC_ROW = /<div class="fsoc"[^\n]*<\/div>/;
const FBLURB_END = /^([ \t]*)(<p class="fblurb">[^\n]*<\/p>)(\n?)(?![ \t\n]*<div class="fsoc")/m;
const sameAs = JSON.stringify(SOCIALS.map((s) => s.url));

function pagesIn(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.wrangler', 'images', 'scripts', 'src', 'data', 'db', 'docs', 'migrations'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pagesIn(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const stale = [];
let changed = 0;
const edit = (file, fn) => {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) return;
  stale.push(file);
  if (!CHECK) { writeFileSync(file, after); changed++; }
};

for (const file of pagesIn('.')) {
  edit(file, (h) => {
    if (!h.includes('class="fblurb"')) return h;
    if (FSOC_ROW.test(h)) return h.replace(FSOC_ROW, () => FOOTER_ROW);
    return h.replace(FBLURB_END, (m, ind, p, nl) => `${ind}${p}\n${ind}${FOOTER_ROW}${nl || '\n'}`);
  });
}

edit('contact.html', (h) => h.includes('class="ct-follow"') ? h : h.replace(/(    <div class="ct-ok" id="ctOk">[^\n]*<\/div>\n  <\/div>\n)/, `$1  ${CONTACT_ROW}\n`));

edit('index.html', (h) => {
  let out = h;
  if (!out.includes('"sameAs"')) out = out.replace(/(  "logo": "https:\/\/lawdb\.ca\/images\/logo-icon\.png",\n)/, `$1  "sameAs": ${sameAs},\n`);
  if (!out.includes('name="twitter:site"')) out = out.replace('<meta name="twitter:card"', '<meta name="twitter:site" content="@lawdbca">\n<meta name="twitter:card"');
  return out;
});

if (CHECK && stale.length) {
  console.error(`social links missing or out of date on ${stale.length} page(s): ${stale.slice(0, 8).join(', ')}${stale.length > 8 ? ', ...' : ''}\nrun: node scripts/apply-site-socials.mjs`);
  process.exit(1);
}
console.log(CHECK ? 'site social links are in place' : `site social links: ${changed} page(s) updated`);
