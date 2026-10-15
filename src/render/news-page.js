// LawDB News: blog cards from member firms, newest first. Each card shows the firm, the headline, a short preview that
// opens a little wider, and a link to read the full article on the firm's own website. Text only, always escaped.
import * as C from './firm-chunks.generated.js';
import { esc, safeUrl } from './firm-page.js';
import { BLOG_CSS, cardHtml, safePostUrl } from './blog-cards.js';


// The masthead artwork, "The Press": a slowly turning gold seal with the scales of justice, and up to four of the page's own latest
// stories drifting up the right side like a newsroom. Pure SVG and CSS (no pictures to load), decorative (hidden from screen readers),
// and still for visitors who ask their device for less motion.
const SEAL = `<svg class="news-seal" viewBox="0 0 300 300" aria-hidden="true" focusable="false"><defs><path id="nwCirc" d="M150,150 m-118,0 a118,118 0 1,1 236,0 a118,118 0 1,1 -236,0"/></defs><circle cx="150" cy="150" r="140" fill="none" stroke="#e0a93a" stroke-width="2"/><circle cx="150" cy="150" r="96" fill="none" stroke="#e0a93a" stroke-width="1.2" stroke-dasharray="3 5"/><text><textPath href="#nwCirc">LAWDB NEWS &#183; CANADA'S LEGAL DIRECTORY &#183; STRAIGHT FROM THE FIRMS &#183; </textPath></text></svg>` +
  `<div class="news-sealmid" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><g fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="round"><path d="M32 10v40M20 50h24M14 20h36"/><path d="M14 20l-7 16a8 6 0 0 0 14 0zM50 20l-7 16a8 6 0 0 0 14 0z"/></g></svg></div>`;
const cutText = (t, n) => (t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : t);
function pressArt(posts) {
  const cards = posts.filter((p) => p.title).slice(0, 4).map((p, i) =>
    `<div class="news-card k${i + 1}"><small>${esc(p.firmName)}</small><b>${esc(cutText(p.title, 62))}</b></div>`).join('');
  return SEAL + (cards ? `<div class="news-drift" aria-hidden="true">${cards}</div>` : '');
}

const CSS = `<style>
/* LawDB News runs edge to edge: a dark masthead, "how it works", then the feed filling the whole screen. */
.news-band{background:#fff3d4;background-image:radial-gradient(#e9dfc6 1px,transparent 1.2px);background-size:22px 22px;color:#1f2328;padding:clamp(34px,6vw,92px) clamp(18px,4vw,72px) clamp(30px,4.5vw,64px)}
.news-eyebrow{font-size:clamp(12px,1vw,14px);font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#b45309;margin:0 0 12px}
.news-band h1{font-size:clamp(42px,7vw,104px);line-height:1;margin:0 0 clamp(12px,1.6vw,22px);color:#1f2328;letter-spacing:-.01em}.news-band h1 .u{background:linear-gradient(#e0a93a,#e0a93a) no-repeat 0 92%/0 .2em;animation:nwUnder 6s ease-in-out infinite}
.news-lede{font-family:'Source Serif 4',serif;font-size:clamp(21px,2.6vw,38px);line-height:1.25;color:#1f2328;margin:0 0 clamp(14px,1.8vw,24px);max-width:26em;text-wrap:balance}
.news-band .news-intro{font-size:clamp(16px,1.35vw,20px);line-height:1.65;color:#3f444b;max-width:40em;margin:0}
.news-stats{display:flex;flex-wrap:wrap;gap:clamp(18px,4vw,64px);margin:clamp(22px,3vw,44px) 0 0;padding-top:clamp(18px,2.4vw,32px);border-top:1px solid #e3dfd5}
.news-stats div{min-width:0}.news-stats b{display:block;font-family:'Source Serif 4',serif;font-size:clamp(34px,4.2vw,64px);line-height:1;color:#1f2328}
.news-stats span{font-size:clamp(12.5px,1vw,15px);color:#7a7266;letter-spacing:.04em}
.news-main{padding:clamp(20px,3vw,52px) clamp(16px,4vw,72px) clamp(10px,2vw,30px)}
.news-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:clamp(14px,2vw,30px);margin:0 0 clamp(22px,3vw,44px)}
.news-step{background:#fff;border:1px solid #e3dfd5;border-radius:14px;padding:clamp(18px,2vw,30px)}
.news-step i{display:inline-flex;width:clamp(34px,3vw,46px);height:clamp(34px,3vw,46px);border-radius:50%;background:#fff3d4;border:1px solid #f6dc9a;align-items:center;justify-content:center;font:700 clamp(15px,1.4vw,19px) 'Source Serif 4',serif;font-style:normal;color:#b45309;margin-bottom:12px}
.news-step h2{font-size:clamp(19px,1.7vw,25px);margin:0 0 6px}.news-step p{margin:0;font-size:clamp(15px,1.15vw,17px);line-height:1.6;color:#3f444b}
.news-people{display:flex;flex-wrap:wrap;align-items:center;gap:12px clamp(14px,2vw,28px);margin:0 0 clamp(18px,2.4vw,34px)}
.news-people h2{font-size:clamp(16px,1.3vw,19px);margin:0;color:#636870;font-family:'Inter',sans-serif;font-weight:600}
.news-people a{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#1f2328;font-weight:600;font-size:clamp(14px,1.1vw,16px)}
.news-people .lw-av{width:44px;height:44px;border-radius:50%;background:#f0ede5;border:1px solid #e3dfd5;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:700;color:#5d5f63}
.news-people .lw-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.news-chips{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 clamp(16px,2vw,28px)}
.news-chips a{padding:10px 18px;border-radius:999px;border:1px solid #e3dfd5;background:#fff;color:#3f444b;font-size:clamp(14px,1.05vw,16px);font-weight:600;text-decoration:none}
.news-chips a[aria-current="true"]{background:#1f2328;color:#fff;border-color:#1f2328}
.lw-by{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#1f2328}
.lw-by a{color:inherit;text-decoration:none}.lw-by a:hover{text-decoration:underline}
.lw-by .lw-ft{background:#b45309;color:#fff;border-radius:999px;padding:1px 7px;font-size:10.5px;letter-spacing:.03em}
/* the feed fills the screen and everything is big */
.news-main .lw-feed{grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:clamp(16px,2vw,30px)}
.news-main .lw-feed .lw-bc h3{font-size:clamp(21px,1.7vw,27px)}
.news-main .lw-feed .lw-bc p{font-size:clamp(15.5px,1.2vw,17.5px)}
.news-main .lw-feed .lw-bc-head{padding:16px 20px}
.news-main .lw-feed .lw-av{width:46px;height:46px}
.news-main .lw-feed .lw-who .lw-by{font-size:clamp(14px,1.1vw,16px)}
.news-main .lw-feed .lw-bc-in{padding:18px 20px 24px}
.news-main .lw-feed .lw-bc .lw-go{font-size:clamp(14px,1.1vw,16px);padding:12px 18px}
.news-empty{background:#fff;border:1px solid #e3dfd5;border-radius:12px;padding:26px;max-width:680px;color:#3f444b;font-size:17px;line-height:1.55}
.news-cta{margin:clamp(24px,3vw,48px) 0 0;background:#fff3d4;border-block:1px solid #f6dc9a;padding:clamp(22px,3vw,44px) clamp(16px,4vw,72px);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.news-cta b{display:block;font-family:'Source Serif 4',serif;font-size:clamp(22px,2.4vw,34px);margin-bottom:4px}
.news-cta span{font-size:clamp(15px,1.2vw,18px);color:#3f444b}
.news-cta a{background:#1f2328;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:14px 24px;font-size:clamp(15px,1.15vw,17px)}
.news-foot{padding:clamp(16px,2vw,28px) clamp(16px,4vw,72px) clamp(26px,3vw,44px);font-size:13px;color:#8d9197;line-height:1.6;max-width:70em;margin:0}

/* masthead artwork */
.news-band{position:relative;overflow:hidden;isolation:isolate}
.news-band>*:not(.news-seal):not(.news-sealmid):not(.news-drift){position:relative;z-index:3}
.news-seal,.news-sealmid{position:absolute;right:clamp(10px,6vw,110px);top:50%;width:clamp(200px,27vw,340px);aspect-ratio:1;z-index:1;pointer-events:none}
.news-seal{transform:translateY(-50%);animation:nwSpin 40s linear infinite}
.news-seal text{font:700 13.2px 'Inter',sans-serif;letter-spacing:.2em;fill:#b45309}
.news-sealmid{display:flex;align-items:center;justify-content:center;transform:translateY(-50%);animation:nwBreath 5s ease-in-out infinite}
.news-sealmid svg{width:46%;height:auto}
.news-drift{position:absolute;inset:0;z-index:2;pointer-events:none}
.news-card{position:absolute;width:clamp(170px,15vw,230px);padding:12px 14px;background:#fff;border:1px solid #e3dfd5;border-radius:12px;box-shadow:0 10px 26px rgba(90,60,10,.14);line-height:1.35;opacity:0;animation:nwRise linear infinite}
.news-card small{display:block;color:#b45309;font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:10.5px;margin-bottom:4px}
.news-card b{display:block;font:600 clamp(13.5px,1vw,15.5px)/1.25 'Source Serif 4',serif;color:#1f2328}
.news-card.k1{left:50%;--r:-3deg;animation-duration:19s}.news-card.k2{left:62%;--r:2deg;animation-duration:23s;animation-delay:-8s}.news-card.k3{left:74%;--r:-2deg;animation-duration:21s;animation-delay:-14s}.news-card.k4{left:86%;--r:3deg;animation-duration:26s;animation-delay:-4s}
@keyframes nwSpin{to{transform:translateY(-50%) rotate(360deg)}}
@keyframes nwBreath{0%,100%{transform:translateY(-50%) scale(1)}50%{transform:translateY(-50%) scale(1.05)}}
@keyframes nwRise{0%{transform:translateY(120%) rotate(var(--r));opacity:0}12%{opacity:1}85%{opacity:1}100%{transform:translateY(-140%) rotate(var(--r));opacity:0}}
@keyframes nwUnder{0%,15%{background-size:0 .2em}45%,85%{background-size:100% .2em}100%{background-size:0 .2em}}
.st-dlg{border:0;padding:0;width:min(940px,calc(100% - 32px));max-height:92dvh;border-radius:20px;background:#fff3d4;color:#1f2328;overflow:auto;margin:auto;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.st-dlg::backdrop{background:rgba(31,28,25,.62)}
.st-dlg .st{padding:clamp(18px,3vw,38px)}
.st-x{position:sticky;top:10px;float:right;margin:10px 12px 0 0;z-index:5;width:44px;height:44px;border-radius:50%;border:1px solid #e0d6bd;background:#fff;color:#1f2328;font-size:26px;line-height:1;cursor:pointer}
@media(max-width:700px){.st-dlg{width:100%;height:100dvh;max-height:100dvh;border-radius:0}}
@media(max-width:1099px){.news-drift{display:none}.news-seal,.news-sealmid{opacity:.45}}
@media(max-width:700px){.news-seal,.news-sealmid{opacity:.3;right:-70px}}
@media(prefers-reduced-motion:reduce){.news-seal,.news-sealmid,.news-card,.news-band h1 .u{animation:none!important}.news-sealmid,.news-seal{transform:translateY(-50%)}.news-card{opacity:1}.news-band h1 .u{background-size:100% .2em}}
</style>`;

// Tapping a story opens it over the page (and gives it its own address, so Back closes it and the link can be shared). Without JavaScript it is an ordinary link to the story's own page.
const STORY_JS = `(function(){var d=document.getElementById('story-dlg');if(!d||!d.showModal)return;var b=document.getElementById('story-body'),open=false;
function show(h,push){fetch(h+(h.indexOf('?')>-1?'&':'?')+'partial=1').then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(t){b.innerHTML=t;if(window.lawdbSocial)window.lawdbSocial.init(b);if(!d.open)d.showModal();d.scrollTop=0;if(push)history.pushState({story:h},'',h);open=true}).catch(function(){location.href=h})}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-story]');if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();show(a.getAttribute('href'),true)});
d.addEventListener('close',function(){if(open&&history.state&&history.state.story){open=false;history.back()}else open=false});
d.querySelector('.st-x').addEventListener('click',function(){d.close()});
d.addEventListener('click',function(e){if(e.target===d)d.close()});
window.addEventListener('popstate',function(e){if(d.open){open=false;d.close()}else if(e.state&&e.state.story){show(e.state.story,false)}});
})();`;

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
    ? `<nav class="news-chips" aria-label="Filter by firm"><a href="/news"${selected ? '' : ' aria-current="true"'}>All firms</a>${firms.map((f) =>
        `<a href="/news?firm=${esc(f.slug)}"${selected === f.slug ? ' aria-current="true"' : ''}>${esc(f.name)}</a>`).join('')}</nav>`
    : '';
  const people = firms.length
    ? `<div class="news-people"><h2>The firms writing here</h2>${firms.map((f) => `<a href="/news?firm=${esc(f.slug)}"><span class="lw-av">${avatarOf(f.logo, f.name)}</span>${esc(f.name)}</a>`).join('')}</div>`
    : '';
  const headOf = (p) => ({
    avatar: avatarOf(p.logo, p.firmName),
    who: `<span class="lw-by"><a href="/firms/${esc(p.firmSlug)}">${esc(p.firmName)}</a>${p.featured ? '<span class="lw-ft">Featured</span>' : ''}</span>`,
    action: `<button class="lw-fbtn" type="button" data-follow="${esc(p.firmSlug)}">Follow</button>`,
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
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'LawDB News', url: 'https://lawdb.ca/news', description: desc,
    isPartOf: { '@type': 'WebSite', name: 'LawDB', url: 'https://lawdb.ca/' },
    mainEntity: { '@type': 'ItemList', itemListElement: shown.filter((p) => p.storyHref).slice(0, 20).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `https://lawdb.ca${p.storyHref}`, name: p.title })) },
  };
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>LawDB News | Articles from Featured Law Firms | LawDB.ca</title>',
    `<meta name="description" content="${esc(desc)}">`,
    '<link rel="canonical" href="https://lawdb.ca/news">',
    '<meta property="og:title" content="LawDB News"><meta property="og:type" content="website"><meta property="og:url" content="https://lawdb.ca/news">' + `<meta property="og:description" content="${esc(desc)}">`,
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>',
    C.STYLE + BLOG_CSS + CSS + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n</head>',
    '<body>\n  ' + C.HEADER.replace(/<a[^>]*>Back to results<\/a>/, ''),
    '  <header class="news-band">' + pressArt(shown) + '<p class="news-eyebrow">Straight from the firms</p><h1><span class="u">LawDB News</span></h1><p class="news-lede">What Canada\'s law firms are writing, all in one place.</p>' +
    '<p class="news-intro">Every article on this page was written by a lawyer or firm you will find in the LawDB directory. We gather their latest work here so you can see how the people behind the listings think, explain and help, before you ever pick up the phone.</p>' + stats3 + '</header>',
    '  <main class="news-main">',
    '    ' + steps,
    '    ' + people,
    '    ' + chips,
    '    ' + body,
    '  </main>',
    '  <div class="news-cta"><div><b>Run a law firm?</b><span>Featured members\' blogs appear on this page, with their logo and a link back to their site.</span></div><a href="/for-firms">See how Featured works &rarr;</a></div>',
    '  <p class="news-foot">Headlines and short excerpts come from each firm\'s public blog. The articles belong to the firms that wrote them, and the full text is on their websites. LawDB is an independent directory and does not endorse any article or firm.</p>',
    '  <dialog id="story-dlg" class="st-dlg" aria-label="Story"><button class="st-x" type="button" aria-label="Close">&times;</button><div id="story-body"></div></dialog>',
    '  ' + C.FOOTER,
    '<script src="/site.js" defer></script>',
    '<script src="/follow.js" defer></script>',
    '<script>' + STORY_JS + '</script>',
    '</body>\n</html>\n',
  ].join('\n');
}
