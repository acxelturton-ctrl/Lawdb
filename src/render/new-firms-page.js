// New listed firms: the most recently added firms on LawDB that have a logo and a cover, newest first. Each card shows the cover,
// the firm's logo on it, the name, the place and its practice areas, and opens the firm's profile. Text is always escaped.
import * as C from './firm-chunks.generated.js';
import { esc, PROVINCES } from './firm-page.js';

const CSS = `<style>
.nf-band{max-width:1120px;margin:0 auto;padding:clamp(28px,5vw,56px) clamp(16px,4vw,40px) 10px;box-sizing:border-box;color:#142434}
.nf-eyebrow{margin:0 0 10px;font:700 12px/1 'Inter',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#c9a050}
.nf-band h1{font-family:'Source Serif 4',serif;font-size:clamp(32px,6vw,52px);line-height:1.1;margin:0 0 12px;color:#142434}
.nf-intro{font-size:16px;line-height:1.6;color:#586170;max-width:44em;margin:0}
.nf-main{max-width:1120px;margin:0 auto;padding:clamp(18px,3vw,30px) clamp(16px,4vw,40px) 40px;box-sizing:border-box}
.nf-count{font-size:13px;color:#586170;margin:0 0 18px}
.nf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:22px}
.nf-card{position:relative;display:flex;flex-direction:column;background:#fff;border:1px solid #e3dfd3;border-radius:18px;overflow:hidden;text-decoration:none;color:#142434;box-shadow:0 2px 6px #e3dfd3;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.nf-card:hover{transform:translateY(-3px);border-color:#c9a050;box-shadow:0 14px 30px rgba(20,36,52,.12)}
.nf-cover{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;background:#edeae1}
.nf-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.nf-feat{position:absolute;top:12px;right:12px;font:700 10.5px/1 'Inter',sans-serif;letter-spacing:.08em;text-transform:uppercase;background:#c9a050;color:#142434;border-radius:999px;padding:6px 10px}
.nf-body{display:flex;flex:1;flex-direction:column;gap:6px;padding:0 20px 18px}
.nf-logo{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:76px;height:76px;margin:-38px 0 8px;padding:10px;background:#fff;border:1px solid #e3dfd3;border-radius:18px;box-shadow:0 4px 12px #e3dfd3}
.nf-logo img{display:block;max-width:100%;max-height:100%;object-fit:contain}
.nf-name{font-family:'Source Serif 4',serif;font-size:20px;line-height:1.25;font-weight:700;color:#142434}
.nf-place{font-size:13.5px;color:#586170}
.nf-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.nf-tags i{font-style:normal;font-size:12px;color:#142434;background:#f4ecd8;border-radius:999px;padding:3px 9px}
.nf-go{display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:14px;font:700 14px/1 'Inter',sans-serif;color:#142434;border-top:1px solid #edeae1}
.nf-go svg{flex:none;color:#c9a050;transition:transform .2s ease}
.nf-card:hover .nf-go svg{transform:translateX(3px)}
.nf-empty{font-size:15px;color:#586170}
</style>`;

const POS = /^(?:center|\d{1,3}%)(?: (?:center|top|bottom|\d{1,3}%))?$/;
// Pictures are stored as paths from the site root (images/..., img/...) or as https links.
const picUrl = (u) => (/^https:/.test(u) || u.startsWith('/') ? u : `/${u}`);
const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const card = (f) => {
  const tags = f.tags.slice(0, 2).map((t) => `<i>${esc(t)}</i>`).join('');
  return `<a class="nf-card" href="/firms/${esc(f.slug)}">` +
    `<span class="nf-cover"><img src="${esc(picUrl(f.cover))}" alt="" loading="lazy" decoding="async" style="object-position:${POS.test(f.coverPos || '') ? f.coverPos : 'center'}"></span>` +
    (f.featured ? '<span class="nf-feat">Featured</span>' : '') +
    '<span class="nf-body">' +
    `<span class="nf-logo"><img src="${esc(picUrl(f.logo))}" alt="${esc(f.name)} logo" loading="lazy" decoding="async"${/^https:/.test(f.logo) ? ' referrerpolicy="no-referrer" onerror="this.remove()"' : ''}></span>` +
    `<span class="nf-name">${esc(f.name)}</span>` +
    `<span class="nf-place">${esc(f.city)}, ${esc(PROVINCES[f.province] || f.province)}</span>` +
    (tags ? `<span class="nf-tags">${tags}</span>` : '') +
    `<span class="nf-go">View profile ${ARROW}</span>` +
    '</span></a>';
};

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
