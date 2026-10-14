// "Latest from the firm's blog": clean cards with a headline, date and a short excerpt that opens a little wider,
// and a link to the full article on the firm's own website. Text only, always escaped; nothing from the feed is trusted as HTML.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

export const BLOG_CSS = `<style>
.lw-blog{margin:26px 0}
.lw-blog h2{font-size:18px;margin:0 0 4px}
.lw-blog .lw-blog-sub{margin:0 0 12px;color:#6b645a;font-size:13px}
.lw-bc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.lw-bc{background:#fff;border:1px solid #e4ded3;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.lw-bc-img{display:block;aspect-ratio:16/9;background:#f1ece2;overflow:hidden}
.lw-bc-img img{display:block;width:100%;height:100%;object-fit:cover;object-position:center 30%;transition:transform .25s ease}
.lw-bc:hover .lw-bc-img img{transform:scale(1.03)}
.lw-bc-in{padding:14px 16px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
.lw-bc time{font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:#8f8a80;font-weight:600}
.lw-bc h3{margin:0;font-size:15.5px;line-height:1.3}
.lw-bc h3 a{color:inherit;text-decoration:none}.lw-bc h3 a:hover{text-decoration:underline}
.lw-bc p{margin:0;font-size:13.5px;line-height:1.55;color:#4a453d}
.lw-bc details{margin-top:2px}
.lw-bc summary{cursor:pointer;color:#8a6420;font-weight:700;font-size:12.5px;list-style:none;padding:2px 0}
.lw-bc summary::-webkit-details-marker{display:none}
.lw-bc summary::after{content:' \\25BE'}.lw-bc details[open] summary::after{content:' \\25B4'}
.lw-bc details[open] summary{margin-bottom:6px}
.lw-bc .lw-more{margin-bottom:10px}
.lw-bc .lw-go{display:inline-block;background:#2b2723;color:#fff;border-radius:6px;padding:8px 12px;font-size:12.5px;font-weight:700;text-decoration:none}
.lw-bc:has(details[open]) .lw-teaser{display:none}
.lw-blog .lw-note{margin:10px 0 0;font-size:11.5px;color:#8f8a80;line-height:1.5}
/* LawDB News: a feed, one big card at a time on a phone (post header, large picture, headline, preview) */
.lw-feed{grid-template-columns:1fr;gap:18px}
@media(min-width:900px){.lw-feed{grid-template-columns:repeat(2,1fr);gap:22px}}
.lw-feed .lw-bc{border-radius:14px;box-shadow:0 1px 2px rgba(43,39,35,.06)}
.lw-feed .lw-bc-head{display:flex;align-items:center;gap:10px;padding:12px 16px}
.lw-feed .lw-av{flex:none;width:40px;height:40px;border-radius:50%;background:#f1ece2;border:1px solid #e4ded3;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:700;color:#6b5a45}
.lw-feed .lw-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.lw-feed .lw-who{min-width:0;display:flex;flex-direction:column;line-height:1.25}
.lw-feed .lw-who .lw-by{font-size:14px}
.lw-feed .lw-who time{font-size:12px;letter-spacing:0;text-transform:none;font-weight:500;color:#8f8a80}
.lw-feed .lw-bc-img{aspect-ratio:4/3}
@media(min-width:900px){.lw-feed .lw-bc-img{aspect-ratio:16/10}}
.lw-feed .lw-bc-in{padding:16px 18px 20px;gap:10px}
.lw-feed .lw-bc h3{font-size:21px;line-height:1.25}
.lw-feed .lw-bc p{font-size:15.5px;line-height:1.6}
.lw-feed .lw-bc summary{font-size:14px;padding:6px 0}
.lw-feed .lw-bc .lw-go{padding:11px 16px;font-size:14px;border-radius:8px}
/* the lead story: picture and text side by side on a wide screen */
.lw-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:4px}
.lw-bc-head .lw-fbtn{margin-left:auto;flex:none}
.lw-feed .lw-hero{grid-column:1/-1}
.lw-feed .lw-hero h3{font-size:clamp(24px,2.4vw,38px);line-height:1.15}
.lw-feed .lw-hero p{font-size:clamp(16px,1.2vw,18.5px)}
@media(min-width:900px){
  .lw-feed .lw-hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);grid-template-rows:auto 1fr}
  .lw-feed .lw-hero .lw-bc-img{grid-column:1;grid-row:1/3;aspect-ratio:auto;height:100%;min-height:420px}
  .lw-feed .lw-hero .lw-bc-head{grid-column:2;grid-row:1;padding:22px 28px 0}
  .lw-feed .lw-hero .lw-bc-in{grid-column:2;grid-row:2;justify-content:center;padding:10px 28px 28px;gap:14px}
}
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

// One card. `byline` (optional) names the firm, for compact lists. `head` (optional) is the post header of the News feed:
// { avatar: html, who: html } shown above the picture together with the date, and the card is laid out larger.
export function cardHtml(p, { byline = '', head = null, hero = false } = {}) {
  let host = '';
  try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch {}
  const max = hero ? 380 : head ? 260 : 170;
  const more = p.excerpt && p.excerpt.length > max;
  const date = fmtDate(p.publishedAt);
  // The picture is the one the firm chose for the article, loaded from their own site; if it cannot load the card just drops it.
  // With a story page (`storyHref`) the card opens LawDB's own expanded view of the story; the firm's full article is one more tap away.
  const here = p.storyHref ? { href: p.storyHref, extra: ' data-story' } : { href: p.url, extra: ' target="_blank" rel="noopener"' };
  const pic = p.image && safePostUrl(p.image)
    ? `<a class="lw-bc-img" href="${esc(here.href)}"${here.extra} tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="640" height="360" onerror="this.parentNode.remove()"></a>`
    : '';
  const top = head
    ? `<div class="lw-bc-head"><span class="lw-av">${head.avatar}</span><span class="lw-who">${head.who}${date ? `<time>${esc(date)}</time>` : ''}</span>${head.action || ''}</div>`
    : '';
  const action = p.storyHref
    ? `<div class="lw-row"><a class="lw-go" href="${esc(p.storyHref)}" data-story>Read the story &rarr;</a>${p.id ? `<button class="lw-sbtn" type="button" data-save="${Number(p.id)}">Save</button>` : ''}</div>`
    : more
      ? `<details><summary>Read more</summary><p class="lw-more">${esc(p.excerpt)}</p><a class="lw-go" href="${esc(p.url)}" target="_blank" rel="noopener">Read the full article on ${esc(host)} &rarr;</a></details>`
      : `<a class="lw-go" style="align-self:flex-start;margin-top:4px" href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host)} &rarr;</a>`;
  return `<article class="lw-bc${hero ? ' lw-hero' : ''}">${top}${pic}<div class="lw-bc-in">${head ? '' : byline}${!head && date ? `<time>${esc(date)}</time>` : ''}<h3><a href="${esc(here.href)}"${here.extra}>${esc(p.title)}</a></h3>` +
    (p.excerpt ? `<p class="lw-teaser">${esc(teaser(p.excerpt, max))}</p>` : '') + action + '</div></article>';
}

export const safePostUrl = (u) => /^https:\/\//.test(u) || /^http:\/\/127\.0\.0\.1/.test(u);

export function renderBlogCards({ firmName, posts }) {
  const shown = (posts || []).slice(0, 3).filter((p) => safePostUrl(p.url));
  if (!shown.length) return '';
  return `${BLOG_CSS}<section class="lw-blog" aria-label="Latest from ${esc(firmName)}"><h2>Latest from ${esc(firmName)}</h2>` +
    `<p class="lw-blog-sub">Recent articles from the firm's own blog.</p><div class="lw-bc-grid">${shown.map((p) => cardHtml(p)).join('')}</div>` +
    `<p class="lw-note">Headlines and short excerpts come from the firm's public blog. The articles belong to ${esc(firmName)}; the full text is on their website.</p></section>`;
}
