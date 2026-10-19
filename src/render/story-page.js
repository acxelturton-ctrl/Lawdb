// One story's own page on LawDB: the picture, the headline, the short preview the firm publishes, who wrote it (with their LawDB profile),
// more from the same firm, and a clear link to read the full article on the firm's own website. The full article is never copied.
// The same markup is used as a full page and, with ?partial=1, as the expanded view that opens over the News page.
import * as C from './firm-chunks.generated.js';
import { esc, safeUrl } from './firm-page.js';
import { BLOG_CSS, safePostUrl } from './blog-cards.js';
import { storyPath } from '../lib/stories.js';

const fmtDate = (d) => {
  const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
};
const isoDay = (d) => { const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : ''; };

const CSS = `<style>
.st-wrap{max-width:860px;margin:0 auto;padding:clamp(18px,3vw,40px) clamp(16px,4vw,32px) 60px}
.st-crumb{font-size:13.5px;color:#636870;margin:0 0 14px}.st-crumb a{color:#b45309;text-decoration:none;font-weight:600}
.st-img{display:block;border-radius:16px;overflow:hidden;background:#f0ede5;aspect-ratio:16/9;margin:0 0 clamp(16px,2.4vw,26px)}
.st-img img{display:block;width:100%;height:100%;object-fit:cover}
.st-firm{display:flex;align-items:center;gap:12px;margin:0 0 12px}
.st-av{flex:none;width:48px;height:48px;border-radius:50%;background:#f0ede5;border:1px solid #e3dfd5;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:700;color:#5d5f63}
.st-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.st-firm a.n{font-weight:700;color:#1f2328;text-decoration:none;font-size:16px}.st-firm a.n:hover{text-decoration:underline}
.st-firm .ft{background:#b45309;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:8px}
.st-firm small{display:block;color:#8d9197;font-size:13px}
.st h1{font:700 clamp(28px,4.4vw,46px)/1.12 'Source Serif 4',serif;margin:0 0 14px;text-wrap:balance}
.st .pre{font-size:clamp(16.5px,1.5vw,19px);line-height:1.7;color:#30353b;margin:0 0 20px}
.st-go{display:inline-block;background:#1f2328;color:#fff;border-radius:10px;padding:14px 22px;font-weight:700;text-decoration:none;font-size:16px}
.st-go:hover{background:#b45309}
.st-cta{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.st-note{font-size:13px;color:#8d9197;margin:12px 0 0;line-height:1.55}
.st-box{background:#fff;border:1px solid #e3dfd5;border-radius:14px;padding:18px 20px;margin:26px 0 0}
.st-box h2{font:700 19px 'Source Serif 4',serif;margin:0 0 10px}
.st-box ul{list-style:none;margin:0;padding:0}.st-box li{margin:0 0 9px}.st-box li a{color:#1f2328;font-weight:600;text-decoration:none}.st-box li a:hover{text-decoration:underline}.st-box li small{color:#8d9197;margin-left:6px}
.st-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.st-chips span{background:#f0ede5;color:#7a5516;border-radius:999px;padding:3px 10px;font-size:12.5px;font-weight:600}
.st-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}.st-row a{border:1px solid #1f2328;color:#1f2328;border-radius:8px;padding:10px 16px;font-weight:600;font-size:14.5px;text-decoration:none}
</style>`;

const avatarOf = (firm) => {
  const l = safeUrl(firm.src);
  return l ? `<img src="${esc(/^https:/.test(l) || l.startsWith('/') ? l : '/' + l)}" alt="" width="48" height="48">` : esc((firm.name || '?').trim().charAt(0).toUpperCase());
};

// post: { id, title, url, publishedAt, excerpt, image }; firm: { slug, name, city, province, featured, tags, phone, website, src }
// more: other posts of the firm [{ id, title }]; nearby: other firms in the city [{ slug, name }]
export function storyBody({ post, firm, more, nearby }) {
  const host = (() => { try { return new URL(post.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const date = fmtDate(post.publishedAt);
  const tags = (firm.tags || []).slice(0, 4).map((t) => `<span>${esc(t)}</span>`).join('');
  const call = firm.phone ? `<a href="tel:${esc(String(firm.phone).replace(/[^+\d]/g, ''))}">Call ${esc(firm.name)}</a>` : '';
  return `<article class="st">` +
    (post.image && safePostUrl(post.image) ? `<span class="st-img"><img src="${esc(post.image)}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : '') +
    `<div class="st-firm"><span class="st-av">${avatarOf(firm)}</span><span><a class="n" href="/firms/${esc(firm.slug)}">${esc(firm.name)}</a>${firm.featured ? '<span class="ft">Featured</span>' : ''}<small>${esc(firm.city)}, ${esc(firm.province)}${date ? ' &middot; ' + esc(date) : ''}</small></span><button class="lw-fbtn" type="button" data-follow="${esc(firm.slug)}" style="margin-left:auto">Follow</button></div>` +
    `<h1>${esc(post.title)}</h1>` +
    (post.excerpt ? `<p class="pre">${esc(post.excerpt)}</p>` : '') +
    `<div class="st-cta"><a class="st-go" href="${esc(post.url)}" target="_blank" rel="noopener">Read the full article on ${esc(host)} &rarr;</a><button class="lw-sbtn" type="button" data-save="${Number(post.id)}">Save</button></div>` +
    `<p class="st-note">This is a short preview. The article was written by ${esc(firm.name)} and the full text is on their website.</p>` +
    `<div class="st-box"><h2>About ${esc(firm.name)}</h2>${tags ? `<div class="st-chips">${tags}</div>` : ''}<div class="st-row"><a href="/firms/${esc(firm.slug)}">See their LawDB profile</a>${call}</div></div>` +
    (more.length ? `<div class="st-box"><h2>More from ${esc(firm.name)}</h2><ul>${more.map((m) => `<li><a href="${esc(storyPath(firm.slug, m.id, m.title))}" data-story>${esc(m.title)}</a></li>`).join('')}</ul></div>` : '') +
    (nearby.length ? `<div class="st-box"><h2>More law firms in ${esc(firm.city)}</h2><ul>${nearby.map((n) => `<li><a href="/firms/${esc(n.slug)}">${esc(n.name)}</a></li>`).join('')}</ul></div>` : '') +
    `</article>`;
}

export function renderStoryPage({ post, firm, more, nearby, origin = 'https://lawdb.ca', indexable = true }) {
  const url = origin + storyPath(firm.slug, post.id, post.title);
  const desc = (post.excerpt || post.title).slice(0, 155);
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [{ '@type': 'ListItem', position: 1, name: 'LawDB News', item: origin + '/news' }, { '@type': 'ListItem', position: 2, name: firm.name, item: origin + '/firms/' + firm.slug }, { '@type': 'ListItem', position: 3, name: post.title, item: url }],
  }).replace(/</g, '\\u003c');
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${esc(post.title)} | ${esc(firm.name)} | LawDB News</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(url)}">` + (indexable ? '' : '<meta name="robots" content="noindex,follow">'),
    `<meta property="og:title" content="${esc(post.title)}"><meta property="og:type" content="article"><meta property="og:url" content="${esc(url)}"><meta property="og:description" content="${esc(desc)}">` +
      (post.image && safePostUrl(post.image) ? `<meta property="og:image" content="${esc(post.image)}">` : '') +
      (isoDay(post.publishedAt) ? `<meta property="article:published_time" content="${isoDay(post.publishedAt)}">` : ''),
    `<script type="application/ld+json">${ld}</script>`,
    C.STYLE + BLOG_CSS + CSS + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n</head>',
    '<body>\n  ' + C.HEADER.replace(/<a[^>]*>Back to results<\/a>/, ''),
    `  <main class="st-wrap"><p class="st-crumb"><a href="/news">LawDB News</a> &rsaquo; <a href="/news?firm=${esc(firm.slug)}">${esc(firm.name)}</a></p>` + storyBody({ post, firm, more, nearby }) + '</main>',
    '  ' + C.FOOTER,
    '<script src="/site.js" defer></script>',
    '<script src="/follow.js" defer></script>',
    '</body>\n</html>\n',
  ].join('\n');
}

// The expanded view that opens over the News page: the same story, without the page around it.
export const renderStoryPartial = (data) => `<style>${CSS.replace(/<\/?style>/g, '')}</style>` + storyBody(data);
