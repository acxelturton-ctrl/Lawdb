// LawDB News: blog cards from member firms, newest first. Each card shows the firm, the headline, a short preview that
// opens a little wider, and a link to read the full article on the firm's own website. Text only, always escaped.
import * as C from './firm-chunks.generated.js';
import { esc, safeUrl } from './firm-page.js';
import { BLOG_CSS, cardHtml, safePostUrl } from './blog-cards.js';


const CSS = `<style>
/* LawDB News: a cream page with a serif headline, three numbers, how it works, who is writing, then the feed as picture-and-text cards. */
.news-band{max-width:1440px;margin:0 auto;box-sizing:border-box;color:#142434;padding:clamp(16px,5vw,64px) clamp(16px,4vw,72px) clamp(6px,1.5vw,20px);background:radial-gradient(ellipse at 18% 0%,rgba(255,255,255,.6),rgba(255,255,255,0) 62%)}
.news-eyebrow{display:flex;align-items:center;gap:14px;max-width:300px;margin:0 0 clamp(10px,1.6vw,16px);font:700 clamp(10.5px,1vw,12px)/1 'Inter',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#e2bd6a}
.news-eyebrow::after{content:'';flex:1;height:1px;background:#e6d4a4}
.news-band h1{font-family:'Source Serif 4',serif;font-size:clamp(34px,8.6vw,84px);line-height:1.02;margin:0 0 8px;color:#142434;letter-spacing:-.02em;font-weight:700}
.news-lede{font-family:'Source Serif 4',serif;font-size:clamp(14px,3.4vw,34px);line-height:1.3;color:#142434;margin:0 0 clamp(10px,1.8vw,18px);font-weight:600}
.news-lede em{font-style:italic;font-weight:500;color:#e2bd6a}
.news-band .news-intro{font-size:clamp(13.5px,1.3vw,19px);line-height:1.55;color:#586170;max-width:40em;margin:0}
.news-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));max-width:760px;margin:clamp(16px,3vw,40px) 0 0}
.news-stats div{min-width:0;padding:4px clamp(8px,2vw,28px);border-left:1px solid #e3dfd3}
.news-stats div:first-child{padding-left:0;border-left:0}
.news-stats b{display:block;font-family:'Source Serif 4',serif;font-size:clamp(22px,5.6vw,52px);line-height:1;color:#e2bd6a;font-weight:600}
.news-stats span{display:block;margin-top:6px;font:600 clamp(9.5px,2.4vw,11.5px)/1.3 'Inter',sans-serif;letter-spacing:.12em;color:#586170}
.news-main{max-width:1440px;margin:0 auto;box-sizing:border-box;padding:clamp(16px,3vw,44px) clamp(16px,4vw,72px) clamp(10px,2vw,30px)}
/* how it works */
.news-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 clamp(20px,3.5vw,48px)}
.news-steps .news-step:nth-child(3){grid-column:1/-1}
@media(min-width:900px){.news-steps{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.news-steps .news-step:nth-child(3){grid-column:auto}}
a.news-step{position:relative;display:block;background:rgba(255,255,255,.78);border:1px solid #e3dfd3;border-radius:14px;padding:clamp(11px,1.6vw,16px) clamp(26px,3vw,36px) clamp(12px,1.8vw,18px) clamp(11px,1.6vw,16px);color:inherit;text-decoration:none;box-shadow:0 10px 24px -18px rgba(20,36,52,0.45)}
a.news-step:hover{border-color:#c9a050}
.news-step .ns-top{display:flex;align-items:center;gap:8px;margin:0 0 clamp(7px,1vw,12px)}
.news-step i{flex:none;display:inline-flex;width:clamp(24px,2.6vw,30px);height:clamp(24px,2.6vw,30px);border-radius:50%;background:#f4ecd8;align-items:center;justify-content:center;font:700 clamp(12px,1.2vw,14px) 'Source Serif 4',serif;font-style:normal;color:#e2bd6a}
.news-step .ns-ic{flex:none;color:#e2bd6a;width:clamp(19px,2vw,24px);height:clamp(19px,2vw,24px)}
.news-step small{font:700 clamp(9px,.9vw,10.5px)/1.25 'Inter',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#e2bd6a}
.news-step h2{font-family:'Source Serif 4',serif;font-size:clamp(15.5px,1.8vw,24px);line-height:1.2;margin:0 0 4px;color:#142434}
.news-step p{margin:0;font-size:clamp(12px,1.1vw,16px);line-height:1.5;color:#586170}
.news-step .ns-go{position:absolute;top:clamp(14px,1.6vw,20px);right:clamp(8px,1.2vw,14px);width:16px;height:16px;color:#8a919b}
/* who is writing */
.news-people{margin:0 0 clamp(16px,3vw,36px)}
.news-people h2{display:flex;align-items:center;gap:14px;margin:0 0 clamp(12px,1.6vw,18px);font:600 clamp(17px,2vw,26px)/1.2 'Source Serif 4',serif;color:#142434}
.news-people h2::after{content:'';flex:0 0 clamp(56px,16vw,200px);height:1px;background:#c9a050}
.news-faces{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px 4px}
@media(min-width:700px){.news-faces{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:20px 10px}}
.news-faces a{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0;text-align:center;text-decoration:none;color:#142434;font:500 10px/1.3 'Inter',sans-serif}
@media(min-width:700px){.news-faces a{font-size:13px}}
.news-faces a span.nm{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word}
.news-people .lw-av{width:clamp(34px,9vw,60px);height:clamp(34px,9vw,60px);border-radius:50%;background:#edeae1;border:1px solid #e3dfd3;display:flex;align-items:center;justify-content:center;overflow:hidden;font:700 18px 'Source Serif 4',serif;color:#586170}
.news-people .lw-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.news-people .news-more{display:flex;justify-content:flex-end;margin:8px 0 0;font:600 clamp(12px,1.1vw,14px) 'Inter',sans-serif;color:#e2bd6a;text-decoration:none}
.news-people .news-more:hover{text-decoration:underline}
/* the firm filter */
.news-filter{margin:0 0 clamp(12px,2vw,26px)}
.news-pick{position:relative;display:flex;align-items:center;gap:10px;width:100%;max-width:520px;min-height:clamp(40px,4vw,50px);padding:0 14px;box-sizing:border-box;border:1px solid #e3dfd3;border-radius:26px;background:rgba(255,255,255,.82);font:500 clamp(12.5px,1.1vw,14px) 'Inter',sans-serif;color:#586170;cursor:pointer}
.news-pick svg{flex:none;color:#e2bd6a}
.news-pick b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#142434;font-weight:600}
.news-pick select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px}
.news-pick:focus-within{border-color:#c9a050;box-shadow:0 0 0 3px rgba(201,160,80,0.3)}
.news-filter a{display:inline-block;margin:10px 0 0 4px;color:#e2bd6a;font-weight:600;font-size:14px}
.lw-by{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#142434}
.lw-by a{color:inherit;text-decoration:none}.lw-by a:hover{text-decoration:underline}
.lw-by .lw-ft{background:#e2bd6a;color:#142434;border-radius:999px;padding:1px 7px;font-size:10.5px;letter-spacing:.03em}
/* the feed: a post header, then the picture on the left and the story on the right */
.news-main .lw-feed{grid-template-columns:1fr;gap:14px}
@media(min-width:1000px){.news-main .lw-feed{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}
.news-main .lw-feed .lw-bc{position:relative;display:grid;grid-template-columns:minmax(100px,38%) minmax(0,1fr);grid-template-areas:"head head" "img body";gap:10px 12px;align-items:start;padding:clamp(11px,1.4vw,14px);border-radius:16px;background:rgba(255,255,255,.86);box-shadow:0 12px 26px -18px rgba(20,36,52,0.5)}
.news-main .lw-feed .lw-bc:not(:has(.lw-bc-img)){grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "body"}
.news-main .lw-feed .lw-bc-head{grid-area:head;padding:0}
.news-main .lw-feed .lw-av{width:clamp(30px,3vw,40px);height:clamp(30px,3vw,40px)}
.news-main .lw-feed .lw-who .lw-by{font-size:clamp(12.5px,1.1vw,14px);font-weight:600;flex-wrap:wrap;gap:3px 8px}
.news-main .lw-feed .lw-who time{font-size:clamp(11px,1vw,12.5px);color:#586170}
.news-main .lw-feed .lw-bc-head .lw-fbtn{padding:4px 11px;border-radius:999px;background:#f4ecd8;color:#e2bd6a;font-size:12px}
.news-main .lw-feed .lw-bc-img{grid-area:img;aspect-ratio:4/3;border-radius:12px}
.news-main .lw-feed .lw-bc-in{grid-area:body;position:relative;min-width:0;padding:0 24px 0 0;gap:6px}
.news-main .lw-feed .lw-bc:has(.lw-ft) .lw-bc-in::before{content:'Featured';font:700 9.5px/1.2 'Inter',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#e2bd6a}
.news-main .lw-feed .lw-bc h3{font:700 clamp(15.5px,1.5vw,20px)/1.28 'Source Serif 4',serif;color:#142434}
.news-main .lw-feed .lw-bc p{font-size:clamp(12.5px,1.05vw,14px);line-height:1.5;color:#586170;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.news-main .lw-feed .lw-row{margin-top:2px}
.news-main .lw-feed .lw-bc .lw-go{position:absolute;right:0;top:50%;transform:translateY(-50%);width:22px;height:32px;padding:0;background:none;border-radius:0;font-size:0;color:#8a919b}
.news-main .lw-feed .lw-bc .lw-go::after{content:'\\203A';font-size:30px;line-height:30px;color:#8a919b}
@media(hover:hover){.news-main .lw-feed .lw-bc:hover .lw-go::after{color:#e2bd6a}}
.news-empty{background:#fff;border:1px solid #e3dfd3;border-radius:12px;padding:26px;max-width:680px;color:#2b3a4c;font-size:17px;line-height:1.55}
.news-cta{margin:clamp(24px,3vw,48px) 0 0;background:#f4ecd8;border-block:1px solid #e6d4a4;padding:clamp(22px,3vw,44px) clamp(16px,4vw,72px);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.news-cta b{display:block;font-family:'Source Serif 4',serif;font-size:clamp(22px,2.4vw,34px);margin-bottom:4px}
.news-cta span{font-size:clamp(15px,1.2vw,18px);color:#2b3a4c}
.news-cta a{background:#142434;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:14px 24px;font-size:clamp(15px,1.15vw,17px)}
.news-foot{padding:clamp(16px,2vw,28px) clamp(16px,4vw,72px) clamp(26px,3vw,44px);font-size:13px;color:#8a919b;line-height:1.6;max-width:70em;margin:0}
</style>`;

// The story that opens over the page (also used by the home page news feed).
export const DIALOG_CSS = `<style>
.st-dlg{border:0;padding:0;width:min(940px,calc(100% - 32px));max-height:92dvh;border-radius:20px;background:#f5f3ec;color:#142434;overflow:auto;margin:auto;box-shadow:0 30px 80px rgba(20,36,52,0.35)}
.st-dlg::backdrop{background:rgba(27,36,45,0.62)}
.st-dlg .st{padding:clamp(18px,3vw,38px)}
.st-x{position:sticky;top:10px;float:right;margin:10px 12px 0 0;z-index:5;width:44px;height:44px;border-radius:50%;border:1px solid #e3dfd3;background:#fff;color:#142434;font-size:26px;line-height:1;cursor:pointer}
@media(max-width:700px){.st-dlg{width:100%;height:100dvh;max-height:100dvh;border-radius:0}}
</style>`;

// Tapping a story opens it over the page (and gives it its own address, so Back closes it and the link can be shared). Without JavaScript it is an ordinary link to the story's own page.
export const STORY_JS = `(function(){var d=document.getElementById('story-dlg');if(!d||!d.showModal)return;var b=document.getElementById('story-body'),open=false;
function show(h,push){fetch(h+(h.indexOf('?')>-1?'&':'?')+'partial=1').then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(t){b.innerHTML=t;if(window.lawdbSocial)window.lawdbSocial.init(b);if(!d.open)d.showModal();d.scrollTop=0;if(push)history.pushState({story:h},'',h);open=true}).catch(function(){location.href=h})}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-story]');if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();show(a.getAttribute('href'),true)});
d.addEventListener('close',function(){if(open&&history.state&&history.state.story){open=false;history.back()}else open=false});
d.querySelector('.st-x').addEventListener('click',function(){d.close()});
d.addEventListener('click',function(e){if(e.target===d)d.close()});
window.addEventListener('popstate',function(e){if(d.open){open=false;d.close()}else if(e.state&&e.state.story){show(e.state.story,false)}});
})();`;

export const dialogHtml = '<dialog id="story-dlg" class="st-dlg" aria-label="Story"><button class="st-x" type="button" aria-label="Close">&times;</button><div id="story-body"></div></dialog>';

const initial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
const avatarOf = (logo, name) => {
  const l = safeUrl(logo);
  return l ? `<img src="${esc(/^https:/.test(l) || l.startsWith('/') ? l : '/' + l)}" alt="" loading="lazy" width="44" height="44">` : initial(name);
};
// A post's header on a card: the firm's logo (or initial), its name with the Featured badge, and a Follow button.
const headOf = (p) => ({
  avatar: avatarOf(p.logo, p.firmName),
  who: `<span class="lw-by"><a href="/firms/${esc(p.firmSlug)}">${esc(p.firmName)}</a>${p.featured ? '<span class="lw-ft">Featured</span>' : ''}</span>`,
  action: `<button class="lw-fbtn" type="button" data-follow="${esc(p.firmSlug)}">Follow</button>`,
});

// The cards of a feed, as HTML. With `lead`, the newest post that has a picture leads as one large card.
export function newsCardsHtml(posts, { lead = false } = {}) {
  const shown = posts.filter((p) => safePostUrl(p.url));
  const first = lead ? shown.find((p) => p.image) || null : null;
  return (first ? [cardHtml(first, { head: headOf(first), hero: true })] : []).concat(shown.filter((p) => p !== first).map((p) => cardHtml(p, { head: headOf(p) }))).join('');
}

const fmtDay = (d) => {
  const t = d ? new Date(String(d).replace(' ', 'T') + 'Z') : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
};

// posts: [{ firmSlug, firmName, featured, logo, title, url, publishedAt, excerpt, image }]; firms: [{ slug, name, logo }] (people strip and filter chips)
// stats: { firms, articles, latest } for the whole page (not just the filtered view)
export function renderNewsPage({ posts, firms, people: strip = null, selected = '', stats = null }) {
  const shown = posts.filter((p) => safePostUrl(p.url));
  const st = stats || { firms: firms.length, articles: shown.length, latest: shown[0]?.publishedAt || null };
  const ICON = { filter: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    go: '<svg class="ns-go" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>' };
  const pickedName = (firms.find((f) => f.slug === selected) || {}).name;
  const chips = firms.length > 1
    ? `<form class="news-filter" method="get" action="/news" aria-label="Filter by firm"><label class="news-pick" for="news-firm">${ICON.filter}<span>Show articles from</span><b>${pickedName ? esc(pickedName) : `All ${firms.length} firms`}</b>${ICON.down}<select id="news-firm" name="firm" onchange="this.form.submit()"><option value="">All ${firms.length} firms</option>${firms.map((f) =>
        `<option value="${esc(f.slug)}"${selected === f.slug ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label><noscript><button type="submit">Show</button></noscript>${selected ? '<a href="/news">Show all firms</a>' : ''}</form>`
    : '';
  const faces = strip || firms.slice(0, 15);
  const people = faces.length
    ? `<section class="news-people" id="firms"><h2>The firms writing here</h2><div class="news-faces">${faces.map((f) => `<a href="/news?firm=${esc(f.slug)}"><span class="lw-av">${avatarOf(f.logo, f.name)}</span><span class="nm">${esc(f.name)}</span></a>`).join('')}</div>${firms.length > faces.length ? `<a class="news-more" href="#news-firm">and ${firms.length - faces.length} more &rsaquo;</a>` : ''}</section>`
    : '';
  const cards = newsCardsHtml(shown);
  const body = shown.length
    ? `<div class="lw-bc-grid lw-feed" id="feed">${cards}</div>`
    : '<div class="news-empty"><b>LawDB News is filling up.</b><br>Articles from the firms listed on LawDB appear here as soon as their blogs are found. Check back soon.</div>';
  const latest = fmtDay(st.latest);
  const stats3 = st.articles
    ? `<div class="news-stats"><div><b>${st.firms}</b><span>${st.firms === 1 ? 'FIRM WRITING' : 'FIRMS WRITING'}</span></div><div><b>${st.articles}</b><span>RECENT ARTICLES</span></div>${latest ? `<div><b>${esc(latest)}</b><span>LATEST STORY</span></div>` : ''}</div>`
    : '';
  const step = (n, href, icon, label, title, text) => `<a class="news-step" href="${href}"><div class="ns-top"><i>${n}</i><svg class="ns-ic" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><small>${label}</small></div><h2>${title}</h2><p>${text}</p>${ICON.go}</a>`;
  const steps = `<div class="news-steps">
      ${step(1, '#firms', '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>', 'Legal insights', 'The firms write', 'Law firms listed on LawDB publish on their own websites, in their own words. These are real lawyers explaining real situations.')}
      ${step(2, '#news-firm', '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.9.3 5 2.6 5 5.8"/>', 'Firm updates', 'We bring it together', 'LawDB collects each new headline, date and short preview and keeps them in one feed, so you don\'t have to visit ten websites.')}
      ${step(3, '#feed', '<path d="M3 5.5C5 4.4 8 4.4 12 6.5c4-2.1 7-2.1 9-1v13c-2-1.1-5-1.1-9 1-4-2.1-7-2.1-9-1z"/><path d="M12 6.5v13"/>', 'Read &amp; learn', 'You read the real thing', 'Tap any story to read the full article on the firm\'s own site, and contact the firm directly if it speaks to your situation.')}
    </div>`;
  const desc = 'Articles from Canadian law firms listed on LawDB: short previews with a link to read the full article on each firm\'s own website.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'LawDB News', url: 'https://lawdb.ca/news', description: desc,
    isPartOf: { '@type': 'WebSite', name: 'LawDB', url: 'https://lawdb.ca/' },
    mainEntity: { '@type': 'ItemList', itemListElement: shown.filter((p) => p.storyHref && p.indexable !== false).slice(0, 20).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `https://lawdb.ca${p.storyHref}`, name: p.title })) },
  };
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>LawDB News | Articles from Canadian Law Firms | LawDB.ca</title>',
    `<meta name="description" content="${esc(desc)}">`,
    '<link rel="canonical" href="https://lawdb.ca/news">',
    '<meta property="og:title" content="LawDB News"><meta property="og:type" content="website"><meta property="og:url" content="https://lawdb.ca/news">' + `<meta property="og:description" content="${esc(desc)}">`,
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>',
    C.STYLE + BLOG_CSS + CSS + DIALOG_CSS + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n</head>',
    '<body>\n  ' + C.HEADER.replace(/<a[^>]*>Back to results<\/a>/, ''),
    '  <header class="news-band"><p class="news-eyebrow">News &amp; insights</p><h1><span class="u">LawDB News</span></h1><p class="news-lede">Real stories. Practical advice. <em>All in one place.</em></p>' +
    '<p class="news-intro">Stay informed with the latest legal news, helpful articles and expert insights from the lawyers and firms listed on LawDB. Every article is written by the firm that publishes it; we gather them here so you can understand a complex topic before you pick up the phone.</p>' + stats3 + '</header>',
    '  <main class="news-main">',
    '    ' + steps,
    '    ' + people,
    '    ' + chips,
    '    ' + body,
    '  </main>',
    '  <div class="news-cta"><div><b>Run a law firm?</b><span>If your website has a blog, LawDB finds it and shows your latest articles here, free, with your logo and a link back to your site. Featured members also get a badge on every story.</span></div><a href="/for-firms">For law firms &rarr;</a></div>',
    '  <p class="news-foot">Headlines and short excerpts come from each firm\'s public blog. The articles belong to the firms that wrote them, and the full text is on their websites. LawDB is an independent directory and does not endorse any article or firm.</p>',
    '  <dialog id="story-dlg" class="st-dlg" aria-label="Story"><button class="st-x" type="button" aria-label="Close">&times;</button><div id="story-body"></div></dialog>',
    '  ' + C.FOOTER,
    '<script src="/site.js" defer></script>',
    '<script src="/follow.js" defer></script>',
    '<script>' + STORY_JS + '</script>',
    '</body>\n</html>\n',
  ].join('\n');
}
