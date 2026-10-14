// LawDB News: blog cards from member firms, newest first. Each card shows the firm, the headline, a short preview that
// opens a little wider, and a link to read the full article on the firm's own website. Text only, always escaped.
import * as C from './firm-chunks.generated.js';
import { esc, safeUrl } from './firm-page.js';
import { BLOG_CSS, cardHtml, safePostUrl } from './blog-cards.js';

const CSS = `<style>
/* LawDB News runs edge to edge: a dark masthead, "how it works", then the feed filling the whole screen. */
.news-band{background:var(--dark,#1f1c19);color:#fff;padding:clamp(34px,6vw,92px) clamp(18px,4vw,72px) clamp(30px,4.5vw,64px)}
.news-eyebrow{font-size:clamp(12px,1vw,14px);font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brass,#d9a441);margin:0 0 12px}
.news-band h1{font-size:clamp(42px,7vw,104px);line-height:1;margin:0 0 clamp(12px,1.6vw,22px);color:#fff;letter-spacing:-.01em}
.news-lede{font-family:'Source Serif 4',serif;font-size:clamp(21px,2.6vw,38px);line-height:1.25;color:var(--brass,#d9a441);margin:0 0 clamp(14px,1.8vw,24px);max-width:26em;text-wrap:balance}
.news-band .news-intro{font-size:clamp(16px,1.35vw,20px);line-height:1.65;color:#d8d2c6;max-width:46em;margin:0}
.news-stats{display:flex;flex-wrap:wrap;gap:clamp(18px,4vw,64px);margin:clamp(22px,3vw,44px) 0 0;padding-top:clamp(18px,2.4vw,32px);border-top:1px solid #38332e}
.news-stats div{min-width:0}.news-stats b{display:block;font-family:'Source Serif 4',serif;font-size:clamp(34px,4.2vw,64px);line-height:1;color:#fff}
.news-stats span{font-size:clamp(12.5px,1vw,15px);color:#aca59c;letter-spacing:.04em}
.news-main{padding:clamp(20px,3vw,52px) clamp(16px,4vw,72px) clamp(10px,2vw,30px)}
.news-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:clamp(14px,2vw,30px);margin:0 0 clamp(22px,3vw,44px)}
.news-step{background:#fff;border:1px solid #e4ded3;border-radius:14px;padding:clamp(18px,2vw,30px)}
.news-step i{display:inline-flex;width:clamp(34px,3vw,46px);height:clamp(34px,3vw,46px);border-radius:50%;background:#fbf3e3;border:1px solid #edd9ae;align-items:center;justify-content:center;font:700 clamp(15px,1.4vw,19px) 'Source Serif 4',serif;font-style:normal;color:#9a6f1c;margin-bottom:12px}
.news-step h2{font-size:clamp(19px,1.7vw,25px);margin:0 0 6px}.news-step p{margin:0;font-size:clamp(15px,1.15vw,17px);line-height:1.6;color:#4a453d}
.news-people{display:flex;flex-wrap:wrap;align-items:center;gap:12px clamp(14px,2vw,28px);margin:0 0 clamp(18px,2.4vw,34px)}
.news-people h2{font-size:clamp(16px,1.3vw,19px);margin:0;color:#6b645a;font-family:'Inter',sans-serif;font-weight:600}
.news-people a{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#2b2723;font-weight:600;font-size:clamp(14px,1.1vw,16px)}
.news-people .lw-av{width:44px;height:44px;border-radius:50%;background:#f1ece2;border:1px solid #e4ded3;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:700;color:#6b5a45}
.news-people .lw-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.news-chips{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 clamp(16px,2vw,28px)}
.news-chips a{padding:10px 18px;border-radius:999px;border:1px solid #e4ded3;background:#fff;color:#4a453d;font-size:clamp(14px,1.05vw,16px);font-weight:600;text-decoration:none}
.news-chips a[aria-current="true"]{background:#2b2723;color:#fff;border-color:#2b2723}
.lw-by{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#2b2723}
.lw-by a{color:inherit;text-decoration:none}.lw-by a:hover{text-decoration:underline}
.lw-by .lw-ft{background:#b8863b;color:#fff;border-radius:999px;padding:1px 7px;font-size:10.5px;letter-spacing:.03em}
/* the feed fills the screen and everything is big */
.news-main .lw-feed{grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:clamp(16px,2vw,30px)}
.news-main .lw-feed .lw-bc h3{font-size:clamp(21px,1.7vw,27px)}
.news-main .lw-feed .lw-bc p{font-size:clamp(15.5px,1.2vw,17.5px)}
.news-main .lw-feed .lw-bc-head{padding:16px 20px}
.news-main .lw-feed .lw-av{width:46px;height:46px}
.news-main .lw-feed .lw-who .lw-by{font-size:clamp(14px,1.1vw,16px)}
.news-main .lw-feed .lw-bc-in{padding:18px 20px 24px}
.news-main .lw-feed .lw-bc .lw-go{font-size:clamp(14px,1.1vw,16px);padding:12px 18px}
.news-empty{background:#fff;border:1px solid #e4ded3;border-radius:12px;padding:26px;max-width:680px;color:#4a453d;font-size:17px;line-height:1.55}
.news-cta{margin:clamp(24px,3vw,48px) 0 0;background:#fbf3e3;border-block:1px solid #edd9ae;padding:clamp(22px,3vw,44px) clamp(16px,4vw,72px);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.news-cta b{display:block;font-family:'Source Serif 4',serif;font-size:clamp(22px,2.4vw,34px);margin-bottom:4px}
.news-cta span{font-size:clamp(15px,1.2vw,18px);color:#4a453d}
.news-cta a{background:#2b2723;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:14px 24px;font-size:clamp(15px,1.15vw,17px)}
.news-foot{padding:clamp(16px,2vw,28px) clamp(16px,4vw,72px) clamp(26px,3vw,44px);font-size:13px;color:#8f8a80;line-height:1.6;max-width:70em;margin:0}
</style>`;

const initial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
const avatarOf = (logo, name) => {
  const l = safeUrl(logo);
  return l ? `<img src="${esc(/^https:/.test(l) || l.startsWith('/') ? l : '/' + l)}" alt="" loading="lazy" width="44" height="44">` : initial(name);
};
const fmtDay = (d) => {
  const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
};

// posts: [{ firmSlug, firmName, featured, logo, title, url, publishedAt, excerpt, image }]; firms: [{ slug, name, logo }] (people strip and filter chips)
// stats: { firms, articles, latest } for the whole page (not just the filtered view)
export function renderNewsPage({ posts, firms, selected = '', stats = null }) {
  const shown = posts.filter((p) => safePostUrl(p.url));
  const st = stats || { firms: firms.length, articles: shown.length, latest: shown[0]?.publishedAt || null };
  const chips = firms.length > 1
    ? `<nav class="news-chips" aria-label="Filter by firm"><a href="/legal-news.html"${selected ? '' : ' aria-current="true"'}>All firms</a>${firms.map((f) =>
        `<a href="/legal-news.html?firm=${esc(f.slug)}"${selected === f.slug ? ' aria-current="true"' : ''}>${esc(f.name)}</a>`).join('')}</nav>`
    : '';
  const people = firms.length
    ? `<div class="news-people"><h2>The firms writing here</h2>${firms.map((f) => `<a href="/legal-news.html?firm=${esc(f.slug)}"><span class="lw-av">${avatarOf(f.logo, f.name)}</span>${esc(f.name)}</a>`).join('')}</div>`
    : '';
  const headOf = (p) => ({
    avatar: avatarOf(p.logo, p.firmName),
    who: `<span class="lw-by"><a href="/firms/${esc(p.firmSlug)}">${esc(p.firmName)}</a>${p.featured ? '<span class="lw-ft">Featured</span>' : ''}</span>`,
  });
  // The lead story is the newest post that has a picture; the rest follow in date order.
  const lead = shown.find((p) => p.image) || null;
  const cards = (lead ? [cardHtml(lead, { head: headOf(lead), hero: true })] : [])
    .concat(shown.filter((p) => p !== lead).map((p) => cardHtml(p, { head: headOf(p) }))).join('');
  const body = shown.length
    ? `<div class="lw-bc-grid lw-feed">${cards}</div>`
    : '<div class="news-empty"><b>LawDB News is filling up.</b><br>Articles from our Featured members appear here as soon as their blogs are connected. Check back soon.</div>';
  const latest = fmtDay(st.latest);
  const stats3 = st.articles
    ? `<div class="news-stats"><div><b>${st.firms}</b><span>${st.firms === 1 ? 'FIRM WRITING' : 'FIRMS WRITING'}</span></div><div><b>${st.articles}</b><span>RECENT ARTICLES</span></div>${latest ? `<div><b>${esc(latest)}</b><span>LATEST STORY</span></div>` : ''}</div>`
    : '';
  const steps = `<div class="news-steps">
      <div class="news-step"><i>1</i><h2>The firms write</h2><p>Our Featured members publish on their own websites, in their own words. These are real lawyers explaining real situations.</p></div>
      <div class="news-step"><i>2</i><h2>We bring it together</h2><p>LawDB collects each new headline, date and short preview and keeps them in one feed, so you don't have to visit ten websites.</p></div>
      <div class="news-step"><i>3</i><h2>You read the real thing</h2><p>Tap any story to read the full article on the firm's own site, and contact the firm directly if it speaks to your situation.</p></div>
    </div>`;
  const desc = 'Articles from Featured law firms on LawDB: short previews with a link to read the full article on each firm\'s own website.';
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>LawDB News | Articles from Featured Law Firms | LawDB.ca</title>',
    `<meta name="description" content="${esc(desc)}">`,
    '<link rel="canonical" href="https://lawdb.ca/legal-news.html">',
    '<meta property="og:title" content="LawDB News"><meta property="og:type" content="website"><meta property="og:url" content="https://lawdb.ca/legal-news.html">' + `<meta property="og:description" content="${esc(desc)}">`,
    C.STYLE + BLOG_CSS + CSS + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n</head>',
    '<body>\n  ' + C.HEADER.replace(/<a[^>]*>Back to results<\/a>/, ''),
    '  <header class="news-band"><p class="news-eyebrow">Straight from the firms</p><h1>LawDB News</h1><p class="news-lede">What Canada\'s law firms are writing, all in one place.</p>' +
    '<p class="news-intro">Every article on this page was written by a lawyer or firm you will find in the LawDB directory. We gather their latest work here so you can see how the people behind the listings think, explain and help, before you ever pick up the phone.</p>' + stats3 + '</header>',
    '  <main class="news-main">',
    '    ' + steps,
    '    ' + people,
    '    ' + chips,
    '    ' + body,
    '  </main>',
    '  <div class="news-cta"><div><b>Run a law firm?</b><span>Featured members\' blogs appear on this page, with their logo and a link back to their site.</span></div><a href="/for-firms.html">See how Featured works &rarr;</a></div>',
    '  <p class="news-foot">Headlines and short excerpts come from each firm\'s public blog. The articles belong to the firms that wrote them, and the full text is on their websites. LawDB is an independent directory and does not endorse any article or firm.</p>',
    '  ' + C.FOOTER,
    '<script src="/site.js" defer></script>',
    '</body>\n</html>\n',
  ].join('\n');
}
