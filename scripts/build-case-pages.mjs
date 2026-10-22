// Builds the national case-type guide pages (/family-lawyers, /criminal-defence-lawyers ... ten of them) from data/case-types.json, the
// case-type tiles in the hero of /find-lawyers (between <!--case-cards--> markers) and the "Or pick a case type" list on the
// home page (index.html, between <!--home-cases--> markers; the icons are symbols in the page's own sprite). Each guide is answer-first, general
// information about one kind of case, with plain links down to every province page and city page that exists for it, so the national page,
// the province page and the city page of a case type form one chain: /family-lawyers -> /ontario/family-lawyers -> /ontario/toronto/family-lawyers.
//   node scripts/build-case-pages.mjs          rewrites the pages and the cards
//   node scripts/build-case-pages.mjs --check  fails if anything is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const DATA = JSON.parse(readFileSync('data/case-types.json', 'utf8'));
const TYPES = Object.entries(DATA.types);
const SHELL = readFileSync('scripts/case-page.shell.html', 'utf8');
const SITE = 'https://lawdb.ca';
const PROVINCES = [['ontario', 'Ontario'], ['quebec', 'Quebec'], ['british-columbia', 'British Columbia'], ['alberta', 'Alberta'], ['manitoba', 'Manitoba']];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const indexable = (html) => !/<meta[^>]+name="robots"[^>]+noindex/i.test(html);
const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// the province pages and city pages that exist (and are indexable) for one case type, with the heading each page uses
function pagesFor(slug) {
  const out = [];
  for (const [dir, name] of PROVINCES) {
    const h1Of = (file) => {
      if (!existsSync(file)) return null;
      const html = readFileSync(file, 'utf8');
      const h = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return h && indexable(html) ? unesc(h[1].trim()) : null;
    };
    const prov = h1Of(`${dir}/${slug}.html`);
    const cities = [];
    if (existsSync(dir)) {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || !existsSync(`${dir}/${d.name}/index.html`)) continue;
        const hub = readFileSync(`${dir}/${d.name}/index.html`, 'utf8').match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
        const label = h1Of(`${dir}/${d.name}/${slug}.html`);
        if (hub && label) cities.push({ city: unesc(hub[1]), label, href: `/${dir}/${d.name}/${slug}` });
      }
    }
    cities.sort((a, b) => a.city.localeCompare(b.city, 'en'));
    if (prov || cities.length) out.push({ dir, name, prov: prov ? { label: prov, href: `/${dir}/${slug}` } : null, cities });
  }
  return out;
}

const EXTRA_CSS = `<style>
  /* the guide reads like a blog post: a headline, a photo, one readable column and a sticky side card (palette colours only) */
  .cg-wrap{ max-width:1100px; margin:0 auto; padding:0 20px; }
  .cg-top{ background:#f5f3ec; padding:26px 0 0; }
  .cg-crumb{ margin:0 0 18px; font-size:12.5px; color:#586170; }
  .cg-crumb a{ color:#8a6224; text-decoration:none; }
  .cg-eyebrow{ margin:0 0 10px; font:600 12px/1.6 Inter,sans-serif; letter-spacing:.2em; text-transform:uppercase; color:#8a6224; }
  .cg-top h1{ margin:0 0 14px; font:700 clamp(32px,6.6vw,54px)/1.08 'Source Serif 4',serif; letter-spacing:-.01em; color:#142434; max-width:17em; text-wrap:balance; }
  .cg-meta{ display:flex; flex-wrap:wrap; gap:4px 16px; margin:0; padding:0; list-style:none; font:500 13.5px/1.5 Inter,sans-serif; color:#586170; }
  .cg-feature{ margin:24px 0 0; }
  .cg-feature img{ display:block; width:100%; height:auto; aspect-ratio:4 / 3; object-fit:cover; object-position:50% 60%; border-radius:22px; }
  .cg-layout{ max-width:1100px; margin:0 auto; padding:30px 20px 10px; display:grid; grid-template-columns:minmax(0,1fr); gap:30px; }
  .cg-article{ font-size:17px; line-height:1.75; color:#2b3a4c; min-width:0; }
  .cg-lede{ margin:0 0 22px; font:400 clamp(19px,2.4vw,22px)/1.6 'Source Serif 4',serif; color:#142434; }
  .cg-cta{ display:flex; flex-wrap:wrap; align-items:center; gap:12px 22px; margin:0 0 6px; }
  .cg-btn{ display:inline-flex; align-items:center; justify-content:center; min-height:52px; padding:0 28px; border-radius:999px; background:linear-gradient(180deg,#e2bd6a 0%,#c9a050 100%); color:#142434; font:600 16.5px Inter,sans-serif; text-decoration:none; box-shadow:0 8px 20px rgba(20,36,52,0.2); }
  .cg-btn:hover{ background:#e2bd6a; }
  .cg-jump{ color:#8a6224; font:600 15px Inter,sans-serif; text-decoration:none; }
  .cg-jump:hover{ text-decoration:underline; }
  .cg-article h2{ margin:46px 0 14px; font:700 clamp(24px,3.4vw,30px)/1.2 'Source Serif 4',serif; color:#142434; text-wrap:balance; scroll-margin-top:84px; }
  .cg-article h2::before{ content:''; display:block; width:44px; height:3px; margin:0 0 14px; background:#c9a050; }
  .cg-list{ list-style:none; margin:0; padding:0; }
  .cg-list li{ position:relative; margin:0 0 12px; padding-left:34px; }
  .cg-list li::before{ content:'\\2713'; position:absolute; left:0; top:4px; width:22px; height:22px; border-radius:50%; background:#f4ecd8; color:#8a6224; font:700 12px/22px Inter,sans-serif; text-align:center; }
  ol.cg-list{ counter-reset:q; }
  ol.cg-list li{ counter-increment:q; }
  ol.cg-list li::before{ content:counter(q); background:#c9a050; color:#142434; }
  .cg-note{ margin:34px 0 0; padding:22px 24px; background:#f4ecd8; border:1px solid #e6d4a4; border-left:5px solid #c9a050; border-radius:18px; }
  .cg-note h2{ margin:0 0 10px; font-size:22px; }
  .cg-note h2::before{ display:none; }
  .cg-note p{ margin:0; }
  .cg-figure{ margin:36px 0 0; }
  .cg-figure img{ display:block; width:100%; height:auto; border-radius:20px; }
  .cg-figure figcaption{ margin:10px 4px 0; font-size:13.5px; line-height:1.55; color:#586170; }
  .cg-faq details{ background:#fff; border:1px solid #e3dfd3; border-radius:14px; margin:0 0 8px; }
  .cg-faq summary{ cursor:pointer; padding:15px 18px; font:600 15.5px/1.45 Inter,sans-serif; color:#142434; }
  .cg-faq details[open] summary{ color:#8a6224; }
  .cg-faq p{ margin:0; padding:0 18px 16px; font-size:15.5px; line-height:1.7; }
  .cg-side{ display:none; }
  .cg-card{ background:#fff; border:1px solid #e3dfd3; border-radius:20px; padding:22px; }
  .cg-card h2{ margin:0 0 6px; font:700 19px/1.25 'Source Serif 4',serif; color:#142434; }
  .cg-card h2::before{ display:none; }
  .cg-card p{ margin:0 0 14px; font-size:14.5px; line-height:1.55; color:#586170; }
  .cg-card .cg-btn{ width:100%; min-height:48px; font-size:15.5px; }
  .cg-toc{ list-style:none; margin:0; padding:0; font-size:14.5px; line-height:1.4; }
  .cg-toc li{ margin:0; border-top:1px solid #e3dfd3; }
  .cg-toc li:first-child{ border-top:0; }
  .cg-toc a{ display:block; padding:9px 0; color:#142434; text-decoration:none; font-weight:500; }
  .cg-toc a:hover{ color:#8a6224; }
  .cg-after{ max-width:1100px; margin:0 auto; padding:0 20px 64px; display:grid; gap:34px; }
  .cg-after h2{ margin:0 0 14px; font:700 clamp(22px,3vw,26px)/1.25 'Source Serif 4',serif; color:#142434; }
  .cg-where > p{ margin:-6px 0 16px; font-size:15px; color:#586170; }
  .cg-provs{ background:#fff; border:1px solid #e3dfd3; border-radius:20px; padding:2px 20px; }
  .cg-prov{ display:grid; grid-template-columns:minmax(0,1fr); gap:10px; padding:16px 0; border-top:1px solid #e3dfd3; }
  .cg-prov:first-child{ border-top:0; }
  .cg-prov h3{ margin:0; font:700 17px/1.3 'Source Serif 4',serif; }
  .cg-prov h3 a{ color:#142434; text-decoration:none; border-bottom:2px solid #e6d4a4; }
  .cg-prov h3 a:hover{ border-bottom-color:#c9a050; }
  .cg-pills, .cg-chips{ display:flex; flex-wrap:wrap; gap:7px; }
  .cg-pills a, .cg-chips a{ display:inline-block; padding:7px 13px; border:1px solid #e3dfd3; border-radius:999px; background:#f5f3ec; color:#142434; font:600 13.5px/1.3 Inter,sans-serif; text-decoration:none; }
  .cg-chips a{ background:#fff; }
  .cg-pills a:hover, .cg-chips a:hover{ background:#f4ecd8; border-color:#c9a050; }
  .cg-small{ margin:0; font-size:12.5px; line-height:1.6; color:#586170; }
  .cg-small a{ color:#8a6224; }
  @media(min-width:760px){
    .cg-meta li + li::before{ content:'\\00b7'; margin-right:16px; color:#8a919b; }
    .cg-top{ padding-top:34px; }
    .cg-feature img{ aspect-ratio:2 / 1; }
    .cg-layout{ padding-top:40px; }
    .cg-prov{ grid-template-columns:minmax(0,290px) minmax(0,1fr); gap:28px; align-items:center; }
    .cg-provs{ padding:4px 28px; }
  }
  @media(min-width:1000px){
    .cg-layout{ grid-template-columns:minmax(0,700px) 300px; justify-content:space-between; gap:56px; padding:46px 32px 10px; }
    .cg-wrap, .cg-after{ padding-left:32px; padding-right:32px; }
    .cg-side{ display:grid; gap:16px; align-content:start; position:sticky; top:84px; align-self:start; }
  }
</style>`;

function pageHtml([id, t]) {
  const url = `${SITE}/${t.slug}`;
  const title = `${t.h1} | LawDB.ca`;
  const pages = pagesFor(t.slug);
  const crumbName = `${t.name} Lawyers`;
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: t.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const pageLd = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url, description: t.description, dateModified: DATA.updated, isPartOf: { '@type': 'WebSite', name: 'LawDB.ca', url: `${SITE}/` } };
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Find a lawyer', item: `${SITE}/find-lawyers` },
    { '@type': 'ListItem', position: 3, name: crumbName, item: url }] };
  const ld = [pageLd, crumbLd, faqLd].map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 1)}\n</script>`).join('\n');
  const head = [
    '<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/images/apple-touch-icon.png">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(t.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:site_name" content="LawDB.ca"><meta property="og:locale" content="en_CA">`,
    `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(t.description)}">`,
    `<meta property="og:image" content="${SITE}/images/og-default.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`,
    ld, EXTRA_CSS].join('\n');

  const list = (items, tag = 'ul') => `<${tag} class="cg-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
  // one block per province: the province page (full descriptive link) and a pill for each city page
  const where = pages.filter((p) => p.prov || p.cities.length).map((p) => `<div class="cg-prov"><h3>${p.prov ? `<a href="${p.prov.href}">${esc(p.prov.label)}</a>` : esc(p.name)}</h3>${p.cities.length ? `<div class="cg-pills">${p.cities.map((c) => `<a href="${c.href}" title="${esc(c.label)}">${esc(c.city)}</a>`).join('')}</div>` : ''}</div>`).join('');
  const others = TYPES.filter(([k]) => k !== id).map(([, o]) => `<a href="/${o.slug}">${esc(o.name)}</a>`).join('');
  const faq = t.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');

  // optional photos (only the guides whose data has them): a featured photo under the headline and one inside the article
  const img = (p, attrs) => `<img src="${p.src}" srcset="${p.small} 640w, ${p.src} ${p.w}w" width="${p.w}" height="${p.h}" alt="${esc(p.alt)}" ${attrs} decoding="async">`;
  const feature = t.photos && t.photos.hero ? `<figure class="cg-feature">${img(t.photos.hero, 'sizes="(min-width:1100px) 1036px, 100vw" fetchpriority="high"')}</figure>` : '';
  const inline = t.photos && t.photos.side ? `<figure class="cg-figure">${img(t.photos.side, 'sizes="(min-width:1000px) 700px, 100vw" loading="lazy"')}${t.photos.side.caption ? `<figcaption>${esc(t.photos.side.caption)}</figcaption>` : ''}</figure>` : '';
  const words = [t.lede, t.differ, ...t.when, ...t.does, ...t.ask, ...t.faqs.flatMap((f) => [f.q, f.a])].join(' ').split(/\s+/).length;
  const minutes = Math.max(2, Math.round(words / 200));
  const heads = { when: `When to speak to a ${t.noun}`, does: `What a ${t.noun} does`, rules: 'How the rules differ across Canada', ask: `Questions to ask before you hire a ${t.noun}`, faq: 'Frequently asked questions' };
  const toc = Object.entries(heads).map(([k, h]) => `<li><a href="#${k}">${esc(h)}</a></li>`).join('') + `<li><a href="#where">${esc(t.name)} lawyers by province and city</a></li>`;

  const body = `
<header class="cg-top">
  <div class="cg-wrap">
    <div class="cg-crumb"><a href="/">Home</a> &rsaquo; <a href="/find-lawyers">Find a lawyer</a> &rsaquo; ${esc(crumbName)}</div>
    <p class="cg-eyebrow">Case guide</p>
    <h1>${esc(t.h1)}</h1>
    <ul class="cg-meta"><li>Updated ${longDate(DATA.updated)}</li><li>${minutes} min read</li><li>General information, not legal advice</li></ul>
    ${feature}
  </div>
</header>
<div class="cg-layout">
  <article class="cg-article">
    <p class="cg-lede">${esc(t.lede)}</p>
    <div class="cg-cta"><a class="cg-btn" href="/find-lawyers?case=${id}">Find a ${esc(t.noun)}</a><a class="cg-jump" href="#where">Browse by province and city &darr;</a></div>
    <h2 id="when">${esc(heads.when)}</h2>
    ${list(t.when)}
    <h2 id="does">${esc(heads.does)}</h2>
    ${list(t.does)}
    ${inline}
    <section class="cg-note" id="rules"><h2>${esc(heads.rules)}</h2><p>${esc(t.differ)}</p></section>
    <h2 id="ask">${esc(heads.ask)}</h2>
    ${list(t.ask, 'ol')}
    <section class="cg-faq" id="faq"><h2>${esc(heads.faq)}</h2>${faq}</section>
  </article>
  <aside class="cg-side" aria-label="About this guide">
    <div class="cg-card"><h2>Find a ${esc(t.noun)}</h2><p>Search by city and see public Google ratings. Firms cannot pay to change them.</p><a class="cg-btn" href="/find-lawyers?case=${id}">Start your search</a></div>
    <div class="cg-card"><h2>In this guide</h2><ul class="cg-toc">${toc}</ul></div>
  </aside>
</div>
<div class="cg-after">
  <section class="cg-where" id="where"><h2>${esc(t.name)} lawyers by province and city</h2><p>Pick a province for every firm we list there, or a city to go straight to its lawyers.</p><div class="cg-provs">${where}</div></section>
  <section class="cg-more"><h2>Other practice areas</h2><div class="cg-chips">${others}</div></section>
  <p class="cg-small">This page is general information about legal topics in Canada, not legal advice. Laws change and differ by province, so speak to a licensed lawyer about your situation. LawDB is an independent directory: ratings shown are public Google ratings, and a firm cannot pay to change them. <a href="/find-lawyers">Search by city or case type</a>.</p>
</div>`;
  return SHELL.replace('%%HEAD%%', () => head).replace('%%BODY%%', () => body);
}

// the case-type tiles in the hero of /find-lawyers (glass tiles on the skyline photo, in the home page's order, with the home page's labels and icons)
function cardsHtml() {
  const order = ['traffic', 'criminal', 'family', 'injury', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation'];
  const li = (k) => { const t = DATA.types[k]; return `<li><a class="fyh-tile" href="/${t.slug}" title="${esc(t.card)}"><span class="fyh-ic"><svg width="22" height="22" aria-hidden="true"><use href="#i-${t.icon}"/></svg></span><span class="fyh-cl">${esc(t.homeLabel)}</span><svg class="fyh-chev" width="16" height="16" aria-hidden="true"><use href="#i-chev"/></svg></a></li>`; };
  return '<!--case-cards--><div class="fyh-cases" id="cases"><p class="fyh-ch"><span>Or browse by case type</span></p>'
    + `<ul class="fyh-grid">${order.map(li).join('')}</ul></div><!--/case-cards-->`;
}

// the "Or pick a case type" list on the home page
function homeCasesHtml() {
  const li = ([, t]) => `<li><a href="/${t.slug}"><span class="h4-ic"><svg width="22" height="22" aria-hidden="true"><use href="#i-${t.icon}"/></svg></span><span class="h4-cl">${esc(t.homeLabel)}</span><svg class="h4-chev" width="16" height="16" aria-hidden="true"><use href="#i-chev"/></svg></a></li>`;
  const order = ['traffic', 'criminal', 'family', 'injury', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation']; // the order the case types have always had on the site
  return `<!--home-cases--><ul class="h4-case-grid">${order.map((k) => li([k, DATA.types[k]])).join('')}</ul><!--/home-cases-->`;
}

let stale = 0, written = 0;
const put = (file, html) => {
  const old = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (old === html) return;
  if (CHECK) { stale++; console.error(`out of date: ${file}`); return; }
  writeFileSync(file, html); written++;
};
for (const entry of TYPES) put(`${entry[1].slug}.html`, pageHtml(entry));

const find = readFileSync('find-lawyers.html', 'utf8');
if (!find.includes('<!--case-cards-->')) { console.error('find-lawyers.html has no <!--case-cards--> marker'); process.exit(1); }
put('find-lawyers.html', find.replace(/<!--case-cards-->[\s\S]*?<!--\/case-cards-->/, () => cardsHtml()));

const home = readFileSync('index.html', 'utf8');
if (!home.includes('<!--home-cases-->')) { console.error('index.html has no <!--home-cases--> marker'); process.exit(1); }
put('index.html', home.replace(/<!--home-cases-->[\s\S]*?<!--\/home-cases-->/, () => homeCasesHtml()));

if (CHECK) { if (stale) process.exit(1); console.log(`case pages and cards are up to date (${TYPES.length} pages)`); }
else console.log(`${written} file(s) written (${TYPES.length} case pages, the cards on /find-lawyers and the list on the home page)`);
