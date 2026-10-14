// "Latest from the firm's blog": clean cards with a headline, date and a short excerpt that opens a little wider,
// and a link to the full article on the firm's own website. Text only, always escaped; nothing from the feed is trusted as HTML.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

export const BLOG_CSS = `<style>
.lw-blog{margin:26px 0}
.lw-blog h2{font-size:18px;margin:0 0 4px}
.lw-blog .lw-blog-sub{margin:0 0 12px;color:#6b645a;font-size:13px}
.lw-bc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.lw-bc{background:#fff;border:1px solid #e4ded3;border-radius:10px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:6px}
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
</style>`;

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(String(d).replace(' ', 'T') + 'Z');
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const teaser = (s) => {
  if (s.length <= 170) return s;
  const t = s.slice(0, 170);
  return t.slice(0, Math.max(t.lastIndexOf(' '), 130)).replace(/[\s,;:.\-]+$/, '') + '...';
};

// One card. `byline` (optional) names the firm, for the News page where cards from many firms sit together.
export function cardHtml(p, { byline = '' } = {}) {
  let host = '';
  try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch {}
  const more = p.excerpt && p.excerpt.length > 170;
  const date = fmtDate(p.publishedAt);
  return `<article class="lw-bc">${byline}${date ? `<time>${esc(date)}</time>` : ''}<h3><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>` +
    (p.excerpt ? `<p class="lw-teaser">${esc(teaser(p.excerpt))}</p>` : '') +
    (more
      ? `<details><summary>Read more</summary><p class="lw-more">${esc(p.excerpt)}</p><a class="lw-go" href="${esc(p.url)}" target="_blank" rel="noopener">Read the full article on ${esc(host)} &rarr;</a></details>`
      : `<a class="lw-go" style="align-self:flex-start;margin-top:4px" href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host)} &rarr;</a>`) +
    '</article>';
}

export const safePostUrl = (u) => /^https:\/\//.test(u) || /^http:\/\/127\.0\.0\.1/.test(u);

export function renderBlogCards({ firmName, posts }) {
  const shown = (posts || []).slice(0, 3).filter((p) => safePostUrl(p.url));
  if (!shown.length) return '';
  return `${BLOG_CSS}<section class="lw-blog" aria-label="Latest from ${esc(firmName)}"><h2>Latest from ${esc(firmName)}</h2>` +
    `<p class="lw-blog-sub">Recent articles from the firm's own blog.</p><div class="lw-bc-grid">${shown.map((p) => cardHtml(p)).join('')}</div>` +
    `<p class="lw-note">Headlines and short excerpts come from the firm's public blog. The articles belong to ${esc(firmName)}; the full text is on their website.</p></section>`;
}
