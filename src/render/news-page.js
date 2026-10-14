// LawDB News: blog cards from member firms, newest first. Each card shows the firm, the headline, a short preview that
// opens a little wider, and a link to read the full article on the firm's own website. Text only, always escaped.
import * as C from './firm-chunks.generated.js';
import { esc } from './firm-page.js';
import { BLOG_CSS, cardHtml, safePostUrl } from './blog-cards.js';

const CSS = `<style>
.news-hero{max-width:760px;margin:30px 0 8px}.news-hero h1{margin:0 0 8px}.news-hero p{color:#6b645a;line-height:1.55;margin:0}
.news-chips{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 20px}
.news-chips a{padding:7px 13px;border-radius:999px;border:1px solid #e4ded3;background:#fff;color:#4a453d;font-size:13px;font-weight:600;text-decoration:none}
.news-chips a[aria-current="true"]{background:#2b2723;color:#fff;border-color:#2b2723}
.lw-by{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#2b2723}
.lw-by a{color:inherit;text-decoration:none}.lw-by a:hover{text-decoration:underline}
.lw-by .lw-ft{background:#b8863b;color:#fff;border-radius:999px;padding:1px 7px;font-size:10.5px;letter-spacing:.03em}
.news-empty{background:#fff;border:1px solid #e4ded3;border-radius:12px;padding:22px;max-width:620px;color:#4a453d;line-height:1.55}
.news-foot{margin:26px 0 8px;font-size:12px;color:#8f8a80;line-height:1.55;max-width:760px}
.news-cta{margin:30px 0;background:#fbf3e3;border:1px solid #edd9ae;border-radius:10px;padding:18px 20px;max-width:760px}
.news-cta b{display:block;margin-bottom:4px}.news-cta a{color:#8a6420;font-weight:700}
</style>`;

// posts: [{ firmSlug, firmName, featured, title, url, publishedAt, excerpt }]; firms: [{ slug, name }] (for the filter chips)
export function renderNewsPage({ posts, firms, selected = '' }) {
  const shown = posts.filter((p) => safePostUrl(p.url));
  const chips = firms.length > 1
    ? `<nav class="news-chips" aria-label="Filter by firm"><a href="/legal-news.html"${selected ? '' : ' aria-current="true"'}>All firms</a>${firms.map((f) =>
        `<a href="/legal-news.html?firm=${esc(f.slug)}"${selected === f.slug ? ' aria-current="true"' : ''}>${esc(f.name)}</a>`).join('')}</nav>`
    : '';
  const cards = shown.map((p) =>
    cardHtml(p, { byline: `<div class="lw-by"><a href="/firms/${esc(p.firmSlug)}">${esc(p.firmName)}</a>${p.featured ? '<span class="lw-ft">Featured</span>' : ''}</div>` })).join('');
  const body = shown.length
    ? `<div class="lw-bc-grid">${cards}</div>`
    : '<div class="news-empty"><b>LawDB News is filling up.</b><br>Articles from our Featured members appear here as soon as their blogs are connected. Check back soon.</div>';
  const desc = 'Articles from Featured law firms on LawDB: short previews with a link to read the full article on each firm\'s own website.';
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>LawDB News | Articles from Featured Law Firms | LawDB.ca</title>',
    `<meta name="description" content="${esc(desc)}">`,
    '<link rel="canonical" href="https://lawdb.ca/legal-news.html">',
    '<meta property="og:title" content="LawDB News"><meta property="og:type" content="website"><meta property="og:url" content="https://lawdb.ca/legal-news.html">' + `<meta property="og:description" content="${esc(desc)}">`,
    C.STYLE + BLOG_CSS + CSS + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n</head>',
    '<body>\n  ' + C.HEADER.replace(/<a[^>]*>Back to results<\/a>/, ''),
    '  <div class="wrap">',
    '    <div class="news-hero"><h1>LawDB News</h1><p>Articles from the Featured law firms on LawDB. Read a short preview here, and open the full article on the firm\'s own website.</p></div>',
    '    ' + chips,
    '    ' + body,
    '    <div class="news-cta"><b>Run a law firm?</b>Featured members\' blogs appear on this page. <a href="/for-firms.html">See how Featured works &rarr;</a></div>',
    '    <p class="news-foot">Headlines and short excerpts come from each firm\'s public blog. The articles belong to the firms that wrote them, and the full text is on their websites. LawDB is an independent directory and does not endorse any article or firm.</p>',
    '  </div>',
    '  ' + C.FOOTER,
    '<script src="/site.js" defer></script>',
    '</body>\n</html>\n',
  ].join('\n');
}
