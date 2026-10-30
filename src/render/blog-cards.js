// "Latest from the firm's blog": clean cards with a headline, date and a short excerpt that opens a little wider,
// and a link to the full article on the firm's own website. Text only, always escaped; nothing from the feed is trusted as HTML.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

export const BLOG_CSS = `<style>
.lw-blog{margin:26px 0}
.lw-blog h2{font-size:18px;margin:0 0 4px}
.lw-blog .lw-blog-sub{margin:0 0 12px;color:#586170;font-size:13px}
.lw-bc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.lw-bc{background:#fff;border:1px solid #e3dfd3;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.lw-bc-img{display:block;aspect-ratio:16/9;background:#edeae1;overflow:hidden}
.lw-bc-img img{display:block;width:100%;height:100%;object-fit:cover;object-position:center 30%;transition:transform .25s ease}
.lw-bc:hover .lw-bc-img img{transform:scale(1.03)}
.lw-bc-in{padding:14px 16px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
.lw-bc time{font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:#8a919b;font-weight:600}
.lw-bc h3{margin:0;font-size:15.5px;line-height:1.3}
.lw-bc h3 a{color:inherit;text-decoration:none}.lw-bc h3 a:hover{text-decoration:underline}
.lw-bc p{margin:0;font-size:13.5px;line-height:1.55;color:#2b3a4c}
.lw-bc details{margin-top:2px}
.lw-bc summary{cursor:pointer;color:#e2bd6a;font-weight:700;font-size:12.5px;list-style:none;padding:2px 0}
.lw-bc summary::-webkit-details-marker{display:none}
.lw-bc summary::after{content:' \\25BE'}.lw-bc details[open] summary::after{content:' \\25B4'}
.lw-bc details[open] summary{margin-bottom:6px}
.lw-bc .lw-more{margin-bottom:10px}
.lw-bc .lw-go{display:inline-block;background:#142434;color:#fff;border-radius:6px;padding:8px 12px;font-size:12.5px;font-weight:700;text-decoration:none}
.lw-bc:has(details:not(.lw-menu)[open]) .lw-teaser{display:none}
.lw-blog .lw-note{margin:10px 0 0;font-size:11.5px;color:#8a919b;line-height:1.5}
/* LawDB News: a feed of posts in the MSPdatabase layout, one column on a phone and a computer. Each post is a white panel: the firm's
   header with a menu, then the headline and preview on the left and the picture on the right. */
.lw-feed{grid-template-columns:1fr;gap:12px;max-width:620px;margin:0 auto}
.lw-feed .lw-bc{position:relative;border-radius:12px;background:#fff;border:1px solid #e3dfd3;box-shadow:none;overflow:visible;font-family:'Inter',sans-serif;color:#142434}
.lw-feed .lw-bc-head{display:flex;align-items:flex-start;gap:12px;padding:14px 10px 0 16px}
.lw-feed .lw-av{flex:none;width:44px;height:44px;border-radius:50%;background:#edeae1;border:1px solid #e3dfd3;display:flex;align-items:center;justify-content:center;overflow:hidden;font:700 17px/1 'Source Serif 4',serif;color:#586170}
.lw-feed .lw-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.lw-feed .lw-who{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;padding-top:1px}
.lw-feed .lw-by{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font:700 15px/1.25 'Inter',sans-serif;color:#142434}
.lw-feed .lw-by a{color:inherit;text-decoration:none}.lw-feed .lw-by a:hover{text-decoration:underline}
.lw-feed .lw-ft{background:#e2bd6a;color:#142434;border-radius:999px;padding:1px 7px;font-size:10.5px;letter-spacing:.03em;font-weight:700}
.lw-feed .lw-sub{font:400 13px/1.35 'Inter',sans-serif;color:#586170;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lw-feed .lw-meta{display:flex;align-items:center;gap:5px;font:400 12.5px/1.3 'Inter',sans-serif;color:#8a919b}
.lw-feed .lw-meta time{font:inherit;letter-spacing:0;text-transform:none;color:inherit}
.lw-feed .lw-menu{position:relative;flex:none;margin-right:-4px}
.lw-feed .lw-menu summary{list-style:none;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#586170}
.lw-feed .lw-menu summary::-webkit-details-marker{display:none}
.lw-feed .lw-menu summary::after{content:none}
.lw-feed .lw-menu summary:hover{background:#f5f3ec}
.lw-feed .lw-menu-list{position:absolute;right:0;top:38px;z-index:5;min-width:200px;display:flex;flex-direction:column;padding:6px;background:#fff;border:1px solid #e3dfd3;border-radius:10px;box-shadow:0 12px 30px -12px rgba(20,36,52,.35)}
.lw-feed .lw-menu-list a,.lw-feed .lw-menu-list button{display:block;width:100%;box-sizing:border-box;text-align:left;padding:9px 10px;border:0;border-radius:6px;background:none;font:600 14px/1.3 'Inter',sans-serif;color:#142434;text-decoration:none;cursor:pointer}
.lw-feed .lw-menu-list a:hover,.lw-feed .lw-menu-list button:hover{background:#f5f3ec}
.lw-feed .lw-bc-row{display:flex;align-items:flex-start;gap:14px;padding:12px 16px 16px}
.lw-feed .lw-bc-in{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding:0}
.lw-feed .lw-bc h3{margin:0;font:700 17px/1.3 'Inter',sans-serif;color:#142434;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lw-feed .lw-bc h3 a{color:inherit;text-decoration:none}.lw-feed .lw-bc h3 a:hover{text-decoration:underline}
.lw-feed .lw-teaser{margin:0;font-size:14px;line-height:1.5;color:#586170;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lw-feed .lw-bc-img{flex:none;display:block;width:clamp(96px,36%,150px);aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:#edeae1}
.lw-feed .lw-bc-img img{width:100%;height:100%;object-fit:cover;object-position:center 30%}
/* a row of links (the profile cards) */
.lw-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:4px}
</style>`;

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(String(d).replace(' ', 'T') + 'Z');
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const teaser = (s, max = 170) => {
  if (s.length <= max) return s;
  const t = s.slice(0, max);
  return t.slice(0, Math.max(t.lastIndexOf(' '), max - 40)).replace(/[\s,;:.\-]+$/, '') + '...';
};

// How long ago a post was written, as the feed shows it ("3h", "2d", "4w"), and the exact time for the page. Null when the date is unknown.
const timeOf = (d) => {
  const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null;
  if (!t || Number.isNaN(t.getTime())) return null;
  const min = Math.max(0, (Date.now() - t.getTime()) / 60000);
  const label = min < 60 ? `${Math.max(1, Math.floor(min))}m`
    : min < 1440 ? `${Math.floor(min / 60)}h`
    : min < 10080 ? `${Math.floor(min / 1440)}d`
    : min < 44640 ? `${Math.floor(min / 10080)}w`
    : min < 525600 ? `${Math.floor(min / 43200)}mo`
    : `${Math.floor(min / 525600)}y`;
  return { label, iso: t.toISOString() };
};
const GLOBE = '<svg class="lw-globe" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.7 3.9 6 3.9 9.5s-1.3 6.8-3.9 9.5c-2.6-2.7-3.9-6-3.9-9.5s1.3-6.8 3.9-9.5z"/></svg>';
const DOTS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

// One card. `byline` (optional) names the firm, for compact lists. `head` (optional) makes it a LawDB News post:
// { avatar, name, href, featured, place, follow } (see feedCardHtml).
export function cardHtml(p, { byline = '', head = null, hero = false } = {}) {
  let host = '';
  try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch {}
  const max = hero ? 380 : 170;
  const more = p.excerpt && p.excerpt.length > max;
  const date = fmtDate(p.publishedAt);
  // The picture is the one the firm chose for the article, loaded from their own site; if it cannot load the card just drops it.
  // With a story page (`storyHref`) the card opens LawDB's own expanded view of the story; the firm's full article is one more tap away.
  const here = p.storyHref ? { href: p.storyHref, extra: ' data-story' } : { href: p.url, extra: ' target="_blank" rel="noopener"' };
  const pic = p.image && safePostUrl(p.image)
    ? `<a class="lw-bc-img" href="${esc(here.href)}"${here.extra} tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="640" height="360" onerror="this.parentNode.remove()"></a>`
    : '';
  if (head) return feedCardHtml(p, { head, here, pic, host, hero });
  const action = p.storyHref
    ? `<div class="lw-row"><a class="lw-go" href="${esc(p.storyHref)}" data-story>Read the story &rarr;</a>${p.id ? `<button class="lw-sbtn" type="button" data-save="${Number(p.id)}">Save</button>` : ''}</div>`
    : more
      ? `<details><summary>Read more</summary><p class="lw-more">${esc(p.excerpt)}</p><a class="lw-go" href="${esc(p.url)}" target="_blank" rel="noopener">Read the full article on ${esc(host)} &rarr;</a></details>`
      : `<a class="lw-go" style="align-self:flex-start;margin-top:4px" href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host)} &rarr;</a>`;
  const text = `${byline}${date ? `<time>${esc(date)}</time>` : ''}<h3><a href="${esc(here.href)}"${here.extra}>${esc(p.title)}</a></h3>` +
    (p.excerpt ? `<p class="lw-teaser">${esc(teaser(p.excerpt, max))}</p>` : '');
  return `<article class="lw-bc${hero ? ' lw-hero' : ''}">${pic}<div class="lw-bc-in">${text}${action}</div></article>`;
}

// A LawDB News post in the MSPdatabase layout: the firm's header (logo, name, place, time) with a menu of the post's actions,
// then the headline and preview on the left and the picture on the right. The menu holds every action, so the card has no buttons of its own.
function feedCardHtml(p, { head, here, pic, host, hero }) {
  const max = hero ? 380 : 200;
  const when = timeOf(p.publishedAt);
  const menu = p.storyHref
    ? `<a href="${esc(p.storyHref)}" data-story>Read the story</a>${p.id ? `<button type="button" data-save="${Number(p.id)}">Save</button>` : ''}`
    : `<a href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host)}</a>`;
  const top = `<div class="lw-bc-head"><span class="lw-av">${head.avatar}</span><div class="lw-who">` +
    `<span class="lw-by"><a href="${esc(head.href)}">${esc(head.name)}</a>${head.featured ? '<span class="lw-ft">Featured</span>' : ''}</span>` +
    (head.place ? `<span class="lw-sub">${esc(head.place)}</span>` : '') +
    `<span class="lw-meta">${when ? `<time datetime="${esc(when.iso)}">${esc(when.label)}</time> · ` : ''}${GLOBE}</span></div>` +
    `<details class="lw-menu"><summary aria-label="More options">${DOTS}</summary><div class="lw-menu-list">${menu}${head.follow || ''}</div></details></div>`;
  const text = `<h3><a href="${esc(here.href)}"${here.extra}>${esc(p.title)}</a></h3>` +
    (p.excerpt ? `<p class="lw-teaser">${esc(teaser(p.excerpt, max))}</p>` : '');
  return `<article class="lw-bc${hero ? ' lw-hero' : ''}">${top}<div class="lw-bc-row"><div class="lw-bc-in">${text}</div>${pic}</div></article>`;
}

export const safePostUrl = (u) => /^https:\/\//.test(u) || /^http:\/\/127\.0\.0\.1/.test(u);

export function renderBlogCards({ firmName, posts }) {
  const shown = (posts || []).slice(0, 3).filter((p) => safePostUrl(p.url));
  if (!shown.length) return '';
  return `${BLOG_CSS}<section class="lw-blog" aria-label="Latest from ${esc(firmName)}"><h2>Latest from ${esc(firmName)}</h2>` +
    `<p class="lw-blog-sub">Recent articles from the firm's own blog.</p><div class="lw-bc-grid">${shown.map((p) => cardHtml(p)).join('')}</div>` +
    `<p class="lw-note">Headlines and short excerpts come from the firm's public blog. The articles belong to ${esc(firmName)}; the full text is on their website.</p></section>`;
}

// The firm's own articles, listed under the profile's map the way MSPdatabase does it: each article is a row with the headline and a
// short preview on the left, and its picture on the right, with how long ago it was written. Text is escaped; only https pictures and
// links are used, as on the other cards.
const ARTICLES_CSS = `<style>
.fa{margin:28px 0 8px}
.fa h2{font:600 19px/1.3 'Source Serif 4',Georgia,serif;color:#142434;margin:0 0 6px}
.fa-row{display:flex;gap:16px;align-items:flex-start;padding:16px 0;border-top:1px solid #e3dfd3}
.fa-main{flex:1;min-width:0;color:#142434;text-decoration:none}
.fa-main h3{margin:0 0 6px;font:700 16px/1.3 'Inter',system-ui,sans-serif;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fa-main:hover h3{text-decoration:underline}
.fa-main p{margin:0 0 8px;font-size:14px;line-height:1.5;color:#586170;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fa-meta{display:flex;align-items:center;gap:5px;font:500 12.5px/1.3 'Inter',system-ui,sans-serif;color:#8a919b}
.fa-pic{flex:none;width:clamp(96px,34%,150px);aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:#edeae1}
.fa-pic img{width:100%;height:100%;object-fit:cover;display:block}
.fa-note{margin:14px 0 0;font-size:12px;color:#8a919b;line-height:1.5}
</style>`;

function articleRowHtml(p) {
  const href = p.storyHref || p.url;
  const target = p.storyHref ? '' : ' target="_blank" rel="noopener"';
  const when = timeOf(p.publishedAt);
  const pic = p.image && safePostUrl(p.image)
    ? `<span class="fa-pic"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>`
    : '';
  return `<article class="fa-row"><a class="fa-main" href="${esc(href)}"${target}><h3>${esc(p.title)}</h3>` +
    (p.excerpt ? `<p>${esc(teaser(p.excerpt, 170))}</p>` : '') +
    `<span class="fa-meta">${when ? `<time datetime="${esc(when.iso)}">${esc(when.label)}</time> · ` : ''}${GLOBE}</span></a>${pic}</article>`;
}

export function renderFirmArticles({ firmName, posts }) {
  const shown = (posts || []).slice(0, 5).filter((p) => safePostUrl(p.url));
  if (!shown.length) return '';
  return `${ARTICLES_CSS}<section class="fa" aria-label="Recent articles by ${esc(firmName)}"><h2>Recent articles by ${esc(firmName)}</h2>` +
    shown.map(articleRowHtml).join('') +
    `<p class="fa-note">Headlines and short excerpts come from the firm's public blog. The articles belong to ${esc(firmName)}; the full text is on their website.</p></section>`;
}

