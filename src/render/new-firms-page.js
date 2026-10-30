// New listed firms: the most recently added firms on LawDB, newest first, as cards that open each firm's profile.
// Text only, always escaped.
import * as C from './firm-chunks.generated.js';
import { esc, PROVINCES } from './firm-page.js';

const CSS = `<style>
.nf-band{max-width:1120px;margin:0 auto;padding:clamp(28px,5vw,56px) clamp(16px,4vw,40px) 10px;box-sizing:border-box;color:#142434}
.nf-eyebrow{margin:0 0 10px;font:700 12px/1 'Inter',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#c9a050}
.nf-band h1{font-family:'Source Serif 4',serif;font-size:clamp(32px,6vw,52px);line-height:1.1;margin:0 0 12px;color:#142434}
.nf-intro{font-size:16px;line-height:1.6;color:#586170;max-width:44em;margin:0}
.nf-main{max-width:1120px;margin:0 auto;padding:clamp(18px,3vw,30px) clamp(16px,4vw,40px) 40px;box-sizing:border-box}
.nf-count{font-size:13px;color:#586170;margin:0 0 14px}
.nf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.nf-card{display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid #e3dfd3;border-radius:14px;padding:18px;text-decoration:none;color:#142434}
.nf-card:hover{border-color:#c9a050}
.nf-name{font-family:'Source Serif 4',serif;font-size:19px;line-height:1.25;font-weight:700}
.nf-place{font-size:13.5px;color:#586170}
.nf-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.nf-tags i{font-style:normal;font-size:12px;color:#142434;background:#f4ecd8;border-radius:999px;padding:3px 9px}
.nf-feat{align-self:flex-start;margin-top:4px;font:700 10.5px/1 'Inter',sans-serif;letter-spacing:.08em;text-transform:uppercase;background:#c9a050;color:#142434;border-radius:999px;padding:5px 9px}
.nf-empty{font-size:15px;color:#586170}
</style>`;

const card = (f) => `<a class="nf-card" href="/firms/${esc(f.slug)}">` +
  `<span class="nf-name">${esc(f.name)}</span>` +
  `<span class="nf-place">${esc(f.city)}, ${esc(PROVINCES[f.province] || f.province)}</span>` +
  (f.tags.length ? `<span class="nf-tags">${f.tags.slice(0, 3).map((t) => `<i>${esc(t)}</i>`).join('')}</span>` : '') +
  (f.featured ? '<span class="nf-feat">Featured</span>' : '') +
  '</a>';

export function renderNewFirmsPage({ firms }) {
  const desc = 'The most recently added law firms on LawDB, newest first. Each one has its own profile with practice areas, address and a way to get in touch.';
  const body = firms.length
    ? `<p class="nf-count">Showing the ${firms.length} most recently added firms</p><div class="nf-grid">${firms.map(card).join('')}</div>`
    : '<p class="nf-empty">No firms are listed yet. Check back soon.</p>';
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>New listed firms | LawDB.ca</title>',
    `<meta name="description" content="${esc(desc)}">`,
    '<link rel="canonical" href="https://lawdb.ca/new-firms">',
    '<meta property="og:title" content="New listed firms | LawDB.ca"><meta property="og:type" content="website"><meta property="og:url" content="https://lawdb.ca/new-firms">' + `<meta property="og:description" content="${esc(desc)}">`,
    C.STYLE + CSS + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n</head>',
    '<body>\n  ' + C.HEADER.replace(/<a[^>]*>Back to results<\/a>/, ''),
    '  <header class="nf-band"><p class="nf-eyebrow">Newest on LawDB</p><h1>New listed firms</h1>' +
      '<p class="nf-intro">The law firms added to LawDB most recently. Each firm has its own profile with its practice areas, address and ways to get in touch.</p></header>',
    '  <main class="nf-main">' + body + '</main>',
    '  ' + C.FOOTER,
    '<script src="/site.js" defer></script>',
    '</body>\n</html>\n',
  ].join('\n');
}
